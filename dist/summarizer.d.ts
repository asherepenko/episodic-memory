import { ConversationExchange } from './types.js';
export declare class SummarizerTimeoutError extends Error {
    constructor(timeoutMs: number);
}
export declare function getApiEnv(): Record<string, string | undefined> | undefined;
/**
 * Detect whether the current process is running inside the Claude Agent SDK
 * subprocess that the summarizer just spawned. The flag is set by getApiEnv()
 * and inherited by the spawned subprocess. Used by sync entry points to bail
 * out before re-entering the sync→summarizer→spawn cycle (#87).
 */
export declare function shouldSkipReentrantSync(): boolean;
export declare function formatConversationText(exchanges: ConversationExchange[]): string;
/**
 * Fast pre-filter: returns a trivial summary if the conversation has no
 * substantive user prose, otherwise null (caller should run full SDK summary).
 *
 * Catches: only slash-commands, only ack words, total user text <500 chars,
 * empty assistant outputs.
 */
export declare function detectTrivial(exchanges: ConversationExchange[]): string | null;
export interface SummarizeOptions {
    sessionId?: string;
    /** Pre-existing chunk summaries (resumption from a previous run). */
    initialChunkSummaries?: string[];
    /** Called after each chunk completes; caller persists. */
    onChunkComplete?: (chunkSummaries: string[], totalChunks: number, totalExchanges: number) => void;
}
export declare function summarizeConversation(exchanges: ConversationExchange[], optsOrSessionId?: string | SummarizeOptions): Promise<string>;
