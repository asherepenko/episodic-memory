import type { SyncEvent } from './sync/index.js';
import { type ProgressOutput } from './progress.js';
/**
 * Claude encodes a project's cwd as its dir name ("/" → "-"). Strip the home
 * dir and a leading Projects- so rows show "auto-claude", not
 * "-Users-andrew-Projects-auto-claude". Untruncated; use for sorting.
 */
export declare function fullProjectName(project: string, home?: string): string;
export declare function displayProjectName(project: string, home?: string): string;
export declare function formatRow(index: number, total: number, name: string, symbol: string, detail: string): string;
export declare function formatDuration(ms: number): string;
export declare function formatBar(done: number, total: number): string;
export interface SyncReporterOptions {
    color?: boolean;
    home?: string;
    /** Clock for the elapsed time on the progress bar (tests). */
    now?: () => number;
}
export interface SyncReporter {
    onEvent(event: SyncEvent): void;
    /** Show a progress bar under the rows, sized to this many rows. Summaries add to it as they start. */
    start(totalRows: number): void;
    /** Start a section. Its heading prints lazily, before the section's first row. */
    heading(text: string): void;
    /** Stop the spinner. With `summary`, end on a full bar: "━━━  61/61 · <summary>". */
    finish(summary?: string): void;
}
/**
 * Renders sync progress as one aligned row per project or summary, with a
 * dim "└ N worktrees" line under rows that fold worktrees in.
 * On a terminal the running row shows a yellow spinner and a progress bar
 * sits below the rows; both are redrawn in place. Off a terminal (the
 * background hook log) there is no spinner or bar and only rows with news print.
 */
export declare function createSyncReporter(output?: ProgressOutput, options?: SyncReporterOptions): SyncReporter;
