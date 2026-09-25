import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, copyFileSync, utimesSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';
import { syncConversations, indexArchive } from '../src/sync/index.js';
import type { SyncEvent } from '../src/sync/index.js';
import { suppressConsole, testTimeoutMs } from './test-utils.js';

function conversation(question: string, answer: string): string {
  return [
    { type: 'user', uuid: `u-${question}`, parentUuid: null, timestamp: '2026-01-01T12:00:00Z', isSidechain: false, message: { role: 'user', content: question } },
    { type: 'assistant', uuid: `a-${question}`, parentUuid: `u-${question}`, timestamp: '2026-01-01T12:00:01Z', isSidechain: false, message: { role: 'assistant', content: answer } },
  ].map(line => JSON.stringify(line)).join('\n') + '\n';
}

function exchangeCount(dbPath: string): number {
  const db = new Database(dbPath, { readonly: true });
  try {
    return (db.prepare('SELECT COUNT(*) AS n FROM exchanges').get() as { n: number }).n;
  } finally {
    db.close();
  }
}

describe('sync index backlog', () => {
  let testDir: string;
  let sourceDir: string;
  let destDir: string;
  let dbPath: string;
  let restoreConsole: () => void;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'episodic-memory-backlog-'));
    sourceDir = join(testDir, 'source');
    destDir = join(testDir, 'dest');
    dbPath = join(testDir, 'test.db');
    mkdirSync(sourceDir, { recursive: true });
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

  it('indexes an archived file that a crashed run copied but never indexed', async () => {
    // A previous sync copied the file, then died before indexing (#native-binding crash).
    const src = join(sourceDir, 'project-a', 'crashed.jsonl');
    const dest = join(destDir, 'project-a', 'crashed.jsonl');
    mkdirSync(join(sourceDir, 'project-a'), { recursive: true });
    mkdirSync(join(destDir, 'project-a'), { recursive: true });
    writeFileSync(src, conversation('lost question', 'lost answer'));
    copyFileSync(src, dest);
    const later = new Date(Date.now() + 5000);
    utimesSync(dest, later, later);

    const result = await syncConversations(sourceDir, destDir, { skipSummaries: true });

    expect(result.copied).toBe(0);
    expect(result.indexed).toBe(1);
    expect(exchangeCount(dbPath)).toBe(1);
  }, testTimeoutMs(60000));

  it('indexes archive-only projects whose source was deleted', async () => {
    mkdirSync(join(destDir, 'dead-project'), { recursive: true });
    writeFileSync(join(destDir, 'dead-project', 'old.jsonl'), conversation('old question', 'old answer'));

    const result = await indexArchive(destDir);

    expect(result.indexed).toBe(1);
    expect(exchangeCount(dbPath)).toBe(1);
  }, testTimeoutMs(60000));

  it('does not re-index unchanged files, including ones with nothing to index', async () => {
    mkdirSync(join(sourceDir, 'project-a'), { recursive: true });
    writeFileSync(join(sourceDir, 'project-a', 'normal.jsonl'), conversation('q', 'a'));
    writeFileSync(join(sourceDir, 'project-a', 'empty.jsonl'), '{"type":"summary"}\n');

    const first = await syncConversations(sourceDir, destDir, { skipSummaries: true });
    const second = await syncConversations(sourceDir, destDir, { skipSummaries: true });
    const archivePass = await indexArchive(destDir);

    expect(first.indexed).toBe(2);
    expect(second.indexed).toBe(0);
    expect(archivePass.indexed).toBe(0);
    expect(exchangeCount(dbPath)).toBe(1);
  }, testTimeoutMs(60000));

  it('re-indexes a file that changed after it was indexed', async () => {
    const src = join(sourceDir, 'project-a', 'growing.jsonl');
    mkdirSync(join(sourceDir, 'project-a'), { recursive: true });
    writeFileSync(src, conversation('first', 'one'));
    await syncConversations(sourceDir, destDir, { skipSummaries: true });

    writeFileSync(src, conversation('first', 'one') + conversation('second', 'two'));
    const later = new Date(Date.now() + 5000);
    utimesSync(src, later, later);
    const result = await syncConversations(sourceDir, destDir, { skipSummaries: true });

    expect(result.indexed).toBe(1);
    expect(exchangeCount(dbPath)).toBe(2);
  }, testTimeoutMs(60000));

  it('reports one row per project with copy and index counts', async () => {
    mkdirSync(join(sourceDir, 'project-a'), { recursive: true });
    mkdirSync(join(sourceDir, 'project-b'), { recursive: true });
    writeFileSync(join(sourceDir, 'project-a', 'one.jsonl'), conversation('q1', 'a1'));
    writeFileSync(join(sourceDir, 'project-b', 'two.jsonl'), conversation('q2', 'a2'));
    await syncConversations(sourceDir, destDir, { skipSummaries: true });
    writeFileSync(join(sourceDir, 'project-b', 'three.jsonl'), conversation('q3', 'a3'));

    const events: SyncEvent[] = [];
    await syncConversations(sourceDir, destDir, { skipSummaries: true, onEvent: e => events.push(e) });

    const done = events.filter(e => e.type === 'project-done');
    expect(done).toEqual([
      expect.objectContaining({ type: 'project-done', project: 'project-a', index: 1, total: 2, copied: 0, indexed: 0 }),
      expect.objectContaining({ type: 'project-done', project: 'project-b', index: 2, total: 2, copied: 1, indexed: 1, exchanges: 1 }),
    ]);
  }, testTimeoutMs(60000));
});
