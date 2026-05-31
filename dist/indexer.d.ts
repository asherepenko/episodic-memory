import { type SyncState } from './sync/conversation-sync-state.js';
/**
 * Queue decision for the indexer path, driven by ConversationSyncState.
 *
 * Complete → already summarized, skip. Poison past the retry threshold
 * (isRetriable false) → skip. Everything else (pending/stale/inProgress, and
 * still-retriable poison) → queue. This replaces the legacy
 * `shouldQueueForSummary('-summary.txt')` gating; the sidecar is the sole
 * queue/retry authority.
 */
export declare function shouldQueueForSummaryState(state: SyncState): boolean;
export declare function indexConversations(limitToProject?: string, maxConversations?: number, concurrency?: number, noSummaries?: boolean): Promise<void>;
export declare function indexSession(sessionId: string, concurrency?: number, noSummaries?: boolean): Promise<void>;
export declare function indexUnprocessed(concurrency?: number, noSummaries?: boolean): Promise<void>;
