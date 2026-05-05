import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  openConversationSyncStateStore,
  openMemoryConversationSyncStateStore,
  sidecarPathFor,
  isRetriable,
  MAX_ATTEMPTS,
  type ConversationSyncStateStore,
  type SyncState,
} from '../src/sync/conversation-sync-state.js';

let tmpDir: string;
let archiveDir: string;
let jsonl: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'em-css-'));
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

describe('conversation-sync-state: pending + state-machine basics', () => {
  it('returns pending when no sidecar, partial, summary, or global state exists', () => {
    const store = openConversationSyncStateStore({ archiveDir });
    expect(store.load(jsonl)).toEqual({ kind: 'pending' });
  });

  it('sidecarPathFor swaps .jsonl for .sync.json', () => {
    expect(sidecarPathFor(jsonl)).toBe(
      path.join(archiveDir, 'project-x', 'session-abc.sync.json')
    );
  });

  it('round-trips inProgress state', () => {
    const store = openConversationSyncStateStore({ archiveDir });
    const state: SyncState = {
      kind: 'inProgress',
      chunkSummaries: ['c1', 'c2'],
      totalChunks: 5,
      totalExchanges: 42,
      lastUpdated: '2026-05-05T13:22:53Z',
    };
    store.save(jsonl, state);
    expect(store.load(jsonl)).toEqual(state);
  });

  it('round-trips complete state', () => {
    const store = openConversationSyncStateStore({ archiveDir });
    const state: SyncState = { kind: 'complete', lastUpdated: '2026-05-05T13:22:53Z' };
    store.save(jsonl, state);
    expect(store.load(jsonl)).toEqual(state);
  });

  it('round-trips stale state', () => {
    const store = openConversationSyncStateStore({ archiveDir });
    const state: SyncState = { kind: 'stale', lastUpdated: '2026-05-05T13:22:53Z' };
    store.save(jsonl, state);
    expect(store.load(jsonl)).toEqual(state);
  });

  it('round-trips poison state', () => {
    const store = openConversationSyncStateStore({ archiveDir });
    const state: SyncState = {
      kind: 'poison',
      attempts: 2,
      lastError: 'timeout',
      lastAttempt: '2026-05-05T13:22:53Z',
    };
    store.save(jsonl, state);
    expect(store.load(jsonl)).toEqual(state);
  });

  it('markStale transitions complete to stale', () => {
    const store = openConversationSyncStateStore({ archiveDir });
    store.save(jsonl, { kind: 'complete', lastUpdated: '2026-05-05T00:00:00Z' });
    store.markStale(jsonl);
    const after = store.load(jsonl);
    expect(after.kind).toBe('stale');
  });

  it('markStale is a no-op for pending', () => {
    const store = openConversationSyncStateStore({ archiveDir });
    store.markStale(jsonl);
    expect(store.load(jsonl)).toEqual({ kind: 'pending' });
  });

  it('markStale is a no-op for inProgress', () => {
    const store = openConversationSyncStateStore({ archiveDir });
    const inProgress: SyncState = {
      kind: 'inProgress',
      chunkSummaries: ['x'],
      totalChunks: 3,
      totalExchanges: 10,
      lastUpdated: '2026-05-05T00:00:00Z',
    };
    store.save(jsonl, inProgress);
    store.markStale(jsonl);
    expect(store.load(jsonl)).toEqual(inProgress);
  });

  it('markStale is a no-op for poison', () => {
    const store = openConversationSyncStateStore({ archiveDir });
    const poison: SyncState = {
      kind: 'poison',
      attempts: 1,
      lastError: 'boom',
      lastAttempt: '2026-05-05T00:00:00Z',
    };
    store.save(jsonl, poison);
    store.markStale(jsonl);
    expect(store.load(jsonl)).toEqual(poison);
  });
});

