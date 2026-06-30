export interface SyncResult {
    copied: number;
    skipped: number;
    indexed: number;
    summarized: number;
    errors: Array<{
        file: string;
        error: string;
    }>;
}
export interface SyncOptions {
    skipIndex?: boolean;
    skipSummaries?: boolean;
    summaryLimit?: number;
    concurrency?: number;
}
/**
 * Resolve the parallel-summary-worker count.
 * Precedence: explicit option (the `--concurrency` flag) > EPISODIC_MEMORY_CONCURRENCY env > default 2.
 * Non-positive or non-numeric inputs fall through to the next source.
 */
export declare function resolveSummaryConcurrency(optionConcurrency: number | undefined, envValue: string | undefined): number;
export declare function extractSessionIdFromPath(filePath: string): string | null;
export declare function syncConversations(sourceDir: string, destDir: string, options?: SyncOptions): Promise<SyncResult>;
