import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, statSync, utimesSync, symlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';
import { backfillArchive, formatBackfillReport } from '../src/backfill.js';
import { distillTranscript } from '../src/archive-distill.js';
import { indexArchive } from '../src/sync/index.js';
import { initDatabase } from '../src/db.js';
import { suppressConsole, testTimeoutMs } from './test-utils.js';

let n = 0;
function conversation(question: string): string {
  n++;
  return [
    { type: 'user', uuid: `u${n}`, parentUuid: null, timestamp: '2026-01-01T12:00:00Z', isSidechain: false, message: { role: 'user', content: question } },
    { type: 'attachment', uuid: `x${n}`, attachment: 'y'.repeat(4000) },
    { type: 'queue-operation', operation: 'enqueue', content: 'z'.repeat(1000) },
    { type: 'assistant', uuid: `a${n}`, parentUuid: `u${n}`, timestamp: '2026-01-01T12:00:01Z', isSidechain: false, message: { role: 'assistant', content: [
      { type: 'tool_use', id: `t${n}`, name: 'Read', input: { file_path: '/x' } },
    ] } },
    { type: 'user', uuid: `r${n}`, parentUuid: `a${n}`, toolUseResult: { file: { content: 'c'.repeat(8000) } }, message: { role: 'user', content: [
      { type: 'tool_result', tool_use_id: `t${n}`, content: 'c'.repeat(8000) },
    ] } },
    { type: 'assistant', uuid: `b${n}`, parentUuid: `r${n}`, timestamp: '2026-01-01T12:00:02Z', isSidechain: false, message: { role: 'assistant', content: `answer to ${question}` } },
  ].map(l => JSON.stringify(l)).join('\n') + '\n';
}

const held = () => ({ ok: false as const, holder: 'pid 1' });
const free = () => ({ ok: true as const });

