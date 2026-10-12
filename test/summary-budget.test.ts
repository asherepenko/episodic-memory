import { describe, expect, it } from 'vitest';
import { DEFAULT_SUMMARY_LIMIT, orderNewestFirst, resolveSummaryBudgetMs } from '../src/sync/sync.js';

// 10 summaries per run in A–Z project order left 61% of conversations
// uncaptioned and summarized old dotfiles sessions before yesterday's work.
// Now: newest first, up to 50, stopping once a time budget is spent.
describe('summary queue order', () => {
  it('puts the most recently modified conversations first', () => {
    const mtimes: Record<string, number> = { a: 100, b: 300, c: 200 };
    const files = ['a', 'b', 'c'].map(path => ({ path }));
    expect(orderNewestFirst(files, p => mtimes[p]).map(f => f.path)).toEqual(['b', 'c', 'a']);
  });

  it('sends files it cannot stat to the back instead of throwing', () => {
    const files = ['gone', 'here'].map(path => ({ path }));
    const mtime = (p: string) => (p === 'gone' ? undefined : 5);
    expect(orderNewestFirst(files, mtime).map(f => f.path)).toEqual(['here', 'gone']);
  });

  it('caps a run at 50 by default', () => {
    expect(DEFAULT_SUMMARY_LIMIT).toBe(50);
  });
});

describe('resolveSummaryBudgetMs', () => {
  it('defaults to 5 minutes', () => {
    expect(resolveSummaryBudgetMs(undefined, undefined)).toBe(300_000);
  });

  it('reads EPISODIC_MEMORY_SUMMARY_BUDGET_SEC in seconds', () => {
    expect(resolveSummaryBudgetMs(undefined, '60')).toBe(60_000);
  });

  it('treats 0 as no budget', () => {
    expect(resolveSummaryBudgetMs(undefined, '0')).toBe(Infinity);
  });

  it('lets the option win over the env var', () => {
    expect(resolveSummaryBudgetMs(Infinity, '60')).toBe(Infinity);
    expect(resolveSummaryBudgetMs(1_000, '60')).toBe(1_000);
  });

  it('falls back to the default on a non-numeric env value', () => {
    expect(resolveSummaryBudgetMs(undefined, 'soon')).toBe(300_000);
  });
});
