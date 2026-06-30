import { getIndexStats, formatStats } from './stats.js';
import { countSyncStates } from './sync/index.js';

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Usage: episodic-memory stats

Display statistics about the indexed conversation archive.

Shows:
- Total conversations and exchanges
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

getIndexStats()
  .then(stats => {
    // Poison count is filesystem-derived (archive sidecars), kept out of
    // getIndexStats so it stays DB-only and isolated under unit tests.
    try {
      stats.poisonConversations = countSyncStates().poison;
    } catch {
      // archive dir may not exist before the first sync
    }
    console.log(formatStats(stats));
  })
  .catch(error => {
    console.error('Error getting stats:', error);
    process.exit(1);
  });
