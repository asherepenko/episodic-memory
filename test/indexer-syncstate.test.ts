import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  openConversationSyncStateStore,
  MAX_ATTEMPTS,
  type SyncState,
} from '../src/sync/conversation-sync-state.js';
import { shouldQueueForSummaryState } from '../src/indexer.js';

/**
 * Phase 3.1: the indexer's queue decision is driven by ConversationSyncState
 * (state.kind + isRetriable), not by fs.existsSync('-summary.txt').
 *
 * These tests exercise the indexer's queue predicate against real sidecar
 * states produced by the filesystem store (temp archive dir via
 * EPISODIC_MEMORY_CONFIG_DIR / explicit archiveDir).
 */

let tmpDir: string;
let archiveDir: string;
let jsonl: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'em-idx-ss-'));
  archiveDir = path.join(tmpDir, 'archive');
  fs.mkdirSync(archiveDir, { recursive: true });
  jsonl = path.join(archiveDir, 'project-x', 'session-abc.jsonl');
  fs.mkdirSync(path.dirname(jsonl), { recursive: true });
  process.env.EPISODIC_MEMORY_CONFIG_DIR = tmpDir;
  delete process.env.EPISODIC_MEMORY_RETRY_ALL;
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.EPISODIC_MEMORY_CONFIG_DIR;
  delete process.env.EPISODIC_MEMORY_RETRY_ALL;
});

describe('indexer queue decision via SyncState', () => {
  it('queues a Pending conversation', () => {
    const store = openConversationSyncStateStore({ archiveDir });
    const state = store.load(jsonl); // no sidecar -> pending
    expect(state.kind).toBe('pending');
    expect(shouldQueueForSummaryState(state)).toBe(true);
  });

  it('queues a Stale conversation', () => {
    const store = openConversationSyncStateStore({ archiveDir });
    store.save(jsonl, { kind: 'complete', lastUpdated: new Date().toISOString() });
    const stale = store.markStale(jsonl);
    expect(stale.kind).toBe('stale');
    expect(shouldQueueForSummaryState(stale)).toBe(true);
  });

  it('skips a Complete conversation (not re-summarized)', () => {
    const store = openConversationSyncStateStore({ archiveDir });
    store.save(jsonl, { kind: 'complete', lastUpdated: new Date().toISOString() });
    const state = store.load(jsonl);
    expect(state.kind).toBe('complete');
    expect(shouldQueueForSummaryState(state)).toBe(false);
  });

  it('skips a Poison conversation before the retry threshold, retries past it', () => {
    const store = openConversationSyncStateStore({ archiveDir });

    // Below threshold: retriable but kind === poison -> still queued (will retry).
    const belowThreshold: SyncState = {
      kind: 'poison',
      attempts: 1,
      lastError: 'boom',
      lastAttempt: new Date().toISOString(),
    };
    expect(shouldQueueForSummaryState(belowThreshold)).toBe(true);

    // At/over threshold: not retriable -> skipped.
    const atThreshold: SyncState = {
      kind: 'poison',
      attempts: MAX_ATTEMPTS,
      lastError: 'boom',
      lastAttempt: new Date().toISOString(),
    };
    expect(shouldQueueForSummaryState(atThreshold)).toBe(false);
  });

  it('records failure as poison via the store (no __ERRORED__ sentinel)', () => {
    const store = openConversationSyncStateStore({ archiveDir });
    const after = store.recordFailure(jsonl, 'kaboom');
    expect(after.kind).toBe('poison');

    // The summary sentinel file must NOT be written on failure.
    const summaryPath = jsonl.replace('.jsonl', '-summary.txt');
    expect(fs.existsSync(summaryPath)).toBe(false);

    // The sidecar is the authority; re-loading sees poison.
    const reloaded = store.load(jsonl);
    expect(reloaded.kind).toBe('poison');
  });

  it('migrates a legacy -summary.txt into Complete (no re-queue)', () => {
    const summaryPath = jsonl.replace('.jsonl', '-summary.txt');
    fs.writeFileSync(jsonl, 'data', 'utf-8');
    fs.writeFileSync(summaryPath, 'real summary content', 'utf-8');

    const store = openConversationSyncStateStore({ archiveDir });
    const state = store.load(jsonl); // migrate path: readLegacySummary -> complete
    expect(state.kind).toBe('complete');
    expect(shouldQueueForSummaryState(state)).toBe(false);
  });
});