describe('conversation-sync-state: schema validation + atomicity', () => {
  it('returns pending on corrupt JSON', () => {
    const store = openConversationSyncStateStore({ archiveDir });
    fs.writeFileSync(sidecarPathFor(jsonl), '{not json');
    expect(store.load(jsonl)).toEqual({ kind: 'pending' });
  });

  it('returns pending on unknown version', () => {
    const store = openConversationSyncStateStore({ archiveDir });
    fs.writeFileSync(
      sidecarPathFor(jsonl),
      JSON.stringify({ version: 999, kind: 'complete', lastUpdated: 'x' })
    );
    expect(store.load(jsonl)).toEqual({ kind: 'pending' });
  });

  it('returns pending when kind missing', () => {
    const store = openConversationSyncStateStore({ archiveDir });
    fs.writeFileSync(
      sidecarPathFor(jsonl),
      JSON.stringify({ version: 2, lastUpdated: 'x' })
    );
    expect(store.load(jsonl)).toEqual({ kind: 'pending' });
  });

  it('returns pending when only the .tmp file exists (mid-write crash)', () => {
    const store = openConversationSyncStateStore({ archiveDir });
    const sidecar = sidecarPathFor(jsonl);
    fs.writeFileSync(
      sidecar + '.tmp',
      JSON.stringify({ version: 2, kind: 'complete', lastUpdated: 'x' })
    );
    expect(store.load(jsonl)).toEqual({ kind: 'pending' });
  });
});

describe('conversation-sync-state: failure tracking + poison', () => {
  it('recordFailure once yields poison kind, attempts=1, retriable', () => {
    const store = openConversationSyncStateStore({ archiveDir });
    const next = store.recordFailure(jsonl, 'timeout');
    expect(next.kind).toBe('poison');
    if (next.kind !== 'poison') throw new Error('unreachable');
    expect(next.attempts).toBe(1);
    expect(next.lastError).toBe('timeout');
    expect(isRetriable(next)).toBe(true);
  });

  it('recordFailure MAX_ATTEMPTS times yields non-retriable', () => {
    const store = openConversationSyncStateStore({ archiveDir });
    let last: SyncState = { kind: 'pending' };
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      last = store.recordFailure(jsonl, 'timeout');
    }
    expect(last.kind).toBe('poison');
    if (last.kind !== 'poison') throw new Error('unreachable');
    expect(last.attempts).toBe(MAX_ATTEMPTS);
    expect(isRetriable(last)).toBe(false);
  });

  it('clearFailure deletes sidecar and load returns pending', () => {
    const store = openConversationSyncStateStore({ archiveDir });
    store.recordFailure(jsonl, 'timeout');
    expect(fs.existsSync(sidecarPathFor(jsonl))).toBe(true);
    store.clearFailure(jsonl);
    expect(fs.existsSync(sidecarPathFor(jsonl))).toBe(false);
    expect(store.load(jsonl)).toEqual({ kind: 'pending' });
  });

  it('clearFailure is a no-op when no sidecar exists', () => {
    const store = openConversationSyncStateStore({ archiveDir });
    expect(() => store.clearFailure(jsonl)).not.toThrow();
  });

  it('clearFailure leaves non-poison sidecar untouched', () => {
    const store = openConversationSyncStateStore({ archiveDir });
    const complete: SyncState = { kind: 'complete', lastUpdated: '2026-05-05T00:00:00Z' };
    store.save(jsonl, complete);
    store.clearFailure(jsonl);
    expect(store.load(jsonl)).toEqual(complete);
  });

  it('EPISODIC_MEMORY_RETRY_ALL=1 makes load return pending without rewriting sidecar', () => {
    const store = openConversationSyncStateStore({ archiveDir });
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      store.recordFailure(jsonl, 'timeout');
    }
    const sidecar = sidecarPathFor(jsonl);
    const onDiskBefore = fs.readFileSync(sidecar, 'utf-8');

    process.env.EPISODIC_MEMORY_RETRY_ALL = '1';
    expect(store.load(jsonl)).toEqual({ kind: 'pending' });

    const onDiskAfter = fs.readFileSync(sidecar, 'utf-8');
    expect(onDiskAfter).toBe(onDiskBefore);
  });
});

