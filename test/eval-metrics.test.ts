import { describe, it, expect } from 'vitest';
import { rankOfGold, summarize, splitOf } from '../scripts/eval-search/metrics.js';

describe('eval metrics', () => {
  it('ranks the first result from the gold session, 1-based', () => {
    expect(rankOfGold(['a', 'b', 'gold', 'gold'], 'gold')).toBe(3);
    expect(rankOfGold(['a', 'b'], 'gold')).toBeNull();
    expect(rankOfGold([undefined, 'gold'], 'gold')).toBe(2);
  });

  it('computes R@5, R@10 and MRR, a miss counting as 0', () => {
    const s = summarize([1, 5, 6, null]);
    expect(s.n).toBe(4);
    expect(s.r5).toBeCloseTo(0.5);
    expect(s.r10).toBeCloseTo(0.75);
    expect(s.mrr).toBeCloseTo((1 + 1 / 5 + 1 / 6) / 4);
  });

  it('summarizes an empty set as zeros, not NaN', () => {
    expect(summarize([])).toEqual({ n: 0, r5: 0, r10: 0, mrr: 0 });
  });

  it('splits questions deterministically, about 30% dev', () => {
    const ids = Array.from({ length: 1000 }, (_, i) => `q${i}`);
    const dev = ids.filter(id => splitOf(id) === 'dev').length;
    expect(dev).toBeGreaterThan(250);
    expect(dev).toBeLessThan(350);
    expect(ids.map(splitOf)).toEqual(ids.map(splitOf));
  });
});
