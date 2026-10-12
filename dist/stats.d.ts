import { type Ui } from './cli-ui.js';
export interface IndexStats {
    totalConversations: number;
    conversationsWithSummaries: number;
    conversationsWithoutSummaries: number;
    totalExchanges: number;
    dateRange?: {
        earliest: string;
        latest: string;
    };
    projectCount: number;
    topProjects?: Array<{
        project: string;
        count: number;
    }>;
    databaseSize?: string;
    /** exchanges still on an old embedding model (re-embedded incrementally on sync) */
    staleEmbeddings?: number;
    /** conversations permanently skipped after repeated summary failures; populated by the CLI layer */
    poisonConversations?: number;
    /** archived transcripts sync has not indexed yet; populated by the CLI layer */
    pendingIndex?: number;
}
/**
 * Archived transcripts that the next sync would index: no indexed_files row,
 * or modified since. Uses the same rule as sync, so 0 means search covers the
 * whole archive. Undefined when the DB predates indexed_files.
 */
export declare function countPendingIndex(archiveDir: string, dbPath?: string): number | undefined;
export declare function getIndexStats(dbPath?: string): Promise<IndexStats>;
/** "Jan 12 → Oct 13, 2026", or with both years when the range spans years. */
export declare function formatDateRange(earliest: string, latest: string): string;
/** Draw the stats report through the shared UI kit. */
export declare function renderStats(ui: Ui, stats: IndexStats): void;
/** Plain-text rendering (no color, no animation); same layout as the terminal. */
export declare function formatStats(stats: IndexStats): string;
