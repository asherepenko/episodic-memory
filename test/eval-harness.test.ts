import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { indexUnprocessed } from '../src/indexer.js';
import { evaluate, report } from '../scripts/eval-search/run.js';
import { summarize } from '../scripts/eval-search/metrics.js';
import { suppressConsole } from './test-utils.js';

const fixtureDir = join(__dirname, '..', 'scripts', 'eval-search', 'fixture');

function transcript(seq: number, sessionId: string, user: string, assistant: string): string {
  const ts = new Date(2026, 0, 1 + seq).toISOString();
  const base = { parentUuid: null, isSidechain: false, userType: 'external', cwd: '/p', sessionId, version: '2.0.9', gitBranch: 'main' };
  return [
    JSON.stringify({ ...base, type: 'user', message: { role: 'user', content: user }, uuid: `u-${seq}`, timestamp: ts }),
    JSON.stringify({ ...base, parentUuid: `u-${seq}`, type: 'assistant', message: { model: 'm', role: 'assistant', content: [{ type: 'text', text: assistant }] }, uuid: `a-${seq}`, timestamp: ts }),
  ].join('\n') + '\n';
}

describe('retrieval eval harness on the committed fixture', () => {
  let testDir: string;
  let restore: () => void;

  beforeAll(async () => {
    testDir = mkdtempSync(join(tmpdir(), 'em-eval-'));
    const project = join(testDir, 'projects', 'proj');
    mkdirSync(project, { recursive: true });
    mkdirSync(join(testDir, 'config'), { recursive: true });
    process.env.TEST_PROJECTS_DIR = join(testDir, 'projects');
    process.env.TEST_ARCHIVE_DIR = join(testDir, 'archive');
    process.env.EPISODIC_MEMORY_CONFIG_DIR = join(testDir, 'config');
    process.env.TEST_DB_PATH = join(testDir, 'test.db');
    restore = suppressConsole();
    const sessions = JSON.parse(readFileSync(join(fixtureDir, 'sessions.json'), 'utf-8')) as Array<{ session: string; user: string; assistant: string }>;
    sessions.forEach((s, i) => writeFileSync(join(project, `${s.session}.jsonl`), transcript(i + 1, s.session, s.user, s.assistant)));
    await indexUnprocessed(1, true);
  });

  afterAll(() => {
    restore();
    delete process.env.TEST_PROJECTS_DIR;
    delete process.env.TEST_ARCHIVE_DIR;
    delete process.env.EPISODIC_MEMORY_CONFIG_DIR;
    delete process.env.TEST_DB_PATH;
    rmSync(testDir, { recursive: true, force: true });
  });

  it('finds every fixture question within the top 5 and reports both splits', async () => {
    const questions = readFileSync(join(fixtureDir, 'questions.jsonl'), 'utf-8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const rows = await evaluate(questions, { rerank: false });
    expect(rows).toHaveLength(6);
    expect(summarize(rows.map(r => r.rank)).r5).toBe(1);
    const text = report('fixture', rows);
    expect(text).toContain('dev');
    expect(text).toContain('heldout');
  });
});
