import { type SyncState } from './sync/conversation-sync-state.js';
/**
 * Queue decision for the indexer path, driven by ConversationSyncState.
 *
 * Complete → already summarized, skip. Poison past the retry threshold
 * (isRetriable false) → skip. Everything else (pending/stale/inProgress, and
 * still-retriable poison) → queue. The sidecar is the sole queue/retry
 * authority; the `-summary.txt` file is pure derived content.
 */
export declare function shouldQueueForSummaryState(state: SyncState): boolean;
export interface IndexScope {
    projects: number;
    conversations: number;
}
/**
 * Cheap up-front scan of the work an index run faces: how many projects and
 * conversation files are in scope. Pure directory listing — no parsing, no DB —
 * so it can be reported before the slow archive/parse/summarize phase begins.
 * Mirrors the indexer's own walk: skips non-directories, excluded projects, and
 * projects with no .jsonl files; honors an optional single-project limit.
 */
export declare function scanIndexScope(sourceDirs: string[], excludedDirSet: Set<string>, limitToProject?: string): IndexScope;
export declare function indexConversations(limitToProject?: string, maxConversations?: number, concurrency?: number, noSummaries?: boolean): Promise<void>;
export declare function indexSession(sessionId: string, concurrency?: number, noSummaries?: boolean): Promise<void>;
export declare function indexUnprocessed(concurrency?: number, noSummaries?: boolean): Promise<void>;
