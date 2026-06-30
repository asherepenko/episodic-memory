import fs from 'fs';
import { getDbPath } from './paths.js';
import { getSyncLogPath } from './logging.js';
import { getIndexStats, type IndexStats } from './stats.js';
import { openDatabase } from './db.js';
import { countStale } from './embedding-migration.js';
import { isNativeBindingError } from './native-binding.js';
import { countSyncStates } from './sync/index.js';
import { buildStatusReport } from './status.js';

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`Usage: episodic-memory status

At-a-glance health check: native binding, database, index coverage, last sync,
stale embeddings, and permanently-skipped (poison) conversations.

Exits non-zero if the core engine is unhealthy (native binding missing or
database not yet created).`);
  process.exit(0);
}

const EMPTY_STATS: IndexStats = {
  totalConversations: 0,
  conversationsWithSummaries: 0,
  conversationsWithoutSummaries: 0,
  totalExchanges: 0,
  projectCount: 0,
};

async function main(): Promise<void> {
  const dbPath = getDbPath();
  const dbExists = fs.existsSync(dbPath);

  let nativeBindingOk = true;
  let nativeBindingError: string | undefined;
  let staleEmbeddings = 0;
  let stats: IndexStats = EMPTY_STATS;

  // Opening the DB loads the better-sqlite3 native binding — so this doubles as
  // the binding health check. A native-binding failure is reported, not thrown.
  try {
    stats = await getIndexStats(dbPath);
    if (dbExists) {
      const db = openDatabase(dbPath, { readonly: true });
      try {
        staleEmbeddings = countStale(db);
      } finally {
        db.close();
      }
    }
  } catch (err) {
    if (isNativeBindingError(err)) {
      nativeBindingOk = false;
      nativeBindingError = err instanceof Error ? err.message : String(err);
    } else {
      throw err;
    }
  }

  let poison = 0;
  try {
    poison = countSyncStates().poison;
  } catch {
    // Archive dir may not exist before the first sync.
  }

  let lastSync: string | undefined;
  try {
    const logPath = getSyncLogPath();
    if (fs.existsSync(logPath)) lastSync = fs.statSync(logPath).mtime.toISOString();
  } catch {
    // No sync has run yet.
  }

  const apiEnvSet = !!(process.env.ANTHROPIC_API_KEY || process.env.EPISODIC_MEMORY_API_BASE_URL);

  const report = buildStatusReport({
    dbPath,
    dbExists,
    nativeBindingOk,
    nativeBindingError,
    stats,
    staleEmbeddings,
    poison,
    apiEnvSet,
    lastSync,
    now: new Date().toISOString(),
  });

  process.stdout.write(report.text);
  process.exit(report.ok ? 0 : 1);
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
