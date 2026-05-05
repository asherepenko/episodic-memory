import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  loadState,
  saveState,
  shouldSkipFailed,
  recordFailure,
  clearFailure,
  countSkippedPoisonPills,
  MAX_ATTEMPTS,
} from '../src/sync-state.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'em-state-'));
  process.env.EPISODIC_MEMORY_CONFIG_DIR = tmpDir;
  delete process.env.EPISODIC_MEMORY_RETRY_ALL;
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.EPISODIC_MEMORY_CONFIG_DIR;
  delete process.env.EPISODIC_MEMORY_RETRY_ALL;
});

describe('sync-state', () => {
  it('loads empty state when file missing', () => {
    const s = loadState();
    expect(s.failures).toEqual({});
  });

  it('records failures and persists across loads', () => {
    const s = loadState();
    recordFailure(s, '/a.jsonl', 'timeout');
    saveState(s);

    const s2 = loadState();
    expect(s2.failures['/a.jsonl'].attempts).toBe(1);
    expect(s2.failures['/a.jsonl'].lastError).toBe('timeout');
  });

  it('marks file as skip-worthy after MAX_ATTEMPTS failures', () => {
    const s = loadState();
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      recordFailure(s, '/a.jsonl', 'timeout');
    }
    expect(shouldSkipFailed(s, '/a.jsonl')).toBe(true);
    expect(countSkippedPoisonPills(s)).toBe(1);
  });

  it('does not skip below MAX_ATTEMPTS', () => {
    const s = loadState();
    recordFailure(s, '/a.jsonl', 'timeout');
    expect(shouldSkipFailed(s, '/a.jsonl')).toBe(false);
  });

  it('clears failure on success', () => {
    const s = loadState();
    recordFailure(s, '/a.jsonl', 'timeout');
    clearFailure(s, '/a.jsonl');
    expect(shouldSkipFailed(s, '/a.jsonl')).toBe(false);
    expect(s.failures['/a.jsonl']).toBeUndefined();
  });

  it('EPISODIC_MEMORY_RETRY_ALL forces empty state load', () => {
    const s = loadState();
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      recordFailure(s, '/a.jsonl', 'timeout');
    }
    saveState(s);

    process.env.EPISODIC_MEMORY_RETRY_ALL = '1';
    const fresh = loadState();
    expect(fresh.failures).toEqual({});
  });
});
