import { describe, it, expect, afterEach } from 'vitest';
import { getApiEnv, shouldSkipReentrantSync } from '../src/summarizer.js';

describe('getApiEnv', () => {
  afterEach(() => {
    delete process.env.EPISODIC_MEMORY_API_BASE_URL;
    delete process.env.EPISODIC_MEMORY_API_TOKEN;
    delete process.env.EPISODIC_MEMORY_API_TIMEOUT_MS;
  });

  it('always sets EPISODIC_MEMORY_SUMMARIZER_GUARD so the SDK subprocess can detect reentrancy (#87)', () => {
    const env = getApiEnv()!;
    expect(env.EPISODIC_MEMORY_SUMMARIZER_GUARD).toBe('1');
  });

  it('routes ANTHROPIC_BASE_URL through to the SDK env when EPISODIC_MEMORY_API_BASE_URL is set', () => {
    process.env.EPISODIC_MEMORY_API_BASE_URL = 'https://example.invalid';
    const env = getApiEnv()!;
    expect(env.ANTHROPIC_BASE_URL).toBe('https://example.invalid');
  });

  it('routes auth token and timeout through to the SDK env', () => {
    process.env.EPISODIC_MEMORY_API_TOKEN = 'tok-test';
    process.env.EPISODIC_MEMORY_API_TIMEOUT_MS = '12345';
    const env = getApiEnv()!;
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('tok-test');
    expect(env.API_TIMEOUT_MS).toBe('12345');
  });
});

describe('shouldSkipReentrantSync', () => {
  afterEach(() => {
    delete process.env.EPISODIC_MEMORY_SUMMARIZER_GUARD;
  });

  it('returns true when EPISODIC_MEMORY_SUMMARIZER_GUARD is set to "1"', () => {
    process.env.EPISODIC_MEMORY_SUMMARIZER_GUARD = '1';
    expect(shouldSkipReentrantSync()).toBe(true);
  });

  it('returns false when the guard env is unset', () => {
    delete process.env.EPISODIC_MEMORY_SUMMARIZER_GUARD;
    expect(shouldSkipReentrantSync()).toBe(false);
  });

  it('returns false when the guard env is set to anything other than "1"', () => {
    process.env.EPISODIC_MEMORY_SUMMARIZER_GUARD = '0';
    expect(shouldSkipReentrantSync()).toBe(false);
    process.env.EPISODIC_MEMORY_SUMMARIZER_GUARD = 'true';
    expect(shouldSkipReentrantSync()).toBe(false);
  });
});
