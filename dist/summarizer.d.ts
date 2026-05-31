import { ConversationExchange } from './types.js';
/**
 * Thrown by callClaude when the SDK yields an `is_error: true` result message.
 * Carries the SDK's `subtype` and `session_id` as typed fields so callers can
 * dispatch on structural metadata rather than parsing error message text (#93).
 */
export declare class SummarizerSdkError extends Error {
    readonly subtype: string;
    readonly sessionId?: string | undefined;
    constructor(subtype: string, sessionId?: string | undefined);
}
/**
 * True when the SDK's reported failure subtype indicates resume couldn't find
 * the session — the trigger for the non-resume fallback in summarizeConversation.
 */
export declare function isResumeFailure(error: unknown): boolean;
/**
 * Whether an SDK `type: 'result'` message represents a hard error.
 *
 * Only non-success subtypes (error_during_execution, error_max_turns, …) are
 * errors. A `subtype: 'success'` result can still carry `is_error: true` — an
 * independent boolean the SDK sets for a transient API issue on an otherwise
 * completed turn — and its `result` text is usable, handled by the normal
 * result path (including the thinking-budget retry). Throwing on that flag
 * regressed summarization in 1.4.6 ("Summarizer SDK error: success"), so the
 * discriminant is the subtype, not is_error.
 */
export declare function isSdkErrorResult(message: unknown): boolean;
export declare class SummarizerTimeoutError extends Error {
    constructor(timeoutMs: number);
}
export interface CodexSummarizerCommand {
    command: string;
    args: string[];
    prompt: string;
    sessionId: string;
    model?: string;
    versionArgs?: string[];
    skipVersionCheck?: boolean;
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
export declare function buildCodexSummaryPrompt(): string;
export declare function buildCodexSummarizerCommand(args: {
    sessionId: string;
    prompt: string;
    model?: string;
    codexBin?: string;
}): CodexSummarizerCommand;
export declare function runCodexCommand(command: CodexSummarizerCommand): Promise<string>;
/**
 * Resolve the model to pass into Codex `thread/fork` for summarization.
 *
 * Historical exchanges may carry deprecated model ids (e.g. `gpt-5.2-codex`),
 * and `-codex`-suffixed variants are API-key-only — ChatGPT-subscription users
 * get a 400 from `app-server` regardless of the suffix used. Reading the model
 * from history therefore breaks summarization for two large user populations.
 *
 * Default to `undefined` so `app-server` uses the current Codex config
 * (`~/.codex/config.toml#model`). Operators can override via
 * `EPISODIC_MEMORY_CODEX_MODEL` if they need a specific model id (#99, obra#98).
 */
export declare function getCodexModel(_exchanges: ConversationExchange[]): string | undefined;
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
