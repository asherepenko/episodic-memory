#!/usr/bin/env node
import { verifyIndex, repairIndex } from './verify.js';
import { indexSession } from './indexer.js';
import { getDbPath, getArchiveDir } from './paths.js';
import fs from 'fs';
import path from 'path';
import { acquireSyncLock, runSync } from './sync-run.js';
import { createUi, num, plural, tildify } from './cli-ui.js';

const command = process.argv[2];

// Parse --concurrency flag from remaining args
function getConcurrency(): number | undefined {
  const concurrencyIndex = process.argv.findIndex(arg => arg === '--concurrency' || arg === '-c');
  if (concurrencyIndex !== -1 && process.argv[concurrencyIndex + 1]) {
    const value = parseInt(process.argv[concurrencyIndex + 1], 10);
    if (value >= 1 && value <= 16) return value;
  }
  return undefined; // EPISODIC_MEMORY_CONCURRENCY, then the sync default
}

// Parse --no-summaries flag
function getNoSummaries(): boolean {
  return process.argv.includes('--no-summaries');
}

const concurrency = getConcurrency();
const noSummaries = getNoSummaries();

/**
 * Index everything the ledger is missing, with the same grouped report as
 * `sync`. Unlike sync, summarize every eligible conversation, with no count
 * cap or time budget.
 */
async function indexAll(lockHeld = false): Promise<void> {
  if (!lockHeld) takeLockOrExit();
  await runSync({ summaryLimit: Infinity, summaryBudgetMs: Infinity, concurrency, skipSummaries: noSummaries });
}

function takeLockOrExit(): void {
  const lock = acquireSyncLock();
  if (!lock.ok) {
    ui.row('fail', 'Sync running', `${lock.holder} holds the index; try again when it finishes`);
    process.exit(1);
  }
}

const ui = createUi();
const SHOW_PATHS = 3;

/**
 * Check every archived conversation against the index, list what's wrong,
 * and repair it — right away with `repair`, or after a y/N prompt with
 * `verify` on a terminal. Exits 1 while problems remain.
 */
async function verify(mode: { repair?: boolean; offerRepair?: boolean }): Promise<void> {
  const startedAt = Date.now();
  ui.line(ui.paint('dim', `Archive: ${tildify(getArchiveDir())}`));
  let checked = 0;
  const issues = await ui.task('checking conversations...', progress =>
    verifyIndex({ onProgress: (done, total) => { checked = done; progress.update(done, total); } }));

  ui.heading('Verify');
  const report = (label: string, items: Array<{ path: string }>, status: 'warn' | 'fail', what: string) => {
    if (items.length === 0) {
      ui.row('ok', label, 'none');
      return;
    }
    ui.row(status, label, plural(items.length, what));
    for (const item of items.slice(0, SHOW_PATHS)) ui.sub(tildify(item.path));
    if (items.length > SHOW_PATHS) ui.sub(`…and ${num(items.length - SHOW_PATHS)} more`);
  };
  report('Missing summaries', issues.missing, 'warn', 'conversation');
  report('Outdated', issues.outdated, 'warn', 'conversation');
  report('Orphaned entries', issues.orphaned, 'warn', 'exchange');
  report('Corrupted files', issues.corrupted, 'fail', 'file');

  const fixable = issues.missing.length + issues.outdated.length + issues.orphaned.length;
  const total = fixable + issues.corrupted.length;
  ui.done(startedAt, [plural(checked, 'conversation') + ' checked', total === 0 ? 'healthy' : plural(total, 'issue')], { ok: total === 0, verb: 'checked' });
  if (total === 0) return;

  let repair = Boolean(mode.repair) && fixable > 0;
  if (!repair && mode.offerRepair && fixable > 0) {
    ui.line();
    repair = await ui.confirm(`Repair ${plural(fixable, 'issue')} now? Missing summaries are written with Claude.`);
  }
  if (!repair) {
    if (fixable > 0) ui.sub('run: episodic-memory index --repair');
    process.exit(1);
  }

  takeLockOrExit();
  const repairStartedAt = Date.now();
  const result = await ui.task('repairing...', progress =>
    repairIndex(issues, { onProgress: (done, of, file) => progress.update(done, of, file ? `re-indexing ${path.basename(file)}` : undefined) }));

  ui.heading('Repair');
  ui.row(result.removed > 0 ? 'new' : 'ok', 'Orphans removed', num(result.removed));
  ui.row(result.reindexed > 0 ? 'new' : 'ok', 'Re-indexed', `${plural(result.reindexed, 'conversation')} · ${plural(result.exchanges, 'exchange')}`);
  if (result.skipped > 0) ui.row('info', 'Skipped', `${plural(result.skipped, 'conversation')} with no exchanges`);
  if (result.summaryFailures > 0) ui.row('warn', 'Summaries failed', `${num(result.summaryFailures)} · indexed anyway`);
  for (const f of result.failed) {
    ui.row('fail', path.basename(f.path), f.error.split('\n')[0]);
    ui.sub(tildify(f.path));
  }
  if (issues.corrupted.length > 0) ui.row('fail', 'Corrupted files', `${plural(issues.corrupted.length, 'file')} need manual review`);
  const left = result.failed.length + issues.corrupted.length;
  ui.done(repairStartedAt, [plural(result.reindexed, 'conversation') + ' repaired', ...(left > 0 ? [plural(left, 'problem') + ' left'] : [])], { ok: left === 0 });
  if (left > 0) process.exit(1);
}

/** Delete the database and every summary, then index everything from the archive. */
async function rebuild(): Promise<void> {
  const dbPath = getDbPath();
  const archiveDir = getArchiveDir();
  ui.row('warn', 'Rebuild', 'deletes the search index and every summary, then re-indexes the archive');
  ui.sub(tildify(dbPath));
  const confirmed = process.argv.includes('--yes') || await ui.confirm('Delete and rebuild?');
  if (!confirmed) {
    ui.row('info', 'Cancelled', ui.interactive ? 'nothing deleted' : 'pass --yes to rebuild without a prompt');
    return;
  }

  // Hold the lock before deleting so a background sync can't write into a half-deleted index.
  takeLockOrExit();
  let summaries = 0;
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  if (fs.existsSync(archiveDir)) {
    for (const projectEntry of fs.readdirSync(archiveDir, { withFileTypes: true })) {
      if (!projectEntry.isDirectory()) continue;
      const projectPath = path.join(archiveDir, projectEntry.name);
      for (const summary of fs.readdirSync(projectPath).filter(f => f.endsWith('-summary.txt'))) {
        fs.unlinkSync(path.join(projectPath, summary));
        summaries++;
      }
    }
  }
  ui.row('ok', 'Deleted', `index database · ${plural(summaries, 'summary', 'summaries')}`);
  ui.line();
  await indexAll(true);
}

async function main() {
  try {
    switch (command) {
      case 'index-session':
        const sessionId = process.argv[3];
        if (!sessionId) {
          console.error('Usage: index-cli index-session <session-id>');
          process.exit(1);
        }
        await indexSession(sessionId, concurrency ?? 1, noSummaries);
        break;

      case 'index-cleanup':
        await indexAll();
        break;

      case 'verify':
        await verify({ offerRepair: true });
        break;

      case 'repair':
        await verify({ repair: true });
        break;

      case 'rebuild':
        await rebuild();
        break;

      case 'index-all':
      default:
        await indexAll();
        break;
    }
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();
