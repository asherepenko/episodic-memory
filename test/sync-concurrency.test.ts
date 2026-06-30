import { describe, expect, it } from 'vitest';
import { resolveSummaryConcurrency } from '../src/sync/sync.js';

// The `sync` command resolves its parallel-summary-worker count from three
// sources, in order: the explicit --concurrency flag (passed as the option),
// then the EPISODIC_MEMORY_CONCURRENCY env var, then a default of 2.
describe('resolveSummaryConcurrency precedence', () => {
  it('uses the explicit option when set, ignoring the env var', () => {
    expect(resolveSummaryConcurrency(8, '4')).toBe(8);
  });

  it('falls back to the env var when no option is given', () => {
    expect(resolveSummaryConcurrency(undefined, '4')).toBe(4);
  });

  it('defaults to 2 when neither option nor env is set', () => {
    expect(resolveSummaryConcurrency(undefined, undefined)).toBe(2);
  });

  it('defaults to 2 when the env var is non-numeric', () => {
    expect(resolveSummaryConcurrency(undefined, 'nonsense')).toBe(2);
  });

  it('ignores a non-positive option and falls through to the env var', () => {
    expect(resolveSummaryConcurrency(0, '4')).toBe(4);
    expect(resolveSummaryConcurrency(-3, '4')).toBe(4);
  });

  it('ignores a non-positive env value and falls through to the default', () => {
    expect(resolveSummaryConcurrency(undefined, '0')).toBe(2);
    expect(resolveSummaryConcurrency(undefined, '-1')).toBe(2);
  });
});
