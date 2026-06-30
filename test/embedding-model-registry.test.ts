import { describe, it, expect, vi } from 'vitest';
import { resolveEmbeddingModel, EMBEDDING_MODELS, BGE_QUERY_PREFIX } from '../src/embeddings.js';

describe('embedding model registry', () => {
  it('resolves a known key to its model', () => {
    const e5 = resolveEmbeddingModel('multilingual-e5-small');
    expect(e5.modelId).toBe('Xenova/multilingual-e5-small');
    expect(e5.version).toBe(2);
    expect(e5.queryPrefix).toBe('query: ');
    expect(e5.passagePrefix).toBe('passage: ');
  });

  it('defaults to bge-small-en when no key is given', () => {
    const def = resolveEmbeddingModel(undefined);
    expect(def.key).toBe('bge-small-en');
    expect(def.version).toBe(1);
    expect(def.queryPrefix).toBe(BGE_QUERY_PREFIX);
    expect(def.passagePrefix).toBe('');
  });

  it('falls back to the default (with a warning) on an unknown key', () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = resolveEmbeddingModel('does-not-exist');
    expect(result.key).toBe('bge-small-en');
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toContain('does-not-exist');
    warn.mockRestore();
  });

  it('every registered model is 384-d with a unique version', () => {
    const models = Object.values(EMBEDDING_MODELS);
    expect(models.length).toBeGreaterThanOrEqual(2);
    for (const m of models) expect(m.dimensions).toBe(384);
    const versions = models.map(m => m.version);
    expect(new Set(versions).size).toBe(versions.length);
    // The registry key must match the model's own key field.
    for (const [key, m] of Object.entries(EMBEDDING_MODELS)) expect(m.key).toBe(key);
  });
});
