import { getConversationSourceDirs } from './paths.js';
import { closeLog } from './logger.js';
import { shouldSkipReentrantSync } from './summarizer.js';
import { spawn } from 'child_process';
import fs from 'fs';
import { formatLogLine, getSyncLogPath } from './logging.js';
import { acquireSyncLock, runSync } from './sync-run.js';

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
let concurrency: number | undefined;
if (concurrencyIdx !== -1 && args[concurrencyIdx + 1]) {
  const value = parseInt(args[concurrencyIdx + 1], 10);
  if (value >= 1 && value <= 16) concurrency = value;
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
const lock = acquireSyncLock();
if (!lock.ok) {
  console.error(`episodic-memory: sync already running (${lock.holder}); skipping`);
  process.exit(0);
}

runSync({ summaryLimit, concurrency })
  .then(() => closeLog())
  .catch(error => {
    console.error('Error syncing:', error);
    closeLog();
    process.exit(1);
  });
