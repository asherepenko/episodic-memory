import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const rerankScores = vi.fn();

vi.mock('../src/reranker.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/reranker.js')>();
  return { ...actual, rerankScores: (...args: unknown[]) => rerankScores(...args) };
});

const embedding = new Array(384).fill(0).map((_, i) => (i === 0 ? 1 : 0));

describe('search keeps fused ranking when the reranker cannot load', () => {
  let dir: string;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.resetModules();
    rerankScores.mockReset();
    rerankScores.mockRejectedValue(new Error('reranker download failed'));
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'em-rerank-fallback-'));
    process.env.TEST_DB_PATH = path.join(dir, 'test.db');
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { initDatabase, insertExchange } = await import('../src/db.js');
    const db = initDatabase();
    for (const [id, s] of [['x1', 's1'], ['x2', 's2']]) {
      insertExchange(db, {
        id, project: 'p', timestamp: '2026-01-01T00:00:00Z',
        userMessage: `rotate the signing keystore ${id}`, assistantMessage: 'Use the rotation command',
        archivePath: path.join(dir, `${s}.jsonl`), lineStart: 1, lineEnd: 2, sessionId: s,
      } as any, embedding);
    }
    db.close();
  });

  afterEach(() => {
    errSpy.mockRestore();
    delete process.env.TEST_DB_PATH;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns results without throwing, warns once, and does not retry the load', async () => {
    const { searchConversations } = await import('../src/search.js');
    const first = await searchConversations('keystore', { mode: 'text', rerank: true });
    const second = await searchConversations('keystore', { mode: 'text', rerank: true });
    expect(first).toHaveLength(2);
    expect(second).toHaveLength(2);
    expect(rerankScores).toHaveBeenCalledTimes(1);
    const warnings = errSpy.mock.calls.filter(c => String(c[0]).includes('reranker unavailable'));
    expect(warnings).toHaveLength(1);
    expect(String(warnings[0][0])).toContain('reranker download failed');
  });
});
