import { createSyncSession, listArchiveProjects, listSourceProjects } from './sync/index.js';
import type { ProjectOutcome } from './sync/index.js';
import { groupProjects, type ProjectGroup, type ProjectMember } from './sync/project-groups.js';
import { getArchiveDir, getConversationSourceDirs, getIndexDir } from './paths.js';
import { getLogPath, setConsoleInfoMuted } from './logger.js';
import { initDatabase } from './db.js';
import { generateExchangeEmbedding, initEmbeddings } from './embeddings.js';
import { runMigrationBatch, countStale } from './embedding-migration.js';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { formatLogLine, getSyncLogPath } from './logging.js';
import { acquireFileLock, readLockHolder, releaseFileLock } from './file-lock.js';
import { createSyncReporter, formatSyncSummary, fullProjectName } from './sync-report.js';

export const tildify = (p: string) => (p.startsWith(os.homedir()) ? '~' + p.slice(os.homedir().length) : p);

/**
 * Take the single-instance sync lock (#97) and release it on every exit.
 * Returns a "held by" label when another process already has it.
 */
const syncLockPath = () => path.join(path.dirname(getSyncLogPath()), 'episodic-memory-sync.lock');
const rerunPath = () => path.join(path.dirname(getSyncLogPath()), 'episodic-memory-sync.rerun');

/** Ask the running sync for one more pass when it finishes (a sync skipped on the lock). */
export function requestRerun(): void {
  try {
    fs.writeFileSync(rerunPath(), String(process.pid));
  } catch {}
}

/** Consume a pending rerun request. True at most once per batch of requests. */
export function takeRerunRequest(): boolean {
  try {
    fs.unlinkSync(rerunPath());
    return true;
  } catch {
    return false;
  }
}

export function acquireSyncLock(): { ok: true } | { ok: false; holder: string } {
  const lockPath = syncLockPath();
  const previous = readLockHolder(lockPath);
  const syncLock = acquireFileLock(lockPath);
  if (!syncLock) {
    const holder = readLockHolder(lockPath);
    return { ok: false, holder: holder !== null ? `pid ${holder}` : 'another process' };
  }
  // We stole a lock from a dead holder: that run was SIGKILLed or crashed hard,
  // so it never got to log anything itself.
  if (previous !== null && previous !== process.pid) {
    logStop(`previous sync (pid ${previous}) ended without finishing (killed or crashed)`);
  }

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    releaseFileLock(syncLock);
  };
  let signalled = false;
  process.on('exit', code => {
    if (code !== 0 && !signalled) logStop(`sync exited with code ${code}`);
    release();
  });
  const onSignal = (signal: NodeJS.Signals, code: number) => () => {
    signalled = true;
    logStop(`sync stopped by ${signal}`);
    release();
    process.exit(code);
  };
  process.on('SIGINT', onSignal('SIGINT', 130));
  process.on('SIGTERM', onSignal('SIGTERM', 143));
  process.on('SIGHUP', onSignal('SIGHUP', 129));
  return { ok: true };
}

/** stderr is the hook log for a background sync; write synchronously so it lands before exit. */
function logStop(message: string): void {
  try {
    fs.writeSync(2, formatLogLine('warn', message));
  } catch {}
}

const isCodexSource = (sourceDir: string) => sourceDir.includes(`${path.sep}.codex${path.sep}`);

/**
 * One list across every source plus archive-only projects (live transcripts
 * deleted), with worktrees folded into their repo, sorted by display name.
 */
function planProjects(sourceDirs: string[], destDir: string): Array<ProjectGroup & { label?: string }> {
  const members: ProjectMember[] = [];
  const covered = new Set<string>();
  for (const sourceDir of sourceDirs) {
    for (const project of listSourceProjects(sourceDir)) {
      members.push({ project, sourceDir });
      covered.add(project);
    }
  }
  for (const project of listArchiveProjects(destDir)) {
    if (!covered.has(project)) members.push({ project });
  }

  const codexProjects = new Set(members.filter(m => m.sourceDir && isCodexSource(m.sourceDir)).map(m => m.project));
  return groupProjects(members)
    .map(group => ({ ...group, label: codexProjects.has(group.key) ? `codex ${group.key}` : undefined }))
    .sort((a, b) => (a.label ?? fullProjectName(a.key)).localeCompare(b.label ?? fullProjectName(b.key), 'en', { sensitivity: 'base' }));
}

export interface RunSyncOptions {
  summaryLimit?: number;
  summaryBudgetMs?: number;
  concurrency?: number;
  skipSummaries?: boolean;
}

