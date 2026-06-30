import { describe, it, expect, afterEach } from 'vitest';
import { testTimeoutMs } from './test-utils.js';

describe('testTimeoutMs', () => {
  const ENV = 'EPISODIC_MEMORY_TEST_TIMEOUT_MS';
  afterEach(() => { delete process.env[ENV]; });

  it('returns the fallback when the env var is unset', () => {
    delete process.env[ENV];
    expect(testTimeoutMs(60000)).toBe(60000);
  });

  it('raises the timeout when the override is larger', () => {
    process.env[ENV] = '180000';
    expect(testTimeoutMs(60000)).toBe(180000);
  });

  it('never shortens below the per-test fallback', () => {
    process.env[ENV] = '1000';
    expect(testTimeoutMs(60000)).toBe(60000);
  });

  it('ignores a non-numeric or non-positive override', () => {
    process.env[ENV] = 'soon';
    expect(testTimeoutMs(60000)).toBe(60000);
    process.env[ENV] = '0';
    expect(testTimeoutMs(60000)).toBe(60000);
  });
});
