import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const initEmbeddings = vi.fn();

vi.mock('../src/embeddings.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/embeddings.js')>();
  return {
    ...actual,
    initEmbeddings: (...args: unknown[]) => initEmbeddings(...args),
    generateQueryEmbedding: async () => { throw new Error('should not embed after init failure'); },
  };
});

const embedding = new Array(384).fill(0).map((_, i) => (i === 0 ? 1 : 0));

describe('search falls back to BM25 when the embedding backend cannot load', () => {
  let dir: string;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.resetModules();
    const { EmbeddingUnavailableError } = await import('../src/embeddings.js');
    initEmbeddings.mockReset();
    initEmbeddings.mockRejectedValue(new EmbeddingUnavailableError(new Error('onnxruntime missing')));
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'em-fallback-'));
    process.env.TEST_DB_PATH = path.join(dir, 'test.db');
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { initDatabase, insertExchange } = await import('../src/db.js');
    const db = initDatabase();
    insertExchange(db, {
      id: 'x1', project: 'p', timestamp: '2026-01-01T00:00:00Z',
      userMessage: 'how do I rotate the signing keystore', assistantMessage: 'Use the rotation command',
      archivePath: path.join(dir, 's1.jsonl'), lineStart: 1, lineEnd: 2, sessionId: 's1',
    } as any, embedding);
    db.close();
  });

  afterEach(() => {
    errSpy.mockRestore();
    delete process.env.TEST_DB_PATH;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns text results without throwing and tries to load the model once', async () => {
    const { searchConversations } = await import('../src/search.js');
    const first = await searchConversations('keystore', { mode: 'both', rerank: false });
    const second = await searchConversations('keystore', { mode: 'vector', rerank: false });
    expect(first.map(r => r.exchange.id)).toEqual(['x1']);
    expect(second.map(r => r.exchange.id)).toEqual(['x1']);
    expect(initEmbeddings).toHaveBeenCalledTimes(1);
    const warnings = errSpy.mock.calls.filter(c => String(c[0]).includes('semantic search unavailable'));
    expect(warnings).toHaveLength(1);
    expect(String(warnings[0][0])).toContain('onnxruntime missing');
  });

  it('notes the fallback in formatted output', async () => {
    const { searchConversations, formatResults } = await import('../src/search.js');
    const results = await searchConversations('keystore', { rerank: false });
    const out = await formatResults(results);
    expect(out).toContain('keyword (BM25) search');
  });

  it('multi-concept search does not throw', async () => {
    const { searchMultipleConcepts } = await import('../src/search.js');
    await expect(searchMultipleConcepts(['keystore', 'rotation'], {})).resolves.toBeDefined();
    expect(initEmbeddings).toHaveBeenCalledTimes(1);
  });
});
