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
export declare function insertExchange(db: Database.Database, exchange: ConversationExchange, embedding: number[], toolNames?: string[]): void;
export declare function getAllExchanges(db: Database.Database): Array<{
    id: string;
    archivePath: string;
}>;
export declare function getFileLastIndexed(db: Database.Database, archivePath: string): number | null;
export declare function deleteExchange(db: Database.Database, id: string): void;
