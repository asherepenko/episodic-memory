import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isRerankEnabled, rerankScores } from '../src/reranker.js';

describe('isRerankEnabled', () => {
  let prev: string | undefined;
  beforeEach(() => { prev = process.env.EPISODIC_MEMORY_RERANK; });
  afterEach(() => {
    if (prev === undefined) delete process.env.EPISODIC_MEMORY_RERANK;
    else process.env.EPISODIC_MEMORY_RERANK = prev;
  });

  it('an explicit flag wins over the env var', () => {
    process.env.EPISODIC_MEMORY_RERANK = '1';
    expect(isRerankEnabled(false)).toBe(false);
    delete process.env.EPISODIC_MEMORY_RERANK;
    expect(isRerankEnabled(true)).toBe(true);
  });

  it('falls back to the env switch when no flag is given', () => {
    delete process.env.EPISODIC_MEMORY_RERANK;
    expect(isRerankEnabled(undefined)).toBe(false);
    process.env.EPISODIC_MEMORY_RERANK = '1';
    expect(isRerankEnabled(undefined)).toBe(true);
    process.env.EPISODIC_MEMORY_RERANK = 'true';
    expect(isRerankEnabled(undefined)).toBe(true);
    process.env.EPISODIC_MEMORY_RERANK = '0';
    expect(isRerankEnabled(undefined)).toBe(false);
  });
});

describe('rerankScores (cross-encoder)', () => {
  it('scores a relevant passage above an irrelevant one', async () => {
    const scores = await rerankScores('how do I fix the login authentication token bug', [
      'Debugging the auth token expiry check in the login middleware',
      'A recipe for baking sourdough bread at home',
    ]);
    expect(scores).toHaveLength(2);
    expect(scores[0]).toBeGreaterThan(scores[1]);
  }, 60000);

  it('returns an empty array for no passages', async () => {
    expect(await rerankScores('anything', [])).toEqual([]);
  });
});
