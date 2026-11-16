export interface ProgressOutput {
    isTTY?: boolean;
    write(message: string): unknown;
}
export interface ActiveProgress {
    writeLine(message: string): void;
}
/** Register (or clear) the renderer that owns the terminal's live rows. */
export declare function setActiveProgress(progress: ActiveProgress | undefined): void;
/** Write a terminal line without corrupting an active spinner. */
export declare function writeProgressAwareLine(message: string, fallback: () => void): void;
