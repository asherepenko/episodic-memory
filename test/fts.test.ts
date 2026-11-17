import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDatabase, insertExchange, deleteExchange, purgeArchivePath } from '../src/db.js';
import { ConversationExchange } from '../src/types.js';
import { suppressConsole } from './test-utils.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

const embedding = new Array(384).fill(0).map((_, i) => (i === 0 ? 1 : 0));

function exchange(id: string, user: string, assistant: string, archivePath = '/a/s1.jsonl'): ConversationExchange {
  return {
    id, project: 'p', timestamp: '2026-01-01T00:00:00Z', userMessage: user, assistantMessage: assistant,
    archivePath, lineStart: 1, lineEnd: 2, sessionId: 's1',
  } as ConversationExchange;
}

function ftsIds(db: ReturnType<typeof initDatabase>, match: string): string[] {
  return (db.prepare(`
    SELECT e.id FROM exchanges_fts f JOIN exchanges e ON e.rowid = f.rowid
    WHERE exchanges_fts MATCH ? ORDER BY e.id
  `).all(match) as Array<{ id: string }>).map(r => r.id);
}

describe('exchanges_fts lexical index', () => {
  let dir: string;
  let restore: () => void;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'em-fts-'));
    process.env.TEST_DB_PATH = path.join(dir, 'test.db');
    restore = suppressConsole();
  });

  afterEach(() => {
    restore();
    delete process.env.TEST_DB_PATH;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('indexes both sides of an inserted exchange', () => {
    const db = initDatabase();
    insertExchange(db, exchange('x1', 'how do I rotate the signing keys', 'Use the keystore rotation command'), embedding);
    expect(ftsIds(db, 'rotate')).toEqual(['x1']);
    expect(ftsIds(db, 'keystore')).toEqual(['x1']);
    db.close();
  });

  it('re-indexing the same exchange replaces its terms instead of duplicating them', () => {
    const db = initDatabase();
    insertExchange(db, exchange('x1', 'old wording about apples', 'reply'), embedding);
    insertExchange(db, exchange('x1', 'new wording about pears', 'reply'), embedding);
    expect(ftsIds(db, 'apples')).toEqual([]);
    expect(ftsIds(db, 'pears')).toEqual(['x1']);
    expect(ftsIds(db, 'reply')).toEqual(['x1']);
    db.close();
  });

  it('drops terms when an exchange is deleted or its archive purged', () => {
    const db = initDatabase();
    insertExchange(db, exchange('x1', 'alpha topic', 'reply'), embedding);
    insertExchange(db, exchange('x2', 'beta topic', 'reply', '/a/s2.jsonl'), embedding);
    deleteExchange(db, 'x1');
    purgeArchivePath(db, '/a/s2.jsonl');
    expect(ftsIds(db, 'topic')).toEqual([]);
    db.close();
  });

  it('builds the index for a database created before it existed', () => {
    const db = initDatabase();
    insertExchange(db, exchange('x1', 'legacy row about zebras', 'reply'), embedding);
    db.exec('DROP TRIGGER exchanges_fts_ai; DROP TRIGGER exchanges_fts_ad; DROP TRIGGER exchanges_fts_au; DROP TABLE exchanges_fts;');
    db.close();

    const migrated = initDatabase();
    expect(ftsIds(migrated, 'zebras')).toEqual(['x1']);
    migrated.close();
  });
});

describe('buildLexicalQuery', () => {
  it('ORs quoted word tokens and drops stop words', async () => {
    const { buildLexicalQuery } = await import('../src/search.js');
    expect(buildLexicalQuery('How do I rotate the signing keys?')).toBe('"rotate" OR "signing" OR "keys"');
  });

  it('keeps identifiers and strips FTS syntax characters', async () => {
    const { buildLexicalQuery } = await import('../src/search.js');
    expect(buildLexicalQuery('max_retries "NEAR" (foo*) -bar')).toBe('"max_retries" OR "near" OR "foo" OR "bar"');
  });

  it('returns null when nothing searchable is left', async () => {
    const { buildLexicalQuery } = await import('../src/search.js');
    expect(buildLexicalQuery('the of a ?!')).toBeNull();
  });
});

describe('text search uses the lexical index', () => {
  let dir: string;
  let restore: () => void;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'em-fts-search-'));
    process.env.TEST_DB_PATH = path.join(dir, 'test.db');
    restore = suppressConsole();
  });

  afterEach(() => {
    restore();
    delete process.env.TEST_DB_PATH;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('matches words that are not one contiguous substring, best match first', async () => {
    const { searchConversations } = await import('../src/search.js');
    const db = initDatabase();
    insertExchange(db, exchange('x1', 'the signing keys need to rotate monthly', 'ok'), embedding);
    insertExchange(db, exchange('x2', 'unrelated note about keys', 'ok', '/a/s2.jsonl'), embedding);
    insertExchange(db, exchange('x3', 'garden tomatoes', 'ok', '/a/s3.jsonl'), embedding);
    db.close();

    const results = await searchConversations('rotate signing keys', { mode: 'text', limit: 5, collapse: false });
    expect(results.map(r => r.exchange.id)).toEqual(['x1', 'x2']);
  });
});

describe('per-session collapse', () => {
  let dir: string;
  let restore: () => void;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'em-collapse-'));
    process.env.TEST_DB_PATH = path.join(dir, 'test.db');
    restore = suppressConsole();
  });

  afterEach(() => {
    restore();
    delete process.env.TEST_DB_PATH;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function seed(): void {
    const db = initDatabase();
    insertExchange(db, exchange('a1', 'rotate signing keys now', 'ok'), embedding);
    insertExchange(db, exchange('a2', 'rotate signing keys again', 'ok'), embedding);
    insertExchange(db, { ...exchange('b1', 'signing keys elsewhere', 'ok', '/a/s2.jsonl'), sessionId: 's2' }, embedding);
    db.close();
  }

  it('returns one hit per conversation by default, the best ranked one', async () => {
    seed();
    const { searchConversations } = await import('../src/search.js');
    const results = await searchConversations('rotate signing keys', { mode: 'text', limit: 5 });
    expect(results.map(r => r.exchange.sessionId)).toEqual(['s1', 's2']);
  });

  it('keeps every exchange when collapse is off', async () => {
    seed();
    const { searchConversations } = await import('../src/search.js');
    const results = await searchConversations('rotate signing keys', { mode: 'text', limit: 5, collapse: false });
    expect(results).toHaveLength(3);
  });
});
