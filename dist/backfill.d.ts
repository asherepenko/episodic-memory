import type Database from 'better-sqlite3';
export interface BackfillOptions {
    archiveDir: string;
    /** Limit to one top-level archive project directory (exact name). */
    project?: string;
    dryRun: boolean;
    /** Index DB to purge rewritten files from. Opened with initDatabase() when omitted on a real run. */
    db?: Database.Database;
    /** Single-instance sync lock; a real run refuses while a sync holds it. */
    acquireLock?: () => {
        ok: true;
    } | {
        ok: false;
        holder: string;
    };
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
    failed: Array<{
        file: string;
        error: string;
    }>;
}
/** Distill already-archived conversations in place. */
export declare function backfillArchive(options: BackfillOptions): Promise<BackfillReport>;
export declare function formatBackfillReport(report: BackfillReport): string;
