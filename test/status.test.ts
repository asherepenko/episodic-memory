import { describe, expect, it } from 'vitest';
import { buildStatusReport, type StatusInput } from '../src/status.js';
import type { IndexStats } from '../src/stats.js';

const EMPTY_STATS: IndexStats = {
  totalConversations: 0,
  conversationsWithSummaries: 0,
  conversationsWithoutSummaries: 0,
  totalExchanges: 0,
  projectCount: 0,
};

function input(overrides: Partial<StatusInput> = {}): StatusInput {
  return {
    dbPath: '/db.sqlite',
    dbExists: true,
    nativeBindingOk: true,
    stats: EMPTY_STATS,
    staleEmbeddings: 0,
    poison: 0,
    apiEnvSet: false,
    now: '2026-06-30T12:00:00.000Z',
    ...overrides,
  };
}

describe('buildStatusReport', () => {
  it('is ok and says healthy when the binding loads and the database exists', () => {
    const r = buildStatusReport(input());
    expect(r.ok).toBe(true);
    expect(r.text).toContain('● healthy');
    expect(r.text).toContain(' Engine      ✓ SQLite loaded · ✓ database');
  });

  it('is not ok and shows the rebuild fix when the native binding is broken', () => {
    const r = buildStatusReport(input({ nativeBindingOk: false, nativeBindingError: 'bindings file missing' }));
    expect(r.ok).toBe(false);
    expect(r.text).toContain('● unhealthy');
    expect(r.text).toContain('✗ SQLite binding not loaded — bindings file missing');
    expect(r.text).toContain('npm rebuild better-sqlite3');
  });

  it('is not ok when the database does not exist yet, and says how to build it', () => {
    const r = buildStatusReport(input({ dbExists: false }));
    expect(r.ok).toBe(false);
    expect(r.text).toContain('⚠ index database not created yet (/db.sqlite)');
    expect(r.text).toContain('run: episodic-memory sync');
  });

  it('reports an empty index plainly', () => {
    const r = buildStatusReport(input());
    expect(r.text).toContain(' Index       none indexed yet · never synced');
    expect(r.text).not.toContain('Summaries');
  });

  it('shows counts, the date range and a summary bar when populated', () => {
    const r = buildStatusReport(input({
      lastSync: '2026-06-30T11:00:00.000Z',
      poison: 2,
      stats: {
        ...EMPTY_STATS,
        totalConversations: 100,
        conversationsWithSummaries: 84,
        conversationsWithoutSummaries: 16,
        totalExchanges: 5000,
        dateRange: { earliest: '2025-01-01T12:00:00Z', latest: '2026-06-30T12:00:00Z' },
      },
    }));
    expect(r.text).toContain(' Index       100 conversations · 5,000 exchanges\n');
    expect(r.text).toContain('             Jan 1, 2025 → Jun 30, 2026 · synced 1h ago\n');
    expect(r.text).toContain(' Summaries   ' + '━'.repeat(18) + '─'.repeat(4) + ' 84%\n');
    expect(r.text).toContain('             84 done · 16 pending · 2 failed\n');
  });

  it('lists stale embeddings and failed summaries with their fixes, without flipping health', () => {
    const r = buildStatusReport(input({ staleEmbeddings: 42, poison: 3 }));
    expect(r.text).toContain('⚠ 42 exchanges on an old model');
    expect(r.text).toContain('⚠ 3 summaries failed for good');
    expect(r.text).toContain('retry: EPISODIC_MEMORY_RETRY_ALL=1 episodic-memory sync');
    expect(r.ok).toBe(true);
  });

  it('names the summary auth source', () => {
    expect(buildStatusReport(input({ apiEnvSet: false })).text).toContain(' Summary API · Claude Code auth');
    expect(buildStatusReport(input({ apiEnvSet: true })).text).toContain(' Summary API · API key from env');
  });
});
