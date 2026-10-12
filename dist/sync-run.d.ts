export declare const tildify: (p: string) => string;
/**
 * Take the single-instance sync lock (#97) and release it on every exit.
 * Returns a "held by" label when another process already has it.
 */
export declare function acquireSyncLock(): {
    ok: true;
} | {
    ok: false;
    holder: string;
};
export interface RunSyncOptions {
    summaryLimit?: number;
    concurrency?: number;
    skipSummaries?: boolean;
}
/**
 * Copy, index and summarize every project with the grouped terminal report,
 * then run a batch of embedding migration. Shared by `sync` and `index`.
 */
export declare function runSync(options?: RunSyncOptions): Promise<void>;
