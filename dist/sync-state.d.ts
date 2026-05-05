declare const MAX_ATTEMPTS = 3;
interface FailureEntry {
    attempts: number;
    lastError: string;
    lastAttempt: string;
}
interface SyncState {
    failures: Record<string, FailureEntry>;
}
export declare function loadState(): SyncState;
export declare function saveState(state: SyncState): void;
export declare function shouldSkipFailed(state: SyncState, filePath: string): boolean;
export declare function recordFailure(state: SyncState, filePath: string, error: string): void;
export declare function clearFailure(state: SyncState, filePath: string): void;
export declare function countSkippedPoisonPills(state: SyncState): number;
export { MAX_ATTEMPTS };
