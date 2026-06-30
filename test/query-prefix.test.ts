import { describe, it, expect } from 'vitest';
import { BGE_QUERY_PREFIX, withQueryPrefix, resolveEmbeddingModel } from '../src/embeddings.js';

// withQueryPrefix applies the *active* model's query prefix (resolved from the
// environment at load). These tests track that active default rather than
// hardcoding a model, so a default-model change doesn't silently break them.
const activePrefix = resolveEmbeddingModel(process.env.EPISODIC_MEMORY_EMBED_MODEL).queryPrefix;

describe('query prefix', () => {
  it('exports the official BGE retrieval prefix constant', () => {
    expect(BGE_QUERY_PREFIX).toBe('Represent this sentence for searching relevant passages: ');
  });

  it('prepends the active model query prefix to a query string', () => {
    expect(withQueryPrefix('how do I fix the auth bug')).toBe(activePrefix + 'how do I fix the auth bug');
  });

  it('is idempotent on already-prefixed inputs', () => {
    const already = activePrefix + 'something';
    expect(withQueryPrefix(already)).toBe(already);
  });
});
