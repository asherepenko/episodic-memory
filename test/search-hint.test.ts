import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { buildEmptyResultHint } from '../src/search.js';

// buildEmptyResultHint reads the index at getDbPath(), which honors
// EPISODIC_MEMORY_DB_PATH — so we point it at a temp DB per case.
describe('buildEmptyResultHint', () => {
  let testDir: string;
  let dbPath: string;
  let prevDbPath: string | undefined;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'em-search-hint-'));
    dbPath = join(testDir, 'test.db');
    prevDbPath = process.env.EPISODIC_MEMORY_DB_PATH;
    process.env.EPISODIC_MEMORY_DB_PATH = dbPath;
  });

  afterEach(() => {
    if (prevDbPath === undefined) delete process.env.EPISODIC_MEMORY_DB_PATH;
    else process.env.EPISODIC_MEMORY_DB_PATH = prevDbPath;
    rmSync(testDir, { recursive: true, force: true });
  });

  it('hints to sync/status when the index does not exist yet', async () => {
    const hint = await buildEmptyResultHint();
    expect(hint).toBeDefined();
    expect(hint).toContain('episodic-memory sync');
    expect(hint).toContain('episodic-memory status');
  });

  it('returns undefined when the index has conversations (a genuine no-match)', async () => {
    const db = new Database(dbPath);
    sqliteVec.load(db);
    db.exec(`
      CREATE TABLE exchanges (
        id TEXT PRIMARY KEY,
        project TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        user_message TEXT NOT NULL,
        assistant_message TEXT NOT NULL,
        archive_path TEXT NOT NULL,
        line_start INTEGER NOT NULL,
        line_end INTEGER NOT NULL
      )
    `);
    db.prepare(`
      INSERT INTO exchanges (id, project, timestamp, user_message, assistant_message, archive_path, line_start, line_end)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('id-1', 'proj', '2026-01-01T00:00:00Z', 'hello', 'hi', join(testDir, 'a.jsonl'), 1, 2);
    db.close();

    const hint = await buildEmptyResultHint();
    expect(hint).toBeUndefined();
  });
});
