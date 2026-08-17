export interface ProgressOutput {
    isTTY?: boolean;
    write(message: string): unknown;
}
/** Write a terminal line without corrupting an active spinner row. */
export declare function writeProgressAwareLine(message: string, fallback: () => void): void;
export interface ProgressIndicator {
    start(): void;
    update(label: string): void;
    complete(label: string): void;
}
/**
 * Lightweight dependency-free progress feedback for long CLI operations.
 * stderr keeps progress out of stdout consumers and out of the MCP protocol.
 */
export declare function createProgressIndicator(label: string, output?: ProgressOutput): ProgressIndicator;