describe('backfillArchive', () => {
  let testDir: string;
  let archiveDir: string;
  let restoreConsole: () => void;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'em-backfill-'));
    archiveDir = join(testDir, 'archive');
    process.env.TEST_DB_PATH = join(testDir, 'test.db');
    process.env.EPISODIC_MEMORY_CONFIG_DIR = join(testDir, 'config');
    for (const p of ['alpha', 'beta']) {
      mkdirSync(join(archiveDir, p, 'sub'), { recursive: true });
      writeFileSync(join(archiveDir, p, 'c.jsonl'), conversation(`${p} question`));
      writeFileSync(join(archiveDir, p, 'sub', 'agent.jsonl'), conversation(`${p} agent`));
      writeFileSync(join(archiveDir, p, 'c-summary.txt'), 'summary');
    }
    restoreConsole = suppressConsole();
  });

  afterEach(() => {
    restoreConsole();
    delete process.env.TEST_DB_PATH;
    delete process.env.EPISODIC_MEMORY_CONFIG_DIR;
    rmSync(testDir, { recursive: true, force: true });
  });

  it('dry-run reports bytes saved and changes nothing', async () => {
    const file = join(archiveDir, 'alpha', 'c.jsonl');
    const before = readFileSync(file);
    const mtime = statSync(file).mtimeMs;
    const report = await backfillArchive({ archiveDir, dryRun: true, acquireLock: held });
    expect(report.files).toBe(4);
    expect(report.changed).toBe(4);
    expect(report.bytesAfter).toBeLessThan(report.bytesBefore);
    expect(report.failed).toEqual([]);
    expect(readFileSync(file).equals(before)).toBe(true);
    expect(statSync(file).mtimeMs).toBe(mtime);
    expect(formatBackfillReport(report)).toMatch(/would save [\d.]+ (B|KB|MB|GB) \(\d+%\)/);
  });

  it('rewrites only the chosen project, keeps mtime, purges its index rows and is idempotent', async () => {
    await indexArchive(archiveDir);
    const alpha = join(archiveDir, 'alpha', 'c.jsonl');
    const beta = join(archiveDir, 'beta', 'c.jsonl');
    const betaBefore = readFileSync(beta);
    utimesSync(alpha, new Date(1_000_000), new Date(1_000_000));
    const raw = readFileSync(alpha, 'utf8');

    const db = initDatabase();
    try {
      const report = await backfillArchive({ archiveDir, project: 'alpha', dryRun: false, db, acquireLock: free });
      expect(report.changed).toBe(2);
      expect(report.touched.sort()).toEqual([alpha, join(archiveDir, 'alpha', 'sub', 'agent.jsonl')].sort());
      const count = (sql: string, p: string) => (db.prepare(sql).get(p) as { n: number }).n;
      expect(count('SELECT COUNT(*) n FROM exchanges WHERE archive_path = ?', alpha)).toBe(0);
      expect(count('SELECT COUNT(*) n FROM indexed_files WHERE archive_path = ?', alpha)).toBe(0);
      expect(count('SELECT COUNT(*) n FROM exchanges WHERE archive_path = ?', beta)).toBeGreaterThan(0);

      const again = await backfillArchive({ archiveDir, project: 'alpha', dryRun: false, db, acquireLock: free });
      expect(again.changed).toBe(0);
    } finally {
      db.close();
    }
    expect(readFileSync(alpha, 'utf8')).toBe(distillTranscript(raw));
    expect(statSync(alpha).mtimeMs).toBe(1_000_000);
    expect(readFileSync(beta).equals(betaBefore)).toBe(true);
    expect(readFileSync(join(archiveDir, 'alpha', 'c-summary.txt'), 'utf8')).toBe('summary');
  }, testTimeoutMs(120000));

  it('purged files are re-indexed by the next index pass (the --no-index recovery path)', async () => {
    await indexArchive(archiveDir);
    const db = initDatabase();
    try {
      await backfillArchive({ archiveDir, project: 'alpha', dryRun: false, db, acquireLock: free });
    } finally {
      db.close();
    }
    await indexArchive(archiveDir);
    const ro = new Database(join(testDir, 'test.db'), { readonly: true });
    try {
      const alpha = join(archiveDir, 'alpha', 'c.jsonl');
      const rows = ro.prepare('SELECT user_message, line_start FROM exchanges WHERE archive_path = ?').all(alpha) as Array<{ user_message: string; line_start: number }>;
      const distilledLines = readFileSync(alpha, 'utf8').split('\n').filter(Boolean).length;
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.find(r => r.user_message === 'alpha question')?.line_start).toBe(1);
      expect(new Set(rows.map(r => r.line_start)).size).toBe(rows.length);
      expect(Math.max(...rows.map(r => r.line_start))).toBeLessThanOrEqual(distilledLines);
      expect((ro.prepare('SELECT COUNT(*) n FROM indexed_files WHERE archive_path = ?').get(alpha) as { n: number }).n).toBe(1);
    } finally {
      ro.close();
    }
  }, testTimeoutMs(120000));

  it('refuses a real run while the sync lock is held, writing nothing', async () => {
    const file = join(archiveDir, 'alpha', 'c.jsonl');
    const before = readFileSync(file);
    await expect(backfillArchive({ archiveDir, dryRun: false, acquireLock: held })).rejects.toThrow(/sync is running \(pid 1\)/);
    expect(readFileSync(file).equals(before)).toBe(true);
  });

  it('skips symlinked files and reports an unreadable project as missing', async () => {
    symlinkSync(join(archiveDir, 'beta', 'c.jsonl'), join(archiveDir, 'alpha', 'link.jsonl'));
    const report = await backfillArchive({ archiveDir, project: 'alpha', dryRun: true, acquireLock: held });
    expect(report.files).toBe(2);
    await expect(backfillArchive({ archiveDir, project: 'nope', dryRun: true, acquireLock: held })).rejects.toThrow(/no archived project named "nope"/);
  });
});
