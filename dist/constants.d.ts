/**
 * Marker text that identifies summarizer agent conversations.
 * When this text appears in a conversation, it will be excluded from indexing.
 * Used in summarizer prompts to prevent agent conversations from polluting search results.
 */
export declare const SUMMARIZER_CONTEXT_MARKER = "Context: This summary will be shown in a list to help users and Claude choose which conversations are relevant";
/**
 * Default per-message character cap applied when exchanges are built for indexing.
 * Override with EPISODIC_MEMORY_MAX_MESSAGE_CHARS (positive int; 0 disables the cap).
 */
export declare const DEFAULT_MAX_MESSAGE_CHARS = 100000;
