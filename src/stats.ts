import fs from 'fs';
import path from 'path';
import { getDbPath, getExcludedProjects, findJsonlFiles, entryIsDirectory } from './paths.js';
import { openDatabase } from './db.js';
import { createUi, num, plural, type Ui } from './cli-ui.js';
import { fullProjectName } from './sync-report.js';
import { VERSION } from './version.js';

export interface IndexStats {
  totalConversations: number;
  conversationsWithSummaries: number;
  conversationsWithoutSummaries: number;
  totalExchanges: number;
  dateRange?: {
    earliest: string;
    latest: string;
  };
  projectCount: number;
  topProjects?: Array<{ project: string; count: number }>;
  databaseSize?: string;
  /** exchanges still on an old embedding model (re-embedded incrementally on sync) */
  staleEmbeddings?: number;
  /** conversations permanently skipped after repeated summary failures; populated by the CLI layer */
  poisonConversations?: number;
  /** archived transcripts sync has not indexed yet; populated by the CLI layer */
  pendingIndex?: number;
}

/**
 * Archived transcripts that the next sync would index: no indexed_files row,
 * or modified since. Uses the same rule as sync, so 0 means search covers the
 * whole archive. Undefined when the DB predates indexed_files.
 */
export function countPendingIndex(archiveDir: string, dbPath: string = getDbPath()): number | undefined {
  if (!fs.existsSync(dbPath)) return undefined;
  const db = openDatabase(dbPath, { readonly: true });
  let mtimes: Map<string, number>;
  try {
    const hasTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'indexed_files'").get();
    if (!hasTable) return undefined;
    const rows = db.prepare('SELECT archive_path, mtime_ms FROM indexed_files').all() as Array<{ archive_path: string; mtime_ms: number }>;
    mtimes = new Map(rows.map(r => [r.archive_path, r.mtime_ms]));
  } finally {
    db.close();
  }
  if (!fs.existsSync(archiveDir)) return 0;

  const excluded = new Set(getExcludedProjects());
  let pending = 0;
  for (const entry of fs.readdirSync(archiveDir, { withFileTypes: true })) {
    if (!entryIsDirectory(archiveDir, entry) || excluded.has(entry.name)) continue;
    const projectDir = path.join(archiveDir, entry.name);
    for (const rel of findJsonlFiles(projectDir, excluded)) {
      const file = path.join(projectDir, rel);
      const indexedAt = mtimes.get(file);
      try {
        if (indexedAt === undefined || fs.statSync(file).mtimeMs > indexedAt) pending++;
      } catch {
        // vanished mid-walk
      }
    }
  }
  return pending;
}

export async function getIndexStats(dbPath?: string): Promise<IndexStats> {
  const resolvedDbPath = dbPath || getDbPath();

  // Check if database exists
  const fs = await import('fs');
  if (!fs.existsSync(resolvedDbPath)) {
    return {
      totalConversations: 0,
      conversationsWithSummaries: 0,
      conversationsWithoutSummaries: 0,
      totalExchanges: 0,
      projectCount: 0,
    };
  }

  const db = openDatabase(resolvedDbPath, { readonly: true });

  try {
    // Check if tables exist
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
    const hasExchanges = tables.some(t => t.name === 'exchanges');

    if (!hasExchanges) {
      // Empty database
      return {
        totalConversations: 0,
        conversationsWithSummaries: 0,
        conversationsWithoutSummaries: 0,
        totalExchanges: 0,
        projectCount: 0,
      };
    }

    // Total conversations
    const totalConversations = db.prepare('SELECT COUNT(DISTINCT archive_path) as count FROM exchanges').get() as { count: number };

    // Check for summaries (these are files, not DB fields). Only count
    // conversations with a real summary — skip empty zero-exchange sentinels
    // (#91) and error sentinels (#96) so stats reflect actual coverage.
    const { hasRealSummary } = await import('./summary-sentinel.js');
    const conversationPaths = db.prepare('SELECT DISTINCT archive_path FROM exchanges').all() as Array<{ archive_path: string }>;
    let withSummariesCount = 0;
    for (const { archive_path } of conversationPaths) {
      const summaryPath = archive_path.replace('.jsonl', '-summary.txt');
      if (hasRealSummary(summaryPath)) {
        withSummariesCount++;
      }
    }

    // Total exchanges
    const totalExchanges = db.prepare('SELECT COUNT(*) as count FROM exchanges').get() as { count: number };

    // Date range
    const dateRange = db.prepare('SELECT MIN(timestamp) as earliest, MAX(timestamp) as latest FROM exchanges').get() as { earliest: string; latest: string } | undefined;

    // Project counts
    const projectCount = db.prepare('SELECT COUNT(DISTINCT project) as count FROM exchanges').get() as { count: number };

    // Top 10 projects
    const topProjects = db.prepare(`
      SELECT project, COUNT(DISTINCT archive_path) as count
      FROM exchanges
      GROUP BY project
      ORDER BY count DESC
      LIMIT 10
    `).all() as Array<{ project: string; count: number }>;

    // Stale-embedding count (rows on an old encoder). Guarded: minimal/old
    // schemas may lack the embedding_version column countStale relies on.
    let staleEmbeddings = 0;
    try {
      const { countStale } = await import('./embedding-migration.js');
      staleEmbeddings = countStale(db);
    } catch {
      // column absent on a partial/legacy schema — treat as none stale
    }

    return {
      totalConversations: totalConversations.count,
      conversationsWithSummaries: withSummariesCount,
      conversationsWithoutSummaries: totalConversations.count - withSummariesCount,
      totalExchanges: totalExchanges.count,
      dateRange: dateRange?.earliest ? {
        earliest: dateRange.earliest,
        latest: dateRange.latest,
      } : undefined,
      projectCount: projectCount.count,
      topProjects,
      staleEmbeddings,
    };
  } finally {
    db.close();
  }
}

