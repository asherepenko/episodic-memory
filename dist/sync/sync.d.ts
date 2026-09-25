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
/**
 * Progress events for terminal rendering. One project-start/project-done pair
 * per project (copy + index), then one summary-start/summary-done pair per
 * summarized conversation. `index` is 1-based within `total`; summary-done is
 * numbered in completion order. `label` overrides the displayed name and
 * `worktrees` counts worktree dirs folded into the row.
 */
export type SyncEvent = {
    type: 'project-start';
    project: string;
    index: number;
    total: number;
    label?: string;
} | {
    type: 'project-progress';
    project: string;
    index: number;
    total: number;
    done: number;
    of: number;
    label?: string;
} | {
    type: 'project-done';
    project: string;
    index: number;
    total: number;
    copied: number;
    indexed: number;
    exchanges: number;
    errors: number;
    label?: string;
    worktrees?: number;
} | {
    type: 'summary-start';
    file: string;
    project: string;
    index: number;
    total: number;
} | {
    type: 'summary-done';
    file: string;
    project: string;
    index: number;
    total: number;
    ms: number;
    ok: boolean;
    error?: string;
};
export interface SyncOptions {
    skipIndex?: boolean;
    skipSummaries?: boolean;
    summaryLimit?: number;
    concurrency?: number;
    onEvent?: (event: SyncEvent) => void;
}
export interface IndexArchiveOptions {
    /** Archive project dirs already handled by a source pass this run. */
    skipProjects?: ReadonlySet<string>;
    onEvent?: (event: SyncEvent) => void;
}
/**
 * Resolve the parallel-summary-worker count.
 * Precedence: explicit option (the `--concurrency` flag) > EPISODIC_MEMORY_CONCURRENCY env > default 2.
 * Non-positive or non-numeric inputs fall through to the next source.
 */
export declare function resolveSummaryConcurrency(optionConcurrency: number | undefined, envValue: string | undefined): number;
export declare function extractSessionIdFromPath(filePath: string): string | null;
export interface ProjectOutcome {
    copied: number;
    indexed: number;
    exchanges: number;
    errors: number;
}
/**
 * One sync run over a shared archive, driven one project at a time so a caller
 * can order and group projects across sources. Summaries are collected while
 * projects sync and generated once, by summarize(), at the end.
 */
export interface SyncSession {
    /** Copy a source project's transcripts into the archive, then index its archive dir. */
    syncProject(sourceDir: string, project: string, onProgress?: (done: number, of: number) => void): Promise<ProjectOutcome>;
    /** Index an archive-only project dir (its live transcripts are gone). */
    indexProject(project: string, onProgress?: (done: number, of: number) => void): Promise<ProjectOutcome>;
    summarize(): Promise<void>;
    readonly result: SyncResult;
    close(): void;
}
export declare function createSyncSession(destDir: string, options?: SyncOptions): SyncSession;
/** Project dirs in a source, minus excluded ones, sorted. */
export declare function listSourceProjects(sourceDir: string): string[];
/** Archive project dirs, minus excluded ones, sorted. */
export declare function listArchiveProjects(destDir: string): string[];
/**
 * Index archive project dirs that no source pass covered — typically projects
 * whose live transcripts Claude Code has already deleted.
 */
export declare function indexArchive(destDir: string, options?: IndexArchiveOptions): Promise<SyncResult>;
export declare function syncConversations(sourceDir: string, destDir: string, options?: SyncOptions): Promise<SyncResult>;
