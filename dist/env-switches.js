const TRUTHY = new Set(['1', 'true', 'yes']);
export const DEFAULT_BUSY_TIMEOUT_MS = 5000;
/** True for "1", "true", "yes" (case-insensitive, trimmed). */
export function isTruthyEnv(value) {
    return value !== undefined && TRUTHY.has(value.trim().toLowerCase());
}
/** Automatic (hook-driven, `--background`) sync is switched off. A manual foreground sync is unaffected. */
export function isAutoSyncDisabled(env = process.env) {
    return isTruthyEnv(env.EPISODIC_MEMORY_DISABLE_AUTO_SYNC);
}
/** Copy and index still run; the summary pass is skipped. */
export function areSummariesSkipped(env = process.env) {
    return isTruthyEnv(env.EPISODIC_MEMORY_SKIP_SUMMARIES);
}
/** SQLite busy timeout in ms: non-negative integer from env, else the default. */
export function resolveBusyTimeoutMs(env = process.env) {
    const raw = env.EPISODIC_MEMORY_BUSY_TIMEOUT_MS?.trim();
    if (raw === undefined || !/^\d+$/.test(raw))
        return DEFAULT_BUSY_TIMEOUT_MS;
    return Number(raw);
}