const MONTH_DAY: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
const MONTH_DAY_YEAR: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };

/** "Jan 12 → Oct 13, 2026", or with both years when the range spans years. */
export function formatDateRange(earliest: string, latest: string): string {
  const a = new Date(earliest);
  const b = new Date(latest);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return `${earliest} → ${latest}`;
  const sameYear = a.getFullYear() === b.getFullYear();
  const from = a.toLocaleDateString('en-US', sameYear ? MONTH_DAY : MONTH_DAY_YEAR);
  return `${from} → ${b.toLocaleDateString('en-US', MONTH_DAY_YEAR)}`;
}

/** Draw the stats report through the shared UI kit. */
export function renderStats(ui: Ui, stats: IndexStats): void {
  ui.line(`${ui.paint('bold', 'Episodic Memory')} ${ui.paint('dim', `v${VERSION} · index statistics`)}`);

  ui.heading('Search Index');
  ui.field('Conversations', num(stats.totalConversations));
  ui.field('Exchanges', num(stats.totalExchanges));
  if (stats.dateRange) ui.field('Date range', formatDateRange(stats.dateRange.earliest, stats.dateRange.latest));
  ui.field('Projects', num(stats.projectCount));
  if (stats.pendingIndex !== undefined) {
    if (stats.pendingIndex === 0) {
      ui.row('ok', 'Waiting to index', '0 (all archived transcripts indexed)');
    } else {
      ui.row('warn', 'Waiting to index', plural(stats.pendingIndex, 'transcript'));
      ui.sub('run: episodic-memory sync');
    }
  }

  // Summaries are one-line captions on search results; search itself runs on
  // exchanges, so a missing summary never hides a conversation.
  ui.heading('Summaries');
  ui.field('With summaries', num(stats.conversationsWithSummaries));
  let without = num(stats.conversationsWithoutSummaries);
  if (stats.conversationsWithoutSummaries > 0 && stats.totalConversations > 0) {
    without += ` (${((stats.conversationsWithoutSummaries / stats.totalConversations) * 100).toFixed(1)}%)`;
  }
  ui.field('Without summaries', without);
  ui.sub('captions on search results; search works without them');

  const stale = stats.staleEmbeddings ?? 0;
  const poison = stats.poisonConversations ?? 0;
  if (stale > 0 || poison > 0) {
    ui.heading('Health');
    if (stale > 0) {
      ui.row('warn', 'Stale embeddings', `${plural(stale, 'exchange')} on an old model`);
      ui.sub('re-embedded incrementally on each sync');
    }
    if (poison > 0) {
      ui.row('warn', 'Permanently skipped', `${plural(poison, 'conversation')} after repeated summary failures`);
      ui.sub('retry with: EPISODIC_MEMORY_RETRY_ALL=1 episodic-memory sync');
    }
  }

  if (stats.topProjects && stats.topProjects.length > 0) {
    ui.heading('Top Projects by Conversation Count');
    const width = Math.max(...stats.topProjects.map(p => num(p.count).length));
    for (const { project, count } of stats.topProjects) {
      const name = project ? fullProjectName(project) : '(unknown)';
      ui.line(`  ${num(count).padStart(width)}  ${name}`);
    }
  }
}

/** Plain-text rendering (no color, no animation); same layout as the terminal. */
export function formatStats(stats: IndexStats): string {
  const chunks: string[] = [];
  renderStats(createUi({ out: { write: s => chunks.push(s) }, live: { write: () => {} }, color: false }), stats);
  return chunks.join('');
}