describe('conversation-sync-state: lazy migration', () => {
  it('migrates legacy -summary.partial.json to inProgress', () => {
    const partialPath = jsonl.replace(/\.jsonl$/, '-summary.partial.json');
    fs.writeFileSync(partialPath, JSON.stringify({
      version: 1,
      totalChunks: 5,
      chunkSummaries: ['c1', 'c2'],
      totalExchanges: 42,
      lastUpdated: '2026-05-05T00:00:00Z',
    }));

    const store = openConversationSyncStateStore({ archiveDir });
    const state = store.load(jsonl);
    expect(state).toEqual({
      kind: 'inProgress',
      chunkSummaries: ['c1', 'c2'],
      totalChunks: 5,
      totalExchanges: 42,
      lastUpdated: '2026-05-05T00:00:00Z',
    });

    expect(fs.existsSync(sidecarPathFor(jsonl))).toBe(true);
    expect(fs.existsSync(partialPath)).toBe(true);
  });

  it('migrates legacy global sync-state.json failure to poison', () => {
    const indexDir = path.join(tmpDir, 'conversation-index');
    fs.mkdirSync(indexDir, { recursive: true });
    fs.writeFileSync(path.join(indexDir, 'sync-state.json'), JSON.stringify({
      failures: {
        [jsonl]: {
          attempts: 3,
          lastError: 'rate-limit',
          lastAttempt: '2026-05-05T01:00:00Z',
        },
      },
    }));

    const store = openConversationSyncStateStore({ archiveDir });
    const state = store.load(jsonl);
    expect(state).toEqual({
      kind: 'poison',
      attempts: 3,
      lastError: 'rate-limit',
      lastAttempt: '2026-05-05T01:00:00Z',
    });
    expect(fs.existsSync(sidecarPathFor(jsonl))).toBe(true);
  });

  it('migrates legacy global sync-state.json with attempts < MAX_ATTEMPTS to poison kind', () => {
    const indexDir = path.join(tmpDir, 'conversation-index');
    fs.mkdirSync(indexDir, { recursive: true });
    fs.writeFileSync(path.join(indexDir, 'sync-state.json'), JSON.stringify({
      failures: {
        [jsonl]: {
          attempts: 1,
          lastError: 'oops',
          lastAttempt: '2026-05-05T01:00:00Z',
        },
      },
    }));

    const store = openConversationSyncStateStore({ archiveDir });
    const state = store.load(jsonl);
    expect(state.kind).toBe('poison');
    if (state.kind !== 'poison') throw new Error('unreachable');
    expect(state.attempts).toBe(1);
    expect(isRetriable(state)).toBe(true);
  });

  it('migrates -summary.txt presence to complete with mtime', () => {
    const summaryPath = jsonl.replace(/\.jsonl$/, '-summary.txt');
    fs.writeFileSync(summaryPath, 'a summary');
    const mtime = new Date('2026-04-04T04:04:04Z');
    fs.utimesSync(summaryPath, mtime, mtime);

    const store = openConversationSyncStateStore({ archiveDir });
    const state = store.load(jsonl);
    expect(state.kind).toBe('complete');
    if (state.kind !== 'complete') throw new Error('unreachable');
    expect(new Date(state.lastUpdated).toISOString()).toBe(mtime.toISOString());
    expect(fs.existsSync(sidecarPathFor(jsonl))).toBe(true);
  });

  it('migration is idempotent: second load reads sidecar (delete legacy in between)', () => {
    const partialPath = jsonl.replace(/\.jsonl$/, '-summary.partial.json');
    fs.writeFileSync(partialPath, JSON.stringify({
      version: 1,
      totalChunks: 5,
      chunkSummaries: ['c1'],
      totalExchanges: 10,
      lastUpdated: '2026-05-05T00:00:00Z',
    }));

    const store = openConversationSyncStateStore({ archiveDir });
    const first = store.load(jsonl);

    fs.unlinkSync(partialPath);

    const second = store.load(jsonl);
    expect(second).toEqual(first);
  });

  it('partial takes precedence over global failure', () => {
    const partialPath = jsonl.replace(/\.jsonl$/, '-summary.partial.json');
    fs.writeFileSync(partialPath, JSON.stringify({
      version: 1,
      totalChunks: 3,
      chunkSummaries: ['c1'],
      totalExchanges: 9,
      lastUpdated: '2026-05-05T00:00:00Z',
    }));

    const indexDir = path.join(tmpDir, 'conversation-index');
    fs.mkdirSync(indexDir, { recursive: true });
    fs.writeFileSync(path.join(indexDir, 'sync-state.json'), JSON.stringify({
      failures: {
        [jsonl]: { attempts: 3, lastError: 'x', lastAttempt: 'x' },
      },
    }));

    const store = openConversationSyncStateStore({ archiveDir });
    expect(store.load(jsonl).kind).toBe('inProgress');
  });

  it('global failure takes precedence over -summary.txt presence', () => {
    fs.writeFileSync(jsonl.replace(/\.jsonl$/, '-summary.txt'), 'summary');

    const indexDir = path.join(tmpDir, 'conversation-index');
    fs.mkdirSync(indexDir, { recursive: true });
    fs.writeFileSync(path.join(indexDir, 'sync-state.json'), JSON.stringify({
      failures: {
        [jsonl]: { attempts: 3, lastError: 'x', lastAttempt: '2026-05-05T00:00:00Z' },
      },
    }));

    const store = openConversationSyncStateStore({ archiveDir });
    expect(store.load(jsonl).kind).toBe('poison');
  });
});

