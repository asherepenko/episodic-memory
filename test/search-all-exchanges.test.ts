import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { initDatabase, insertExchange } from '../src/db.js';
import { ConversationExchange } from '../src/types.js';
import { suppressConsole } from './test-utils.js';

const root = path.join(__dirname, '..');
const embedding = new Array(384).fill(0).map((_, i) => (i === 0 ? 1 : 0));

function exchange(id: string, user: string): ConversationExchange {
  return {
    id, project: 'p', timestamp: '2026-01-01T00:00:00Z', userMessage: user, assistantMessage: 'ok',
    archivePath: '/a/s1.jsonl', lineStart: 1, lineEnd: 2, sessionId: 's1',
  } as ConversationExchange;
}

describe('search CLI --all-exchanges', () => {
  let dir: string;
  let restore: () => void;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'em-all-ex-'));
    process.env.TEST_DB_PATH = path.join(dir, 'test.db');
    restore = suppressConsole();
    const db = initDatabase();
    insertExchange(db, exchange('x1', 'zanzibar keys rotation first'), embedding);
    insertExchange(db, exchange('x2', 'zanzibar keys rotation second'), embedding);
    db.close();
  });

  afterAll(() => {
    restore();
    delete process.env.TEST_DB_PATH;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function run(...flags: string[]): string {
    return execFileSync(process.execPath, ['--import', 'tsx', path.join(root, 'src', 'search-cli.ts'), '--text', ...flags, 'zanzibar'], {
      env: { ...process.env, TEST_DB_PATH: path.join(dir, 'test.db'), EPISODIC_MEMORY_CONFIG_DIR: dir },
      encoding: 'utf-8',
    });
  }

  it('shows one exchange per conversation by default and every exchange with the flag', () => {
    expect(run().match(/zanzibar keys rotation/g)?.length).toBe(1);
    expect(run('--all-exchanges').match(/zanzibar keys rotation/g)?.length).toBe(2);
  });
});
