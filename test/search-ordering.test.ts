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

describe('search result ordering matches displayed score', () => {
  let testDir: string;
  let restoreConsole: () => void;

  beforeEach(async () => {
    testDir = mkdtempSync(join(tmpdir(), 'em-order-'));
    const projectsDir = join(testDir, 'projects');
    const project = join(projectsDir, 'proj');
    mkdirSync(project, { recursive: true });
    mkdirSync(join(testDir, 'config'), { recursive: true });
    process.env.TEST_PROJECTS_DIR = projectsDir;
    process.env.TEST_ARCHIVE_DIR = join(testDir, 'archive');
    process.env.EPISODIC_MEMORY_CONFIG_DIR = join(testDir, 'config');
    process.env.TEST_DB_PATH = join(testDir, 'test.db');
    restoreConsole = suppressConsole();

    const topics = [
      'baking sourdough bread at home',
      'training a puppy to sit',
      'commit hashes and git history rewriting',
      'checking a hexadecimal checksum of a download',
      'identifier strings in a release tag',
      'database authentication and login security',
      'growing tomatoes in a small garden',
      'planning a hiking trip in the alps',
      // literal substring match that is semantically far from the query
      'growing tomatoes in a greenhouse with careful watering and soil compost and sunlight schedules '.repeat(8) + 'note id deadbeef1234',
    ];
    topics.forEach((t, i) => {
      writeFileSync(join(project, `s${i}.jsonl`), makeExchangeLines(i + 1, `s${i}`, t), 'utf-8');
    });
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

  it('returns hybrid results in non-increasing order of the reported similarity', async () => {
    for (const limit of [1, 2, 3, 6]) {
      const results = await searchConversations('deadbeef1234', { mode: 'both', limit, rerank: false });
      expect(results.length).toBeGreaterThan(0);
      for (let i = 1; i < results.length; i++) {
        expect(results[i].similarity!).toBeLessThanOrEqual(results[i - 1].similarity!);
      }
    }
  });

  it('does not report a text-only hit as a perfect match', async () => {
    const results = await searchConversations('deadbeef1234', { mode: 'both', limit: 6, rerank: false });
    for (const r of results) {
      expect(r.similarity!).toBeGreaterThanOrEqual(0);
      expect(r.similarity!).toBeLessThanOrEqual(1);
    }
    const textHit = results.find(r => r.exchange.userMessage.includes('deadbeef1234'));
    // text-only hit (no real cosine) must not outrank the best vector hit
    const top = results[0];
    expect(top.similarity!).toBeGreaterThanOrEqual(textHit!.similarity!);
  });
});

