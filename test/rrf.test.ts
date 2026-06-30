import { describe, it, expect } from 'vitest';
import { reciprocalRankFusion } from '../src/search.js';

describe('reciprocalRankFusion', () => {
  it('ranks an item appearing in both lists above items in only one', () => {
    const vec = [{ id: 'A' }, { id: 'B' }, { id: 'C' }];
    const text = [{ id: 'B' }, { id: 'D' }];
    const fused = reciprocalRankFusion([vec, text], 10);
    // B is in both lists at high ranks → top.
    expect(fused[0].id).toBe('B');
    expect(fused.map(r => r.id)).toEqual(['B', 'A', 'D', 'C']);
  });

  it('deduplicates by id', () => {
    const fused = reciprocalRankFusion([[{ id: 'X' }], [{ id: 'X' }]], 10);
    expect(fused).toHaveLength(1);
    expect(fused[0].id).toBe('X');
  });

  it('keeps the row object from the first (highest-authority) list', () => {
    const vec = [{ id: 'X', src: 'vector', distance: 0.2 }];
    const text = [{ id: 'X', src: 'text', distance: 0 }];
    const [row] = reciprocalRankFusion([vec, text], 10);
    expect(row.src).toBe('vector');
  });

  it('respects the limit', () => {
    const list = [{ id: 'A' }, { id: 'B' }, { id: 'C' }, { id: 'D' }];
    expect(reciprocalRankFusion([list], 2)).toHaveLength(2);
  });

  it('a smaller k sharpens the gap between ranks', () => {
    const list = [{ id: 'A' }, { id: 'B' }];
    // With k=0, rank-1 score is 1/1 vs rank-2 1/2 — a large gap; ordering stable.
    const fused = reciprocalRankFusion([list], 10, 0);
    expect(fused.map(r => r.id)).toEqual(['A', 'B']);
  });
});
