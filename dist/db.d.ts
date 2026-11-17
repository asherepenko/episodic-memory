import Database from 'better-sqlite3';
import { ConversationExchange } from './types.js';
/**
 * Open the SQLite database, self-healing the better-sqlite3 native binding if
 * it fails to load. A Node upgrade after install changes the ABI and breaks the
 * compiled `.node` (postinstall can't catch this — it only runs at install).
 * On a binding error we rebuild in place and retry once; anything else, or a
 * still-broken binding after the rebuild, propagates with the real error.
 */
export declare function openDatabase(dbPath: string, options?: Database.Options): Database.Database;
export declare function migrateSchema(db: Database.Database): void;
/**
 * Earlier versions created `tool_calls` with a plain
 * `FOREIGN KEY (exchange_id) REFERENCES exchanges(id)`.
 * Without ON DELETE CASCADE, deleting an exchange that had tool calls
 * raised SQLITE_CONSTRAINT_FOREIGNKEY (#81), and orphans accumulated.
 *
 * This migration:
 *   1. Detects the legacy schema by inspecting sqlite_master.sql.
 *   2. Drops orphaned tool_calls rows.
 *   3. Recreates the table with ON DELETE CASCADE and copies surviving rows.
 */
export declare function migrateToolCallsCascade(db: Database.Database): void;
export declare function initDatabase(): Database.Database;
/**
 * BM25 lexical index over both sides of every exchange. External content:
 * the text lives once, in `exchanges`; triggers keep the token index in step.
 * `_` is a token character so snake_case identifiers stay whole.
 * A database created before the index existed gets it built on first open.
 */
export declare function ensureLexicalIndex(db: Database.Database): void;
/**
 * One row per archived transcript that indexing has finished with, including
 * files that produced zero exchanges (exclusion markers, metadata-only). Sync
 * indexes any archived file with no row, or whose mtime is newer than its row.
 * Keying on this instead of "copied this run" is what lets a sync that crashed
 * between copy and index heal on the next run.
 */
export declare function ensureIndexedFilesTable(db: Database.Database): void;
export declare function getIndexedFileMtimes(db: Database.Database): Map<string, number>;
export declare function markFileIndexed(db: Database.Database, archivePath: string, mtimeMs: number, exchangeCount: number): void;
export declare function insertExchange(db: Database.Database, exchange: ConversationExchange, embedding: number[], toolNames?: string[]): void;
export declare function getAllExchanges(db: Database.Database): Array<{
    id: string;
    archivePath: string;
}>;
export declare function getFileLastIndexed(db: Database.Database, archivePath: string): number | null;
/**
 * Forget everything indexed from one archived conversation, so it is indexed
 * again from scratch. Needed when the file was rewritten and its line numbers
 * moved: exchange ids hash the line range, so stale rows would otherwise stay.
 * Returns the number of exchanges removed.
 */
export declare function purgeArchivePath(db: Database.Database, archivePath: string): number;
export declare function deleteExchange(db: Database.Database, id: string): void;
