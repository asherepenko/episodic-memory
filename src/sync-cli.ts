import { syncConversations } from './sync.js';
import { getArchiveDir, getConversationSourceDirs } from './paths.js';
import { closeLog, getLogPath } from './logger.js';
import { spawn } from 'child_process';

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Usage: episodic-memory sync [--background] [--limit <n>]

Sync conversations from ~/.claude/projects to archive and index them.

This command:
1. Copies new or updated .jsonl files to conversation archive
2. Generates embeddings for semantic search
3. Updates the search index

Only processes files that are new or have been modified since last sync.
Safe to run multiple times - subsequent runs are fast no-ops.

OPTIONS:
  --background    Run sync in background (for hooks, returns immediately)
  --limit <n>     Max summaries to generate per run (default: 10)

ENV:
  EPISODIC_MEMORY_API_TIMEOUT_MS    Per-call Claude SDK timeout (default: 180000)
  EPISODIC_MEMORY_CONCURRENCY       Parallel summary workers (default: 2)
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

// If background mode, fork the process and exit immediately
if (isBackground) {
  const filteredArgs = args.filter(arg => arg !== '--background');

  // Spawn a detached process
  const child = spawn(process.execPath, [
    process.argv[1], // This script
    ...filteredArgs
  ], {
    detached: true,
    stdio: 'ignore'
  });

  child.unref(); // Allow parent to exit
  console.log('Sync started in background...');
  process.exit(0);
}

const sourceDirs = getConversationSourceDirs();
const destDir = getArchiveDir();

if (sourceDirs.length === 0) {
  console.log('⚠️  No conversation source directories found.');
  console.log('  Checked: ~/.claude/projects and ~/.claude/transcripts');
  if (process.env.CLAUDE_CONFIG_DIR) {
    console.log(`  CLAUDE_CONFIG_DIR is set to: ${process.env.CLAUDE_CONFIG_DIR}`);
  }
  process.exit(0);
}

console.log('Syncing conversations...');
console.log(`Sources: ${sourceDirs.join(', ')}`);
console.log(`Destination: ${destDir}`);
console.log(`Log: ${getLogPath()} (tail -f for live progress)\n`);

async function syncAll() {
  const totals = { copied: 0, skipped: 0, indexed: 0, summarized: 0, errors: [] as Array<{file: string; error: string}>, sourcesWithSummaryWork: 0, totalNeedingSummaries: 0 };

  for (const sourceDir of sourceDirs) {
    const result = await syncConversations(sourceDir, destDir, { summaryLimit });
    totals.copied += result.copied;
    totals.skipped += result.skipped;
    totals.indexed += result.indexed;
    totals.summarized += result.summarized;
    totals.errors.push(...result.errors);
  }

  console.log(`\n✅ Sync complete!`);
  console.log(`  Copied: ${totals.copied}`);
  console.log(`  Skipped: ${totals.skipped}`);
  console.log(`  Indexed: ${totals.indexed}`);
  console.log(`  Summarized: ${totals.summarized}`);

  if (totals.errors.length > 0) {
    console.log(`\n⚠️  Errors: ${totals.errors.length}`);
    totals.errors.forEach(err => console.log(`  ${err.file}: ${err.error}`));

    // Help diagnose silent summarization failures (#70)
    const summaryErrors = totals.errors.filter(e => e.error.startsWith('Summary generation failed'));
    if (summaryErrors.length > 0 && totals.summarized === 0) {
      console.log(`\n💡 All ${summaryErrors.length} summarization attempts failed.`);
      console.log(`  Check your API configuration (EPISODIC_MEMORY_API_BASE_URL / ANTHROPIC_API_KEY).`);
    }
  }
}

syncAll()
  .then(() => closeLog())
  .catch(error => {
    console.error('Error syncing:', error);
    closeLog();
    process.exit(1);
  });