describe('conversation-sync-state: Codex hardening', () => {
  // #1a: RETRY_ALL must NOT migrate legacy global poison into a sidecar —
  // otherwise unsetting the env later still finds a poison record on disk.
  it('RETRY_ALL bypasses legacy global poison without writing sidecar', () => {
    const indexDir = path.join(tmpDir, 'conversation-index');
    fs.mkdirSync(indexDir, { recursive: true });
    const legacy = path.join(indexDir, 'sync-state.json');
    const legacyBody = JSON.stringify({
      failures: {
        [jsonl]: {
          attempts: MAX_ATTEMPTS,
          lastError: 'rate-limit',
          lastAttempt: '2026-05-05T01:00:00Z',
        },
      },
    });
    fs.writeFileSync(legacy, legacyBody);

    process.env.EPISODIC_MEMORY_RETRY_ALL = '1';
    const store = openConversationSyncStateStore({ archiveDir });
    const state = store.load(jsonl);

    expect(state).toEqual({ kind: 'pending' });
    expect(fs.existsSync(sidecarPathFor(jsonl))).toBe(false);
    expect(fs.readFileSync(legacy, 'utf-8')).toBe(legacyBody);
  });

  // #1b: regression — without RETRY_ALL the legacy global poison still migrates.
  it('without RETRY_ALL legacy global poison still migrates to sidecar', () => {
    const indexDir = path.join(tmpDir, 'conversation-index');
    fs.mkdirSync(indexDir, { recursive: true });
    fs.writeFileSync(path.join(indexDir, 'sync-state.json'), JSON.stringify({
      failures: {
        [jsonl]: {
          attempts: MAX_ATTEMPTS,
          lastError: 'rate-limit',
          lastAttempt: '2026-05-05T01:00:00Z',
        },
      },
    }));

    const store = openConversationSyncStateStore({ archiveDir });
    const state = store.load(jsonl);
    expect(state.kind).toBe('poison');
    expect(fs.existsSync(sidecarPathFor(jsonl))).toBe(true);
  });

  // #2a: corrupt JSON sidecar must NOT trigger migration nor overwrite the bad bytes.
  it('corrupt sidecar yields pending without migration and preserves bytes', () => {
    const sidecar = sidecarPathFor(jsonl);
    const corrupt = '{garbage';
    fs.writeFileSync(sidecar, corrupt);

    // also write legacy partial — must NOT win since sidecar already exists (just invalid).
    const partialPath = jsonl.replace(/\.jsonl$/, '-summary.partial.json');
    fs.writeFileSync(partialPath, JSON.stringify({
      version: 1,
      totalChunks: 5,
      chunkSummaries: ['c1'],
      totalExchanges: 10,
      lastUpdated: '2026-05-05T00:00:00Z',
    }));

    const store = openConversationSyncStateStore({ archiveDir });
    expect(store.load(jsonl)).toEqual({ kind: 'pending' });
    expect(fs.readFileSync(sidecar, 'utf-8')).toBe(corrupt);
  });

  // #2b: future-version sidecar — same rule as corrupt: pending, do not overwrite.
  it('future-version sidecar yields pending without migration and preserves bytes', () => {
    const sidecar = sidecarPathFor(jsonl);
    const body = JSON.stringify({ version: 999, kind: 'complete', lastUpdated: 'x' });
    fs.writeFileSync(sidecar, body);

    const partialPath = jsonl.replace(/\.jsonl$/, '-summary.partial.json');
    fs.writeFileSync(partialPath, JSON.stringify({
      version: 1,
      totalChunks: 5,
      chunkSummaries: ['c1'],
      totalExchanges: 10,
      lastUpdated: '2026-05-05T00:00:00Z',
    }));

    const store = openConversationSyncStateStore({ archiveDir });
    expect(store.load(jsonl)).toEqual({ kind: 'pending' });
    expect(fs.readFileSync(sidecar, 'utf-8')).toBe(body);
  });

  // #2c: unknown kind — same rule.
  it('unknown-kind sidecar yields pending without migration and preserves bytes', () => {
    const sidecar = sidecarPathFor(jsonl);
    const body = JSON.stringify({ version: 2, kind: 'whoknows', lastUpdated: 'x' });
    fs.writeFileSync(sidecar, body);

    const store = openConversationSyncStateStore({ archiveDir });
    expect(store.load(jsonl)).toEqual({ kind: 'pending' });
    expect(fs.readFileSync(sidecar, 'utf-8')).toBe(body);
  });

  // #3a: legacy summary newer than jsonl → Complete.
  it('legacy summary newer than jsonl migrates to complete', () => {
    fs.writeFileSync(jsonl, 'orig');
    const jsonlT = new Date('2026-04-04T00:00:00Z');
    fs.utimesSync(jsonl, jsonlT, jsonlT);

    const summaryPath = jsonl.replace(/\.jsonl$/, '-summary.txt');
    fs.writeFileSync(summaryPath, 'a summary');
    const summaryT = new Date('2026-04-04T00:05:00Z'); // 5min after jsonl
    fs.utimesSync(summaryPath, summaryT, summaryT);

    const store = openConversationSyncStateStore({ archiveDir });
    const state = store.load(jsonl);
    expect(state.kind).toBe('complete');
    if (state.kind !== 'complete') throw new Error('unreachable');
    expect(new Date(state.lastUpdated).toISOString()).toBe(summaryT.toISOString());
  });

  // #3b: jsonl newer than legacy summary → Stale (carries summary mtime).
  it('jsonl newer than legacy summary migrates to stale', () => {
    fs.writeFileSync(jsonl, 'orig');
    const summaryPath = jsonl.replace(/\.jsonl$/, '-summary.txt');
    fs.writeFileSync(summaryPath, 'old summary');

    const summaryT = new Date('2026-04-04T00:00:00Z');
    fs.utimesSync(summaryPath, summaryT, summaryT);
    const jsonlT = new Date('2026-04-04T00:05:00Z'); // 5min after summary
    fs.utimesSync(jsonl, jsonlT, jsonlT);

    const store = openConversationSyncStateStore({ archiveDir });
    const state = store.load(jsonl);
    expect(state.kind).toBe('stale');
    if (state.kind !== 'stale') throw new Error('unreachable');
    // Stale carries the summary's last-known mtime, not the jsonl's.
    expect(new Date(state.lastUpdated).toISOString()).toBe(summaryT.toISOString());
  });

  // #3c: legacy summary present but jsonl missing → fallback to complete.
  it('legacy summary present but jsonl missing falls back to complete', () => {
    const summaryPath = jsonl.replace(/\.jsonl$/, '-summary.txt');
    fs.writeFileSync(summaryPath, 'a summary');
    const summaryT = new Date('2026-04-04T00:00:00Z');
    fs.utimesSync(summaryPath, summaryT, summaryT);
    // Note: jsonl file intentionally NOT created.

    const store = openConversationSyncStateStore({ archiveDir });
    const state = store.load(jsonl);
    expect(state.kind).toBe('complete');
    if (state.kind !== 'complete') throw new Error('unreachable');
    expect(new Date(state.lastUpdated).toISOString()).toBe(summaryT.toISOString());
  });
});

