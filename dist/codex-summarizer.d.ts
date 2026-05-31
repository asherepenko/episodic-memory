export interface CodexSummarizerCommand {
    command: string;
    args: string[];
    prompt: string;
    sessionId: string;
    model?: string;
    versionArgs?: string[];
    skipVersionCheck?: boolean;
}
export declare function buildCodexSummaryPrompt(): string;
export declare function buildCodexSummarizerCommand(args: {
    sessionId: string;
    prompt: string;
    model?: string;
    codexBin?: string;
}): CodexSummarizerCommand;
export declare function runCodexCommand(command: CodexSummarizerCommand): Promise<string>;
/**
 * Deep entry point for Codex-native summarization. Builds the app-server
 * command and runs the fork→turn lifecycle, returning the raw agent message
 * text. The summarization domain (summarizer.ts) depends on this session-in /
 * text-out interface, not on the JSON-RPC transport internals below.
 */
export declare function runCodexSummary(sessionId: string, prompt: string, model?: string, codexBin?: string): Promise<string>;
