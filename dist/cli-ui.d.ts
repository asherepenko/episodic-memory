import { type ProgressOutput } from './progress.js';
/**
 * Shared terminal look for every command, matching `sync`: bold section
 * headings, aligned rows with a colored status symbol, dim "└" details, a
 * yellow spinner with a progress bar for slow work, and a closing
 * "━━━ done in 12s · …" line.
 *
 * Content goes to stdout so it can be piped. The live spinner/bar goes to
 * stderr, and only when stderr is a terminal; off a terminal nothing animates.
 */
export declare const FRAMES: string[];
export declare const FRAME_INTERVAL_MS = 120;
export declare const CLEAR_LINE = "\r\u001B[2K";
export declare const CURSOR_UP = "\u001B[1A";
export declare const BAR_WIDTH = 22;
export declare const LABEL_WIDTH = 18;
export declare const ANSI: {
    readonly yellow: 33;
    readonly green: 32;
    readonly cyan: 36;
    readonly red: 31;
    readonly bold: 1;
    readonly dim: 2;
};
export type Tone = keyof typeof ANSI;
export declare const num: (n: number) => string;
export declare function plural(n: number, word: string, many?: string): string;
export declare function formatDuration(ms: number): string;
export declare function formatBar(done: number, total: number): string;
/** Cut the middle: the head says where a thing lives, the tail which one it is. */
export declare function truncateMiddle(text: string, width: number): string;
export declare function tildify(p: string, home?: string): string;
/** "3m ago", "2h ago", "5d ago" for a past instant. */
export declare function formatAgo(thenMs: number, nowMs?: number): string;
export type Status = 'ok' | 'warn' | 'fail' | 'new' | 'info';
export interface TaskProgress {
    /** Move the bar; `label` replaces the spinner text. */
    update(done: number, of: number, label?: string): void;
}
export interface Ui {
    readonly color: boolean;
    readonly interactive: boolean;
    paint(tone: Tone, text: string): string;
    /** Plain line on stdout (clears and redraws the live region around it). */
    line(text?: string): void;
    /** Blank line, then a bold heading. */
    heading(text: string): void;
    /** "  ✓  Label             detail" */
    row(status: Status, label: string, detail?: string): void;
    /** "     Label          value" — no symbol, for plain facts; aligned with row labels. */
    field(label: string, value: string): void;
    /** Dim "     └ text" under the previous row. */
    sub(text: string): void;
    /** Run slow work under a spinner (+ bar once `update` reports a total). */
    task<T>(label: string, work: (progress: TaskProgress) => Promise<T>): Promise<T>;
    /** Closing line: full green bar (red when !ok) and "done in 12s · a · b". */
    done(startedAt: number, parts: string[], options?: {
        ok?: boolean;
        verb?: string;
    }): void;
    /** y/N prompt on a terminal; returns `fallback` when not interactive. */
    confirm(question: string, fallback?: boolean): Promise<boolean>;
}
export interface UiOptions {
    out?: ProgressOutput;
    live?: ProgressOutput;
    color?: boolean;
    /** Stdin is a terminal (prompts allowed). */
    interactive?: boolean;
    now?: () => number;
}
export declare function createUi(options?: UiOptions): Ui;