describe('conversation-sync-state: countPoison', () => {
  it('counts only sidecars with kind=poison and attempts >= MAX_ATTEMPTS', () => {
    const a = path.join(archiveDir, 'p1', 'a.jsonl');
    const b = path.join(archiveDir, 'p2', 'b.jsonl');
    const c = path.join(archiveDir, 'p2', 'c.jsonl');
    const d = path.join(archiveDir, 'p3', 'd.jsonl');
    for (const f of [a, b, c, d]) fs.mkdirSync(path.dirname(f), { recursive: true });

    const store = openConversationSyncStateStore({ archiveDir });
    store.save(a, { kind: 'poison', attempts: MAX_ATTEMPTS, lastError: 'x', lastAttempt: 'x' });
    store.save(b, { kind: 'poison', attempts: MAX_ATTEMPTS + 1, lastError: 'x', lastAttempt: 'x' });
    store.save(c, { kind: 'poison', attempts: 1, lastError: 'x', lastAttempt: 'x' });
    store.save(d, { kind: 'complete', lastUpdated: 'x' });

    expect(store.countPoison()).toBe(2);
  });

  it('returns 0 for empty archive', () => {
    const empty = path.join(tmpDir, 'empty-archive');
    fs.mkdirSync(empty, { recursive: true });
    const store = openConversationSyncStateStore({ archiveDir: empty });
    expect(store.countPoison()).toBe(0);
  });
});

