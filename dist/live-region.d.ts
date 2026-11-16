import type { ProgressOutput } from './progress.js';
/**
 * The bottom-of-terminal area that redraws in place: spinner rows and a
 * progress bar. Every command (sync, status, search, …) draws through one of
 * these, so they all animate the same way.
 *
 * Why a worker thread: SQLite (better-sqlite3) and most fs calls here are
 * synchronous. While one runs, the main thread's timers can't fire and a
 * setInterval spinner freezes. The worker owns a copy of the live lines in
 * shared memory and keeps ticking the spinner and elapsed time on its own.
 * Main and worker take a shared lock around every terminal write, so content
 * lines and spinner frames never interleave. Main writes synchronously, so a
 * `process.exit()` right after the last line loses nothing.
 *
 * Off a terminal nothing is drawn. With a stream that has no fd (tests), the
 * ticker falls back to a main-thread setInterval.
 */
export declare const FRAMES: string[];
export declare const FRAME_INTERVAL_MS = 120;
export declare const CLEAR_LINE = "\r\u001B[2K";
export declare const CURSOR_UP = "\u001B[1A";
/** Placeholders a live line may contain; filled on every frame. */
export declare const FRAME_TOKEN = "\u0001";
export declare const ELAPSED_TOKEN = "\u0002";
export declare function formatDuration(ms: number): string;
/** Cut a line to `width` visible columns, keeping ANSI codes intact. */
export declare function fitWidth(text: string, width: number): string;
export declare function fillTokens(text: string, frame: number, elapsedMs: number): string;
export interface LiveRegionOptions {
    now?: () => number;
    /** Force the main-thread ticker (tests); the worker is used when output has an fd. */
    worker?: boolean;
}
export interface LiveRegion {
    readonly tty: boolean;
    /**
     * Replace the live lines. Lines may hold FRAME_TOKEN / ELAPSED_TOKEN;
     * `startedAt` anchors the elapsed time. An empty array clears the region.
     */
    set(lines: string[], startedAt?: number): void;
    /** Write finished content above the live lines (to `target`, default the live stream). */
    print(text: string, target?: ProgressOutput): void;
    /** Clear the live lines and stop ticking. */
    stop(): void;
}
/** One region per stream; commands share it so two renderers never fight over the rows. */
export declare function createLiveRegion(output: ProgressOutput, options?: LiveRegionOptions): LiveRegion;
