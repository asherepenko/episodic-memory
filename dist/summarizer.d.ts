import { ConversationExchange } from './types.js';
export declare class SummarizerTimeoutError extends Error {
    constructor(timeoutMs: number);
}
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
    /** Path to *-summary.partial.json for resumable hierarchical chunking (#3). */
    partialPath?: string;
}
export declare function summarizeConversation(exchanges: ConversationExchange[], optsOrSessionId?: string | SummarizeOptions): Promise<string>;
