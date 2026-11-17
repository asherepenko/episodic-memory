import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, appendFileSync, utimesSync, copyFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';
import { syncConversations } from '../src/sync/index.js';
import { suppressConsole, testTimeoutMs } from './test-utils.js';

let n = 0;
function turn(question: string, answer: string): string {
  n++;
  return [
    { type: 'user', uuid: `u${n}`, parentUuid: null, timestamp: '2026-01-01T12:00:00Z', isSidechain: false, message: { role: 'user', content: question } },
    { type: 'progress', uuid: `p${n}`, data: 'tick' },
    { type: 'assistant', uuid: `a${n}`, parentUuid: `u${n}`, timestamp: '2026-01-01T12:00:01Z', isSidechain: false, message: { role: 'assistant', content: answer } },
  ].map(line => JSON.stringify(line)).join('\n') + '\n';
}

function rows(dbPath: string): Array<{ user_message: string; line_start: number }> {
  const db = new Database(dbPath, { readonly: true });
  try {
    return db.prepare('SELECT user_message, line_start FROM exchanges ORDER BY line_start').all() as Array<{ user_message: string; line_start: number }>;
  } finally {
    db.close();
  }
}

describe('sync distills on copy', () => {
  let testDir: string;
  let sourceDir: string;
  let destDir: string;
  let dbPath: string;
  let restoreConsole: () => void;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'em-sync-distill-'));
    sourceDir = join(testDir, 'source');
    destDir = join(testDir, 'dest');
    dbPath = join(testDir, 'test.db');
    mkdirSync(join(sourceDir, 'proj'), { recursive: true });
    process.env.TEST_DB_PATH = dbPath;
    process.env.EPISODIC_MEMORY_CONFIG_DIR = join(testDir, 'config');
    restoreConsole = suppressConsole();
  });

  afterEach(() => {
    restoreConsole();
    delete process.env.TEST_DB_PATH;
    delete process.env.EPISODIC_MEMORY_CONFIG_DIR;
    rmSync(testDir, { recursive: true, force: true });
  });

  it('archives a distilled copy and indexes it', async () => {
    const src = join(sourceDir, 'proj', 'c.jsonl');
    writeFileSync(src, turn('first question', 'first answer'));
    await syncConversations(sourceDir, destDir, { skipSummaries: true });
    const archived = readFileSync(join(destDir, 'proj', 'c.jsonl'), 'utf8');
    expect(archived).not.toContain('"progress"');
    expect(rows(dbPath).map(r => r.user_message)).toEqual(['first question']);
  }, testTimeoutMs(120000));

  it('leaves no stale rows when a raw, already-indexed archive is re-copied distilled', async () => {
    const src = join(sourceDir, 'proj', 'c.jsonl');
    const dest = join(destDir, 'proj', 'c.jsonl');
    writeFileSync(src, turn('old question', 'old answer'));
    // An archive written before distill existed: raw lines, indexed at raw line numbers.
    mkdirSync(join(destDir, 'proj'), { recursive: true });
    copyFileSync(src, dest);
    const later = new Date(Date.now() + 5000);
    utimesSync(dest, later, later);
    await syncConversations(sourceDir, destDir, { skipSummaries: true });
    expect(rows(dbPath)).toHaveLength(1);

    appendFileSync(src, turn('new question', 'new answer'));
    const evenLater = new Date(Date.now() + 10000);
    utimesSync(src, evenLater, evenLater);
    await syncConversations(sourceDir, destDir, { skipSummaries: true });

    expect(readFileSync(dest, 'utf8')).not.toContain('"progress"');
    expect(rows(dbPath)).toEqual([
      { user_message: 'old question', line_start: 1 },
      { user_message: 'new question', line_start: 3 },
    ]);
  }, testTimeoutMs(120000));
});

describe('index command distills on copy', () => {
  let testDir: string;
  let projectsDir: string;
  let archiveDir: string;
  let dbPath: string;
  let restoreConsole: () => void;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'em-index-distill-'));
    projectsDir = join(testDir, 'projects');
    archiveDir = join(testDir, 'archive');
    dbPath = join(testDir, 'test.db');
    mkdirSync(join(projectsDir, 'proj'), { recursive: true });
    process.env.TEST_PROJECTS_DIR = projectsDir;
    process.env.TEST_ARCHIVE_DIR = archiveDir;
    process.env.TEST_DB_PATH = dbPath;
    process.env.EPISODIC_MEMORY_CONFIG_DIR = join(testDir, 'config');
    restoreConsole = suppressConsole();
  });

  afterEach(() => {
    restoreConsole();
    for (const k of ['TEST_PROJECTS_DIR', 'TEST_ARCHIVE_DIR', 'TEST_DB_PATH', 'EPISODIC_MEMORY_CONFIG_DIR']) delete process.env[k];
    rmSync(testDir, { recursive: true, force: true });
  });

  it('indexUnprocessed archives distilled, numbers lines from the archive, and re-indexes a raw archive whole', async () => {
    const { indexUnprocessed } = await import('../src/indexer.js');
    const src = join(projectsDir, 'proj', 'c.jsonl');
    const dest = join(archiveDir, 'proj', 'c.jsonl');
    writeFileSync(src, turn('old question', 'old answer'));
    // A raw archive indexed before distill existed.
    mkdirSync(join(archiveDir, 'proj'), { recursive: true });
    copyFileSync(src, dest);
    utimesSync(dest, new Date(Date.now() + 5000), new Date(Date.now() + 5000));
    await indexUnprocessed(1, true);
    expect(rows(dbPath)).toEqual([{ user_message: 'old question', line_start: 1 }]);

    appendFileSync(src, turn('new question', 'new answer'));
    utimesSync(src, new Date(Date.now() + 10000), new Date(Date.now() + 10000));
    await indexUnprocessed(1, true);

    expect(readFileSync(dest, 'utf8')).not.toContain('"progress"');
    expect(rows(dbPath)).toEqual([
      { user_message: 'old question', line_start: 1 },
      { user_message: 'new question', line_start: 3 },
    ]);

    // A current distilled archive is not re-copied.
    const before = readFileSync(dest);
    await indexUnprocessed(1, true);
    expect(readFileSync(dest).equals(before)).toBe(true);
  }, testTimeoutMs(120000));
});
