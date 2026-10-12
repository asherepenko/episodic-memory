import { getIndexStats, renderStats, countPendingIndex } from './stats.js';
import { createUi, plural } from './cli-ui.js';
import { countSyncStates } from './sync/index.js';
import { getArchiveDir } from './paths.js';

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Usage: episodic-memory stats

Display statistics about the indexed conversation archive.

Shows:
- Total conversations and exchanges, and transcripts waiting to be indexed
- Conversations with/without AI summaries
- Date range coverage
- Project breakdown
- Top projects by conversation count
- Stale embeddings and permanently-skipped (poison) conversations

EXAMPLES:
  # Show index statistics
  episodic-memory stats
`);
  process.exit(0);
}

async function main(): Promise<void> {
  const ui = createUi();
  const startedAt = Date.now();
  const stats = await ui.task('reading index...', async () => {
    const result = await getIndexStats();
    // Poison count is filesystem-derived (archive sidecars), kept out of
    // getIndexStats so it stays DB-only and isolated under unit tests.
    try {
      result.poisonConversations = countSyncStates().poison;
    } catch {
      // archive dir may not exist before the first sync
    }
    try {
      result.pendingIndex = countPendingIndex(getArchiveDir());
    } catch {
      // unreadable archive — leave the line out
    }
    return result;
  });
  renderStats(ui, stats);
  ui.done(startedAt, [plural(stats.totalConversations, 'conversation'), plural(stats.totalExchanges, 'exchange')], { verb: 'read' });
}

main().catch(error => {
  console.error('Error getting stats:', error);
  process.exit(1);
});
