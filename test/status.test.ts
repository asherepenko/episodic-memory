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
  it('is ok when the binding loads and the database exists', () => {
    const r = buildStatusReport(input());
    expect(r.ok).toBe(true);
    expect(r.text).toContain('✅ Native SQLite binding: loaded');
    expect(r.text).toContain('✅ Index database: present');
  });

  it('is not ok and surfaces a rebuild hint when the native binding is broken', () => {
    const r = buildStatusReport(input({ nativeBindingOk: false, nativeBindingError: 'bindings file missing' }));
    expect(r.ok).toBe(false);
    expect(r.text).toContain('❌ Native SQLite binding: NOT loaded — bindings file missing');
    expect(r.text).toContain('npm rebuild better-sqlite3');
  });

  it('is not ok when the database does not exist yet', () => {
    const r = buildStatusReport(input({ dbExists: false }));
    expect(r.ok).toBe(false);
    expect(r.text).toContain('⚠️  Index database: not created yet');
  });

  it('reports an empty index plainly', () => {
    const r = buildStatusReport(input());
    expect(r.text).toContain('📭 No conversations indexed yet.');
    expect(r.text).toContain('🕒 Last sync: never');
  });

  it('reports conversation, summary, and exchange counts when populated', () => {
    const r = buildStatusReport(input({
      stats: {
        ...EMPTY_STATS,
        totalConversations: 100,
        conversationsWithSummaries: 80,
        conversationsWithoutSummaries: 20,
        totalExchanges: 5000,
        dateRange: { earliest: '2025-01-01', latest: '2026-06-30' },
      },
    }));
    expect(r.text).toContain('📚 Conversations: 100 (80 summarized, 20 pending)');
    expect(r.text).toContain('💬 Exchanges: 5000');
    expect(r.text).toContain('📅 Range: 2025-01-01 → 2026-06-30');
  });

  it('warns about stale embeddings and poison conversations with a retry hint', () => {
    const r = buildStatusReport(input({ staleEmbeddings: 42, poison: 3 }));
    expect(r.text).toContain('⚠️  Embeddings: 42 exchange(s) on an old model');
    expect(r.text).toContain('⚠️  Summaries: 3 conversation(s) permanently skipped');
    expect(r.text).toContain('EPISODIC_MEMORY_RETRY_ALL=1');
    // Health warnings do not flip core engine health.
    expect(r.ok).toBe(true);
  });

  it('renders a relative age for the last sync', () => {
    const r = buildStatusReport(input({ lastSync: '2026-06-30T11:30:00.000Z' }));
    expect(r.text).toContain('🕒 Last sync: 2026-06-30T11:30:00.000Z (30m ago)');
  });

  it('notes ambient auth when no API env vars are set', () => {
    expect(buildStatusReport(input({ apiEnvSet: false })).text)
      .toContain('relying on Claude Code ambient auth');
    expect(buildStatusReport(input({ apiEnvSet: true })).text)
      .toContain('env configured');
  });
});
