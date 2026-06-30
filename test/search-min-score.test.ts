import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { indexUnprocessed } from '../src/indexer.js';
import { searchConversations } from '../src/search.js';
import { suppressConsole } from './test-utils.js';

function makeExchangeLines(seq: number, sessionId: string, topic: string): string {
  const userUuid = `u-${seq}`;
  const ts = new Date(2026, 0, 1 + seq).toISOString();
  const user = JSON.stringify({
    parentUuid: null, isSidechain: false, userType: 'external', cwd: '/p',
    sessionId, version: '2.0.9', gitBranch: 'main', type: 'user',
    message: { role: 'user', content: `Question about ${topic}` }, uuid: userUuid, timestamp: ts,
  });
  const assistant = JSON.stringify({
    parentUuid: userUuid, isSidechain: false, userType: 'external', cwd: '/p',
    sessionId, version: '2.0.9', gitBranch: 'main', type: 'assistant',
    message: { model: 'claude-sonnet-4-5', role: 'assistant', content: [{ type: 'text', text: `Answer about ${topic}` }] },
    uuid: `a-${seq}`, timestamp: ts,
  });
  return user + '\n' + assistant + '\n';
}

describe('search --min-score / minScore', () => {
  let testDir: string;
  let restoreConsole: () => void;

  beforeEach(async () => {
    testDir = mkdtempSync(join(tmpdir(), 'em-minscore-'));
    const projectsDir = join(testDir, 'projects');
    const project = join(projectsDir, 'proj');
    mkdirSync(project, { recursive: true });
    mkdirSync(join(testDir, 'config'), { recursive: true });

    process.env.TEST_PROJECTS_DIR = projectsDir;
    process.env.TEST_ARCHIVE_DIR = join(testDir, 'archive');
    process.env.EPISODIC_MEMORY_CONFIG_DIR = join(testDir, 'config');
    process.env.TEST_DB_PATH = join(testDir, 'test.db');
    restoreConsole = suppressConsole();

    // Distinct topics so similarities to a given query genuinely vary.
    writeFileSync(join(project, 's1.jsonl'), makeExchangeLines(1, 's1', 'database authentication and login security'), 'utf-8');
    writeFileSync(join(project, 's2.jsonl'), makeExchangeLines(2, 's2', 'baking sourdough bread at home'), 'utf-8');
    writeFileSync(join(project, 's3.jsonl'), makeExchangeLines(3, 's3', 'training a puppy to sit'), 'utf-8');

    await indexUnprocessed(1, true);
  });

  afterEach(() => {
    restoreConsole();
    delete process.env.TEST_PROJECTS_DIR;
    delete process.env.TEST_ARCHIVE_DIR;
    delete process.env.EPISODIC_MEMORY_CONFIG_DIR;
    delete process.env.TEST_DB_PATH;
    try { rmSync(testDir, { recursive: true, force: true }); } catch {}
  });

  it('minScore=0 is equivalent to no threshold', async () => {
    const all = await searchConversations('authentication', { mode: 'vector', limit: 10 });
    const zero = await searchConversations('authentication', { mode: 'vector', limit: 10, minScore: 0 });
    expect(zero.length).toBe(all.length);
    expect(all.length).toBeGreaterThan(1);
  });

  it('drops vector matches below the threshold (cutoff above the weakest)', async () => {
    const all = await searchConversations('authentication', { mode: 'vector', limit: 10 });
    const sims = all.map(r => r.similarity!).sort((a, b) => a - b);
    // Cut just above the weakest match — it must be excluded, the strongest kept.
    const cutoff = sims[0] + (sims[sims.length - 1] - sims[0]) / 2;

    const filtered = await searchConversations('authentication', { mode: 'vector', limit: 10, minScore: cutoff });
    expect(filtered.length).toBeLessThan(all.length);
    for (const r of filtered) {
      expect(r.similarity!).toBeGreaterThanOrEqual(cutoff);
    }
  });

  it('a threshold above the strongest match yields nothing', async () => {
    const all = await searchConversations('authentication', { mode: 'vector', limit: 10 });
    const max = Math.max(...all.map(r => r.similarity!));
    const filtered = await searchConversations('authentication', { mode: 'vector', limit: 10, minScore: Math.min(1, max + 0.001) });
    expect(filtered.length).toBe(0);
  });

  it('keeps text-only matches regardless of threshold (no similarity to compare)', async () => {
    const text = await searchConversations('authentication', { mode: 'text', limit: 10 });
    const textFiltered = await searchConversations('authentication', { mode: 'text', limit: 10, minScore: 0.99 });
    expect(textFiltered.length).toBe(text.length);
  });
});
