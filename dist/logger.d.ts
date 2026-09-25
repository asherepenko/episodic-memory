export declare function getLogPath(): string;
/**
 * Keep info lines out of the terminal (they still go to sync.log). The sync
 * TUI turns this on so per-chunk summarizer chatter doesn't bury the rows;
 * warnings and errors still print.
 */
export declare function setConsoleInfoMuted(muted: boolean): void;
export declare const log: {
    info(msg: string): void;
    warn(msg: string): void;
    error(msg: string): void;
    debug(msg: string): void;
};
export declare function closeLog(): void;
