import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, utimesSync, appendFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { copyDistilled, distillTranscript } from '../src/archive-distill.js';
import { initDatabase, insertExchange, markFileIndexed, purgeArchivePath } from '../src/db.js';
import type { ConversationExchange } from '../src/types.js';

const jl = (...records: unknown[]) => records.map(r => JSON.stringify(r)).join('\n') + '\n';
const user = (t: string) => ({ type: 'user', message: { role: 'user', content: t } });
const noise = { type: 'progress', data: 'x'.repeat(100) };

describe('copyDistilled', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'em-copy-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('writes distilled content when the destination is missing, and skips a current one', () => {
    const src = join(dir, 'src.jsonl');
    const dest = join(dir, 'archive', 'p', 'dest.jsonl');
    writeFileSync(src, jl(user('a'), noise));
    expect(copyDistilled(src, dest)).toEqual({ copied: true, shifted: false });
    expect(readFileSync(dest, 'utf8')).toBe(jl(user('a')));
    expect(copyDistilled(src, dest)).toEqual({ copied: false, shifted: false });
    expect(readdirSync(join(dir, 'archive', 'p'))).toEqual(['dest.jsonl']);
  });

  it('reports no shift when a distilled archive grows, and a shift when the archive was raw', () => {
    const src = join(dir, 'src.jsonl');
    const dest = join(dir, 'dest.jsonl');
    writeFileSync(src, jl(user('a'), noise));
    copyDistilled(src, dest);
    appendFileSync(src, jl(user('b')));
    utimesSync(dest, new Date(1000), new Date(1000));
    expect(copyDistilled(src, dest)).toEqual({ copied: true, shifted: false });

    writeFileSync(dest, readFileSync(src)); // a raw archive from before distill existed
    utimesSync(dest, new Date(1000), new Date(1000));
    expect(copyDistilled(src, dest)).toEqual({ copied: true, shifted: true });
    expect(readFileSync(dest, 'utf8')).toBe(distillTranscript(readFileSync(src, 'utf8')));
  });
});

describe('purgeArchivePath', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'em-purge-'));
    process.env.TEST_DB_PATH = join(dir, 'db.sqlite');
  });
  afterEach(() => {
    delete process.env.TEST_DB_PATH;
    rmSync(dir, { recursive: true, force: true });
  });

  const exchange = (id: string, archivePath: string): ConversationExchange => ({
    id, project: 'p', timestamp: '2026-01-01T00:00:00Z', userMessage: 'q', assistantMessage: 'a',
    archivePath, lineStart: 1, lineEnd: 2,
    toolCalls: [{ id: `${id}-tc`, exchangeId: id, toolName: 'Bash', toolInput: {}, isError: false, timestamp: '2026-01-01T00:00:00Z' }],
  });

  it('removes exchanges, tool calls, vectors and the ledger row for one path only', () => {
    const db = initDatabase();
    try {
      const vec = new Array(384).fill(0.1);
      insertExchange(db, exchange('e1', '/a.jsonl'), vec, ['Bash']);
      insertExchange(db, exchange('e2', '/b.jsonl'), vec, ['Bash']);
      markFileIndexed(db, '/a.jsonl', 1, 1);
      markFileIndexed(db, '/b.jsonl', 1, 1);

      expect(purgeArchivePath(db, '/a.jsonl')).toBe(1);

      const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
      expect(count("SELECT COUNT(*) n FROM exchanges WHERE archive_path = '/a.jsonl'")).toBe(0);
      expect(count("SELECT COUNT(*) n FROM tool_calls WHERE exchange_id = 'e1'")).toBe(0);
      expect(count("SELECT COUNT(*) n FROM vec_exchanges WHERE id = 'e1'")).toBe(0);
      expect(count("SELECT COUNT(*) n FROM indexed_files WHERE archive_path = '/a.jsonl'")).toBe(0);
      expect(count("SELECT COUNT(*) n FROM exchanges WHERE archive_path = '/b.jsonl'")).toBe(1);
      expect(count("SELECT COUNT(*) n FROM indexed_files WHERE archive_path = '/b.jsonl'")).toBe(1);
    } finally {
      db.close();
    }
  });
});
