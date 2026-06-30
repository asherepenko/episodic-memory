import type { IndexStats } from './stats.js';
/**
 * Everything `status` needs, gathered by status-cli and passed in so the
 * report formatting stays pure and unit-testable (mirrors doctor.ts).
 */
export interface StatusInput {
    dbPath: string;
    dbExists: boolean;
    nativeBindingOk: boolean;
    nativeBindingError?: string;
    stats: IndexStats;
    staleEmbeddings: number;
    /** conversations permanently skipped (attempts >= MAX_ATTEMPTS) */
    poison: number;
    /** ANTHROPIC_API_KEY or EPISODIC_MEMORY_API_BASE_URL present */
    apiEnvSet: boolean;
    /** ISO timestamp of the most recent sync run, if known */
    lastSync?: string;
    /** ISO "now" for relative-age formatting (injected for testability) */
    now: string;
}
export interface StatusReport {
    text: string;
    ok: boolean;
}
/**
 * Build the at-a-glance health report. `ok` reflects the core engine
 * (native binding loads + database present) — index emptiness and pending
 * summaries are normal early states, not failures.
 */
export declare function buildStatusReport(input: StatusInput): StatusReport;
