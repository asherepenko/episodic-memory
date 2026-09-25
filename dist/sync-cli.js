import { createSyncSession, listArchiveProjects, listSourceProjects } from './sync/index.js';
import { groupProjects } from './sync/project-groups.js';
import { getArchiveDir, getConversationSourceDirs, getIndexDir } from './paths.js';
import { closeLog, getLogPath, setConsoleInfoMuted } from './logger.js';
import { shouldSkipReentrantSync } from './summarizer.js';
import { initDatabase } from './db.js';
import { generateExchangeEmbedding, initEmbeddings } from './embeddings.js';
import { runMigrationBatch, countStale } from './embedding-migration.js';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { formatLogLine, getSyncLogPath } from './logging.js';
import { acquireFileLock, readLockHolder, releaseFileLock } from './file-lock.js';
import { createSyncReporter, formatSyncSummary, fullProjectName } from './sync-report.js';
import os from 'os';
const args = process.argv.slice(2);
// Reentrancy guard (#87): if this sync was triggered by a SessionStart hook
// inside a Claude subprocess that the summarizer just spawned, exit silently.
// Without this, summarization spawns a Claude subprocess which fires
// SessionStart which runs sync which spawns more summarization — cascading
// fanout that pegs CPU and burns API quota.
if (shouldSkipReentrantSync()) {
    // stderr keeps the message out of any stdout consumers (e.g., MCP)
    // while still being visible in hook logs.
    console.error('episodic-memory: skipping sync inside summarizer-spawned subprocess (#87)');
    process.exit(0);
}
if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Usage: episodic-memory sync [--background] [--limit <n>]

Sync conversations from Claude Code and Codex transcript directories to archive and index them.

This command:
1. Copies new or updated .jsonl files to conversation archive
2. Generates embeddings for semantic search
3. Updates the search index

Only processes files that are new or have been modified since last sync.
Safe to run multiple times - subsequent runs are fast no-ops.

OPTIONS:
  --background        Run sync in background (for hooks, returns immediately)
  --limit <n>         Max summaries to generate per run (default: 10)
  --concurrency <n>   Parallel summary workers, 1-16 (overrides
  -c <n>              EPISODIC_MEMORY_CONCURRENCY; default: 2)

ENV:
  EPISODIC_MEMORY_API_TIMEOUT_MS    Per-call Claude SDK timeout (default: 180000)
  EPISODIC_MEMORY_CONCURRENCY       Parallel summary workers (default: 2; --concurrency wins)
  EPISODIC_MEMORY_RETRY_ALL         Set to retry files marked as poison-pill
  EPISODIC_MEMORY_DEDUP             Set to "0" to disable summary dedup
  EPISODIC_MEMORY_DEDUP_THRESHOLD   Cosine similarity cutoff (default: 0.95)
  EPISODIC_MEMORY_DEBUG             Set to any value for verbose stderr debug logs

STATE:
  Failed-summary attempts tracked in <index-dir>/sync-state.json.
  After 3 failures a file is skipped on subsequent runs to avoid wasting
  subscription quota. Set EPISODIC_MEMORY_RETRY_ALL=1 to retry them.

LOGS:
  All sync activity (start/end/elapsed/errors) is appended to:
    <index-dir>/sync.log
  Tail it during sync: tail -f ~/.config/superpowers/conversation-index/sync.log

EXAMPLES:
  # Sync all new conversations
  episodic-memory sync

  # Sync in background (for hooks)
  episodic-memory sync --background

  # Sync and generate up to 50 summaries
  episodic-memory sync --limit 50

  # Sync with 8 parallel summary workers
  episodic-memory sync --concurrency 8

  # Use in Claude Code hook
  # In .claude/hooks/session-end:
  episodic-memory sync --background
