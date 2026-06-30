/**
 * Per-conversation SyncState store.
 *
 * Sidecar `<conv>.sync.json` lives next to the archived `.jsonl`. Owns the
 * full lifecycle (Pending/InProgress/Complete/Stale/Poison). Replaces the
 * legacy split between `sync-state.ts` (global failure map) and `partial.ts`
 * (per-conv resumable chunks).
 *
 * Failure tracking note: every recordFailure call writes a `poison` sidecar
 * with an incremented `attempts`. Callers use `isRetriable` to decide whether
 * to skip — the store does not distinguish "failing but retriable" from
 * "permanently poisoned".
 */
export declare const MAX_ATTEMPTS = 3;
export type SyncStateKind = 'pending' | 'inProgress' | 'complete' | 'stale' | 'poison';
export type SyncState = {
    kind: 'pending';
} | {
    kind: 'inProgress';
    chunkSummaries: string[];
    totalChunks: number;
    totalExchanges: number;
    lastUpdated: string;
} | {
    kind: 'complete';
    lastUpdated: string;
} | {
    kind: 'stale';
    lastUpdated: string;
} | {
    kind: 'poison';
    attempts: number;
    lastError: string;
    lastAttempt: string;
};
export interface ConversationSyncStateStore {
    load(jsonlPath: string): SyncState;
    save(jsonlPath: string, next: SyncState): void;
    recordFailure(jsonlPath: string, error: string): SyncState;
    clearFailure(jsonlPath: string): void;
    markStale(jsonlPath: string): SyncState;
    countPoison(): number;
}
export declare function sidecarPathFor(jsonlPath: string): string;
export declare function isRetriable(state: SyncState): boolean;
export interface SyncStateCounts {
    total: number;
    complete: number;
    pending: number;
    inProgress: number;
    stale: number;
    /** attempts >= MAX_ATTEMPTS — permanently skipped until EPISODIC_MEMORY_RETRY_ALL */
    poison: number;
    /** failed but still under the retry threshold */
    poisonRetriable: number;
    /** most recent successful-activity timestamp across sidecars */
    newestLastUpdated?: string;
}
/**
 * Tally every `.sync.json` sidecar under the archive by kind. Used by the
 * `status`/`stats` surfaces to report permanently-skipped (poison) conversations
 * and overall summary progress without opening the DB. Reads sidecars directly
 * (not via the store's load(), which would apply RETRY_ALL masking and legacy
 * migration); corrupt or wrong-version sidecars are skipped silently.
 */
export declare function countSyncStates(opts?: {
    archiveDir?: string;
}): SyncStateCounts;
export declare function openConversationSyncStateStore(opts?: {
    archiveDir?: string;
}): ConversationSyncStateStore;
export declare function openMemoryConversationSyncStateStore(): ConversationSyncStateStore;
