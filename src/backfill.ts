import fs from 'fs';
import path from 'path';
import type Database from 'better-sqlite3';
import { distillTranscript } from './archive-distill.js';
import { findJsonlFiles } from './paths.js';
import { listArchiveProjects } from './sync/sync.js';

export interface BackfillOptions {
  archiveDir: string;
  /** Limit to one top-level archive project directory (exact name). */
  project?: string;
  dryRun: boolean;
  /** Index DB to purge rewritten files from. Opened with initDatabase() when omitted on a real run. */
  db?: Database.Database;
  /** Single-instance sync lock; a real run refuses while a sync holds it. */
  acquireLock?: () => { ok: true } | { ok: false; holder: string };
}

export interface BackfillReport {
  dryRun: boolean;
  files: number;
  changed: number;
  /** Bytes of the changed files before and after distilling. */
  bytesBefore: number;
  bytesAfter: number;
  /** Absolute paths rewritten (or that would be, on a dry run). */
  touched: string[];
  failed: Array<{ file: string; error: string }>;
}

function listFiles(archiveDir: string, project?: string): string[] {
  const projects = listArchiveProjects(archiveDir);
  if (project !== undefined && !projects.includes(project)) {
    throw new Error(`no archived project named "${project}" in ${archiveDir}`);
  }
  const out: string[] = [];
  for (const name of project !== undefined ? [project] : projects) {
    const dir = path.join(archiveDir, name);
    for (const rel of findJsonlFiles(dir)) {
      const file = path.join(dir, rel);
      // A symlinked file belongs to someone else (often a live directory): never rewrite through it.
      if (!fs.lstatSync(file).isSymbolicLink()) out.push(file);
    }
  }
  return out;
}

/**
 * Rewrite one file in place with its original mode and timestamps. Keeping the
 * mtime means sync does not re-copy it and its summary is not marked stale.
 * Returns false (and writes nothing) when the file changed since it was read.
 */
function rewrite(file: string, content: Buffer, seen: fs.Stats, onBeforeRename: () => void): boolean {
  const now = fs.statSync(file);
  if (now.size !== seen.size || now.mtimeMs !== seen.mtimeMs) return false;
  const temp = `${file}.tmp.${process.pid}`;
  try {
    fs.writeFileSync(temp, content, { mode: seen.mode & 0o777 });
    fs.utimesSync(temp, seen.atime, seen.mtime);
    // Purge first: if the rename then fails, the file only gets indexed again.
    onBeforeRename();
    fs.renameSync(temp, file);
  } catch (error) {
    fs.rmSync(temp, { force: true });
    throw error;
  }
  return true;
}

/** Distill already-archived conversations in place. */
export async function backfillArchive(options: BackfillOptions): Promise<BackfillReport> {
  const { archiveDir, project, dryRun } = options;
  const report: BackfillReport = { dryRun, files: 0, changed: 0, bytesBefore: 0, bytesAfter: 0, touched: [], failed: [] };
  const files = listFiles(archiveDir, project);

  let db = options.db;
  let ownDb = false;
  let purge: ((db: Database.Database, file: string) => number) | undefined;
  if (!dryRun) {
    const acquire = options.acquireLock ?? (await import('./sync-run.js')).acquireSyncLock;
    const lock = acquire();
    if (!lock.ok) throw new Error(`sync is running (${lock.holder}); try again when it finishes`);
    const dbModule = await import('./db.js');
    purge = dbModule.purgeArchivePath;
    if (!db) {
      db = dbModule.initDatabase();
      ownDb = true;
    }
  }

  try {
    for (const file of files) {
      report.files++;
      try {
        const seen = fs.statSync(file);
        const before = fs.readFileSync(file);
        const after = Buffer.from(distillTranscript(before.toString('utf8')), 'utf8');
        if (after.equals(before)) continue;
        if (!dryRun && !rewrite(file, after, seen, () => purge!(db!, file))) {
          report.failed.push({ file, error: 'changed while backfilling; skipped' });
          continue;
        }
        report.changed++;
        report.bytesBefore += before.length;
        report.bytesAfter += after.length;
        report.touched.push(file);
      } catch (error) {
        report.failed.push({ file, error: error instanceof Error ? error.message : String(error) });
      }
    }
  } finally {
    if (ownDb) db?.close();
  }
  return report;
}

function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}

export function formatBackfillReport(report: BackfillReport): string {
  const saved = report.bytesBefore - report.bytesAfter;
  const pct = report.bytesBefore > 0 ? Math.round((saved / report.bytesBefore) * 100) : 0;
  const verb = report.dryRun ? 'would save' : 'saved';
  const lines = [
    `Scanned ${report.files} conversation(s); ${report.changed} ${report.dryRun ? 'would change' : 'changed'}.`,
    `${formatBytes(report.bytesBefore)} → ${formatBytes(report.bytesAfter)}: ${verb} ${formatBytes(saved)} (${pct}%).`,
  ];
  for (const f of report.failed) lines.push(`  ✗ ${f.file}: ${f.error}`);
  return lines.join('\n');
}
