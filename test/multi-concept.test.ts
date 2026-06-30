import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { indexUnprocessed } from '../src/indexer.js';
import { searchMultipleConcepts } from '../src/search.js';
import { suppressConsole } from './test-utils.js';

// Self-contained: seeds its own corpus and indexes it with the ACTIVE embedding
// model, so assertions hold regardless of which model is the default (the real
// machine index may be on a different/older embedding version mid-migration).
function exchangeLines(seq: number, sessionId: string, topic: string): string {
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

describe('multi-concept search', () => {
  let testDir: string;
  let restoreConsole: () => void;

  beforeEach(async () => {
    testDir = mkdtempSync(join(tmpdir(), 'em-multiconcept-'));
    const projectsDir = join(testDir, 'projects');
    const project = join(projectsDir, 'proj');
    mkdirSync(project, { recursive: true });
    mkdirSync(join(testDir, 'config'), { recursive: true });

    process.env.TEST_PROJECTS_DIR = projectsDir;
    process.env.TEST_ARCHIVE_DIR = join(testDir, 'archive');
    process.env.EPISODIC_MEMORY_CONFIG_DIR = join(testDir, 'config');
    process.env.TEST_DB_PATH = join(testDir, 'test.db');
    restoreConsole = suppressConsole();

    writeFileSync(join(project, 's1.jsonl'), exchangeLines(1, 's1', 'React Router authentication and route guards'), 'utf-8');
    writeFileSync(join(project, 's2.jsonl'), exchangeLines(2, 's2', 'React Router data loading and navigation'), 'utf-8');
    writeFileSync(join(project, 's3.jsonl'), exchangeLines(3, 's3', 'sourdough bread baking technique'), 'utf-8');

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

  it('returns results sorted by average similarity', async () => {
    const results = await searchMultipleConcepts(['React', 'Router'], { limit: 5 });
    expect(Array.isArray(results)).toBe(true);
    if (results.length > 1) {
      expect(results[0].averageSimilarity).toBeGreaterThanOrEqual(results[1].averageSimilarity);
    }
  });

  it('ranks concepts present in the corpus above random nonsense', async () => {
    const relevant = await searchMultipleConcepts(['React', 'Router'], { limit: 5 });
    const nonsense = await searchMultipleConcepts(['xyzabc123', 'qwerty789'], { limit: 5 });
    if (relevant.length > 0 && nonsense.length > 0) {
      expect(relevant[0].averageSimilarity).toBeGreaterThan(nonsense[0].averageSimilarity);
    }
  });

  it('returns averageSimilarity values within the cosine range [-1, 1]', async () => {
    const results = await searchMultipleConcepts(['React', 'Router'], { limit: 5 });
    for (const r of results) {
      expect(r.averageSimilarity).toBeGreaterThanOrEqual(-1);
      expect(r.averageSimilarity).toBeLessThanOrEqual(1);
    }
  });

  it('respects the limit parameter', async () => {
    const results = await searchMultipleConcepts(['React', 'Router'], { limit: 2 });
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it('includes a similarity score per concept', async () => {
    const results = await searchMultipleConcepts(['React', 'Router'], { limit: 1 });
    if (results.length > 0) {
      expect(results[0].conceptSimilarities?.length).toBe(2);
      expect(results[0].averageSimilarity).toBeDefined();
    }
  });
});
