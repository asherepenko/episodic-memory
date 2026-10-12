export declare const tildify: (p: string) => string;
/** Ask the running sync for one more pass when it finishes (a sync skipped on the lock). */
export declare function requestRerun(): void;
/** Consume a pending rerun request. True at most once per batch of requests. */
export declare function takeRerunRequest(): boolean;
export declare function acquireSyncLock(): {
    ok: true;
} | {
    ok: false;
    holder: string;
};
export interface RunSyncOptions {
    summaryLimit?: number;
    summaryBudgetMs?: number;
    concurrency?: number;
    skipSummaries?: boolean;
}
/**
 * Copy, index and summarize every project with the grouped terminal report,
 * then run a batch of embedding migration. Shared by `sync` and `index`.
 */
export declare function runSync(options?: RunSyncOptions): Promise<void>;
