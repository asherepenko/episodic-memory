export declare const DEFAULT_BUSY_TIMEOUT_MS = 5000;
/** True for "1", "true", "yes" (case-insensitive, trimmed). */
export declare function isTruthyEnv(value: string | undefined): boolean;
/** Automatic (hook-driven, `--background`) sync is switched off. A manual foreground sync is unaffected. */
export declare function isAutoSyncDisabled(env?: NodeJS.ProcessEnv): boolean;
/** Copy and index still run; the summary pass is skipped. */
export declare function areSummariesSkipped(env?: NodeJS.ProcessEnv): boolean;
/** SQLite busy timeout in ms: non-negative integer from env, else the default. */
export declare function resolveBusyTimeoutMs(env?: NodeJS.ProcessEnv): number;
