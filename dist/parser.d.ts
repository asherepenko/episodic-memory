import { ConversationExchange } from './types.js';
export declare function resolveMaxMessageChars(raw?: string | undefined): number;
/**
 * Bound a message to roughly `max` chars: keep the first 60% and last 40% of the
 * budget around an omission marker. `max <= 0` disables the cap. Never splits a
 * surrogate pair.
 */
export declare function capMessageText(text: string, max?: number): string;
export declare function parseConversation(filePath: string, projectName: string, archivePath: string): Promise<ConversationExchange[]>;
/**
 * Convenience function to parse a conversation file
 * Extracts project name from the file path and returns exchanges with metadata
 */
export declare function parseConversationFile(filePath: string): Promise<{
    project: string;
    exchanges: ConversationExchange[];
}>;