`);
    process.exit(0);
}
// Check if running in background mode
const isBackground = args.includes('--background');
// Parse --limit <n>
const limitIdx = args.indexOf('--limit');
const limitRaw = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : NaN;
const summaryLimit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 10;
// Parse --concurrency <n> / -c <n> (1-16). Overrides EPISODIC_MEMORY_CONCURRENCY.
// Survives the --background fork: filteredArgs strips only --background, so the
// detached worker re-parses the flag and honors the same value.
const concurrencyIdx = args.findIndex(arg => arg === '--concurrency' || arg === '-c');
let concurrency;
if (concurrencyIdx !== -1 && args[concurrencyIdx + 1]) {
    const value = parseInt(args[concurrencyIdx + 1], 10);
    if (value >= 1 && value <= 16)
        concurrency = value;
}
// If background mode, fork the process and exit immediately
if (isBackground) {
    const filteredArgs = args.filter(arg => arg !== '--background');
    const logPath = getSyncLogPath();
    const logFd = fs.openSync(logPath, 'a');
    fs.writeSync(logFd, formatLogLine('info', `Starting background sync from pid ${process.pid}`));
    // Spawn a detached process
    const child = spawn(process.execPath, [
        process.argv[1], // This script
        ...filteredArgs
    ], {
        detached: true,
        stdio: ['ignore', logFd, logFd]
    });
    child.unref(); // Allow parent to exit
    console.log(`Sync started in background. Log: ${logPath}`);
    process.exit(0);
}
const sourceDirs = getConversationSourceDirs();
const destDir = getArchiveDir();
if (sourceDirs.length === 0) {
    console.log('⚠️  No conversation source directories found.');
    console.log('  Checked: ~/.claude/projects, ~/.claude/transcripts, and ~/.codex/sessions');
    if (process.env.CLAUDE_CONFIG_DIR) {
        console.log(`  CLAUDE_CONFIG_DIR is set to: ${process.env.CLAUDE_CONFIG_DIR}`);
    }
    process.exit(0);
}
// Single-instance lock (#97). Independent SessionStart events from multiple
// Claude Code sessions each fire `sync --background`; without a lock the
// detached workers race the SQLite write path and pile up Claude subprocesses
// for summarization. Acquire on the worker path — after the --background fork
// has already returned and the source-dir check passed — and release on every
// exit. Complements the reentrancy guard above (#87), which covers a different
// cascade (summarizer-spawned syncs).
const syncLockPath = path.join(path.dirname(getSyncLogPath()), 'episodic-memory-sync.lock');
const syncLock = acquireFileLock(syncLockPath);
if (!syncLock) {
    const holder = readLockHolder(syncLockPath);
    const holderLabel = holder !== null ? `pid ${holder}` : 'another process';
    console.error(`episodic-memory: sync already running (${holderLabel}); skipping`);
    process.exit(0);
}
const releaseSyncLockOnce = () => {
    if (releaseSyncLockOnce.done)
        return;
    releaseSyncLockOnce.done = true;
    releaseFileLock(syncLock);
};
process.on('exit', releaseSyncLockOnce);
process.on('SIGINT', () => { releaseSyncLockOnce(); process.exit(130); });
process.on('SIGTERM', () => { releaseSyncLockOnce(); process.exit(143); });
process.on('SIGHUP', () => { releaseSyncLockOnce(); process.exit(129); });
const tildify = (p) => (p.startsWith(os.homedir()) ? '~' + p.slice(os.homedir().length) : p);
console.log(`Archive: ${tildify(destDir)}  ·  Log: ${tildify(getLogPath())}`);
const isCodexSource = (sourceDir) => sourceDir.includes(`${path.sep}.codex${path.sep}`);
/**
 * One list across every source plus archive-only projects (live transcripts
 * deleted), with worktrees folded into their repo, sorted by display name.
 */
function planProjects() {
    const members = [];
    const covered = new Set();
    for (const sourceDir of sourceDirs) {
        for (const project of listSourceProjects(sourceDir)) {
            members.push({ project, sourceDir });
            covered.add(project);
        }
    }
    for (const project of listArchiveProjects(destDir)) {
        if (!covered.has(project))
            members.push({ project });
    }
    const codexProjects = new Set(members.filter(m => m.sourceDir && isCodexSource(m.sourceDir)).map(m => m.project));
    return groupProjects(members)
        .map(group => ({ ...group, label: codexProjects.has(group.key) ? `codex ${group.key}` : undefined }))
        .sort((a, b) => (a.label ?? fullProjectName(a.key)).localeCompare(b.label ?? fullProjectName(b.key), 'en', { sensitivity: 'base' }));
}
async function syncAll() {
    const startedAt = Date.now();
    const reporter = createSyncReporter();
    if (process.stderr.isTTY)
        setConsoleInfoMuted(true);
    const session = createSyncSession(destDir, { summaryLimit, concurrency, onEvent: event => reporter.onEvent(event) });
    let exchanges = 0;
    let finished = false;
    try {
        const groups = planProjects();
        reporter.start(groups.length);
        for (const [i, group] of groups.entries()) {
            const index = i + 1;
            const total = groups.length;
            const project = group.key;
            const label = group.label;
            reporter.onEvent({ type: 'project-start', project, label, index, total });
            const sum = { copied: 0, indexed: 0, exchanges: 0, errors: 0 };
            for (const member of group.members) {
                const onProgress = (done, of) => reporter.onEvent({ type: 'project-progress', project, label, index, total, done, of });
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
    }
    finally {
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
async function runEmbeddingMigrationPhase() {
    // initDatabase() must be inside the try: opening the DB loads the sqlite-vec
    // native extension, which can throw transiently (e.g. a partial install
    // during `/plugin update`, before the platform dylib has landed). That must
    // log-and-skip the optional migration, never abort the whole sync and exit 1
    // — which would discard the summaries already completed this run.
    let db;
    try {
        db = initDatabase();
        const stale = countStale(db);
        if (stale === 0)
            return;
        console.error(`\nepisodic-memory: ${stale} exchange(s) on the old embedding model — migrating up to ${MIGRATION_BATCH_SIZE} this run`);
        await initEmbeddings();
        const indexDir = getIndexDir();
        const done = await runMigrationBatch(db, indexDir, MIGRATION_BATCH_SIZE, generateExchangeEmbedding);
        if (done > 0) {
            const after = countStale(db);
            console.error(`episodic-memory: re-embedded ${done} (${after} still stale; will resume on next sync)`);
        }
    }
    catch (err) {
        console.error('episodic-memory: migration phase error:', err instanceof Error ? err.message : err);
    }
    finally {
        db?.close();
    }
}
syncAll()
    .then(() => closeLog())
    .catch(error => {
    console.error('Error syncing:', error);
    closeLog();
    process.exit(1);
});