/**
 * Copy, index and summarize every project with the grouped terminal report,
 * then run a batch of embedding migration. Shared by `sync` and `index`.
 */
export async function runSync(options: RunSyncOptions = {}): Promise<void> {
  const sourceDirs = getConversationSourceDirs();
  const destDir = getArchiveDir();
  console.log(`Archive: ${tildify(destDir)}  ·  Log: ${tildify(getLogPath())}`);

  const startedAt = Date.now();
  const reporter = createSyncReporter();
  if (process.stderr.isTTY) setConsoleInfoMuted(true);

  const session = createSyncSession(destDir, { ...options, onEvent: event => reporter.onEvent(event) });
  let exchanges = 0;
  let finished = false;

  try {
    const groups = planProjects(sourceDirs, destDir);
    reporter.start(groups.length);

    for (const [i, group] of groups.entries()) {
      const index = i + 1;
      const total = groups.length;
      const project = group.key;
      const label = group.label;
      reporter.onEvent({ type: 'project-start', project, label, index, total });

      const sum: ProjectOutcome = { copied: 0, indexed: 0, exchanges: 0, errors: 0 };
      for (const member of group.members) {
        const onProgress = (done: number, of: number) =>
          reporter.onEvent({ type: 'project-progress', project, label, index, total, done, of });
        const outcome = member.sourceDir
          ? await session.syncProject(member.sourceDir, member.project, onProgress)
          : await session.indexProject(member.project, onProgress);
        sum.copied += outcome.copied;
        sum.indexed += outcome.indexed;
        sum.exchanges += outcome.exchanges;
        sum.errors += outcome.errors;
      }
      exchanges += sum.exchanges;
      reporter.onEvent({ type: 'project-done', project, label, index, total, ...sum, worktrees: group.worktrees });
    }

    reporter.heading('Summaries');
    await session.summarize();
    finished = true;
  } finally {
    session.close();
    const { copied, summarized, errors } = session.result;
    reporter.finish(formatSyncSummary({
      finished,
      ms: Date.now() - startedAt,
      copied,
      exchanges,
      summarized,
      errors: errors.length,
    }));
    setConsoleInfoMuted(false);
  }

  // After regular sync, do a batch of embedding migration if any rows are
  // still on the old encoder. Lock-protected; if another process is already
  // migrating, this is a no-op.
  await runEmbeddingMigrationPhase();

  const { errors, summarized } = session.result;
  if (errors.length > 0) {
    const shown = errors.slice(0, 10);
    console.log('');
    shown.forEach(err => console.log(`  ✗ ${tildify(err.file)}: ${err.error.split('\n')[0]}`));
    if (errors.length > shown.length) {
      console.log(`  …and ${errors.length - shown.length} more (see ${tildify(getLogPath())})`);
    }

    // Help diagnose silent summarization failures (#70)
    const summaryErrors = errors.filter(e => e.error.startsWith('Summary generation failed'));
    if (summaryErrors.length > 0 && summarized === 0) {
      console.log(`\n💡 All ${summaryErrors.length} summarization attempts failed.`);
      console.log(`  Check your API configuration (EPISODIC_MEMORY_API_BASE_URL / ANTHROPIC_API_KEY).`);
    }
  }
}

const MIGRATION_BATCH_SIZE = parseInt(process.env.EPISODIC_MEMORY_MIGRATION_BATCH || '500', 10);

async function runEmbeddingMigrationPhase(): Promise<void> {
  // initDatabase() must be inside the try: opening the DB loads the sqlite-vec
  // native extension, which can throw transiently (e.g. a partial install
  // during `/plugin update`, before the platform dylib has landed). That must
  // log-and-skip the optional migration, never abort the whole sync and exit 1
  // — which would discard the summaries already completed this run.
  let db: ReturnType<typeof initDatabase> | undefined;
  try {
    db = initDatabase();
    const stale = countStale(db);
    if (stale === 0) return;

    console.error(`\nepisodic-memory: ${stale} exchange(s) on the old embedding model — migrating up to ${MIGRATION_BATCH_SIZE} this run`);
    await initEmbeddings();
    const indexDir = getIndexDir();
    const done = await runMigrationBatch(db, indexDir, MIGRATION_BATCH_SIZE, generateExchangeEmbedding);
    if (done > 0) {
      const after = countStale(db);
      console.error(`episodic-memory: re-embedded ${done} (${after} still stale; will resume on next sync)`);
    }
  } catch (err) {
    console.error('episodic-memory: migration phase error:', err instanceof Error ? err.message : err);
  } finally {
    db?.close();
  }
}
