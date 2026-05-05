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
export declare function openConversationSyncStateStore(opts?: {
    archiveDir?: string;
}): ConversationSyncStateStore;
export declare function openMemoryConversationSyncStateStore(): ConversationSyncStateStore;