// Parameterised: state-machine behaviour must match across adapters.
// Filesystem-only concerns (sidecar I/O, atomicity, on-disk schema, lazy
// migration) stay in the dedicated describe blocks above.
const adapters: Array<{ name: string; open: () => ConversationSyncStateStore }> = [
  { name: 'filesystem', open: () => openConversationSyncStateStore({ archiveDir }) },
  { name: 'memory', open: () => openMemoryConversationSyncStateStore() },
];

for (const adapter of adapters) {
  describe(`conversation-sync-state [${adapter.name}]: state-machine parity`, () => {
    it('returns pending for unknown path', () => {
      const store = adapter.open();
      expect(store.load(jsonl)).toEqual({ kind: 'pending' });
    });

    it('round-trips inProgress state', () => {
      const store = adapter.open();
      const state: SyncState = {
        kind: 'inProgress',
        chunkSummaries: ['c1', 'c2'],
        totalChunks: 5,
        totalExchanges: 42,
        lastUpdated: '2026-05-05T13:22:53Z',
      };
      store.save(jsonl, state);
      expect(store.load(jsonl)).toEqual(state);
    });

    it('round-trips complete state', () => {
      const store = adapter.open();
      const state: SyncState = { kind: 'complete', lastUpdated: '2026-05-05T13:22:53Z' };
      store.save(jsonl, state);
      expect(store.load(jsonl)).toEqual(state);
    });

    it('markStale transitions complete to stale', () => {
      const store = adapter.open();
      store.save(jsonl, { kind: 'complete', lastUpdated: '2026-05-05T00:00:00Z' });
      store.markStale(jsonl);
      expect(store.load(jsonl).kind).toBe('stale');
    });

    it('markStale is a no-op for pending', () => {
      const store = adapter.open();
      store.markStale(jsonl);
      expect(store.load(jsonl)).toEqual({ kind: 'pending' });
    });

    it('markStale is a no-op for inProgress', () => {
      const store = adapter.open();
      const inProgress: SyncState = {
        kind: 'inProgress',
        chunkSummaries: ['x'],
        totalChunks: 3,
        totalExchanges: 10,
        lastUpdated: '2026-05-05T00:00:00Z',
      };
      store.save(jsonl, inProgress);
      store.markStale(jsonl);
      expect(store.load(jsonl)).toEqual(inProgress);
    });

    it('markStale is a no-op for poison', () => {
      const store = adapter.open();
      const poison: SyncState = {
        kind: 'poison',
        attempts: 1,
        lastError: 'boom',
        lastAttempt: '2026-05-05T00:00:00Z',
      };
      store.save(jsonl, poison);
      store.markStale(jsonl);
      expect(store.load(jsonl)).toEqual(poison);
    });

    it('recordFailure once yields poison kind, attempts=1, retriable', () => {
      const store = adapter.open();
      const next = store.recordFailure(jsonl, 'timeout');
      expect(next.kind).toBe('poison');
      if (next.kind !== 'poison') throw new Error('unreachable');
      expect(next.attempts).toBe(1);
      expect(next.lastError).toBe('timeout');
      expect(isRetriable(next)).toBe(true);
    });

    it('recordFailure MAX_ATTEMPTS times yields non-retriable', () => {
      const store = adapter.open();
      let last: SyncState = { kind: 'pending' };
      for (let i = 0; i < MAX_ATTEMPTS; i++) {
        last = store.recordFailure(jsonl, 'timeout');
      }
      expect(last.kind).toBe('poison');
      if (last.kind !== 'poison') throw new Error('unreachable');
      expect(last.attempts).toBe(MAX_ATTEMPTS);
      expect(isRetriable(last)).toBe(false);
    });

    it('clearFailure removes poison and load returns pending', () => {
      const store = adapter.open();
      store.recordFailure(jsonl, 'timeout');
      store.clearFailure(jsonl);
      expect(store.load(jsonl)).toEqual({ kind: 'pending' });
    });

    it('clearFailure is a no-op when no state exists', () => {
      const store = adapter.open();
      expect(() => store.clearFailure(jsonl)).not.toThrow();
    });

    it('clearFailure leaves non-poison state untouched', () => {
      const store = adapter.open();
      const complete: SyncState = { kind: 'complete', lastUpdated: '2026-05-05T00:00:00Z' };
      store.save(jsonl, complete);
      store.clearFailure(jsonl);
      expect(store.load(jsonl)).toEqual(complete);
    });

    it('EPISODIC_MEMORY_RETRY_ALL=1 makes load return pending without mutating storage', () => {
      const store = adapter.open();
      for (let i = 0; i < MAX_ATTEMPTS; i++) {
        store.recordFailure(jsonl, 'timeout');
      }
      process.env.EPISODIC_MEMORY_RETRY_ALL = '1';
      expect(store.load(jsonl)).toEqual({ kind: 'pending' });
      delete process.env.EPISODIC_MEMORY_RETRY_ALL;
      const after = store.load(jsonl);
      expect(after.kind).toBe('poison');
      if (after.kind !== 'poison') throw new Error('unreachable');
      expect(after.attempts).toBe(MAX_ATTEMPTS);
    });

    it('countPoison counts only entries with attempts >= MAX_ATTEMPTS', () => {
      const store = adapter.open();
      const a = path.join(archiveDir, 'p1', 'a.jsonl');
      const b = path.join(archiveDir, 'p2', 'b.jsonl');
      const c = path.join(archiveDir, 'p2', 'c.jsonl');
      const d = path.join(archiveDir, 'p3', 'd.jsonl');
      for (const f of [a, b, c, d]) fs.mkdirSync(path.dirname(f), { recursive: true });
      store.save(a, { kind: 'poison', attempts: MAX_ATTEMPTS, lastError: 'x', lastAttempt: 'x' });
      store.save(b, { kind: 'poison', attempts: MAX_ATTEMPTS + 1, lastError: 'x', lastAttempt: 'x' });
      store.save(c, { kind: 'poison', attempts: 1, lastError: 'x', lastAttempt: 'x' });
      store.save(d, { kind: 'complete', lastUpdated: 'x' });
      expect(store.countPoison()).toBe(2);
    });
  });
}
