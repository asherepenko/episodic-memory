import { describe, it, expect } from 'vitest';
import { resolveEmbedThreads, EmbeddingUnavailableError } from '../src/embeddings.js';

describe('resolveEmbedThreads', () => {
  it('defaults to half the cores, at least 1 and at most 4', () => {
    expect(resolveEmbedThreads({}, 1)).toBe(1);
    expect(resolveEmbedThreads({}, 2)).toBe(1);
    expect(resolveEmbedThreads({}, 4)).toBe(2);
    expect(resolveEmbedThreads({}, 8)).toBe(4);
    expect(resolveEmbedThreads({}, 64)).toBe(4);
  });

  it('honours a positive integer override, even above the default cap', () => {
    expect(resolveEmbedThreads({ EPISODIC_MEMORY_EMBED_THREADS: '6' }, 8)).toBe(6);
    expect(resolveEmbedThreads({ EPISODIC_MEMORY_EMBED_THREADS: '1' }, 64)).toBe(1);
  });

  it('ignores invalid overrides', () => {
    for (const bad of ['', '0', '-2', '2.5', 'abc', ' ']) {
      expect(resolveEmbedThreads({ EPISODIC_MEMORY_EMBED_THREADS: bad }, 8)).toBe(4);
    }
  });

  it('treats a missing or nonsensical core count as one core', () => {
    expect(resolveEmbedThreads({}, 0)).toBe(1);
    expect(resolveEmbedThreads({}, Number.NaN)).toBe(1);
  });
});

describe('EmbeddingUnavailableError', () => {
  it('carries the root cause message', () => {
    const err = new EmbeddingUnavailableError(new Error('onnxruntime missing'));
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('EmbeddingUnavailableError');
    expect(err.message).toContain('onnxruntime missing');
    expect((err.cause as Error).message).toBe('onnxruntime missing');
  });
});
