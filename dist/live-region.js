import { Worker } from 'worker_threads';
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
export const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
export const FRAME_INTERVAL_MS = 120;
export const CLEAR_LINE = '\r\u001b[2K';
export const CURSOR_UP = '\u001b[1A';
const HIDE_CURSOR = '\u001b[?25l';
const SHOW_CURSOR = '\u001b[?25h';
/** Placeholders a live line may contain; filled on every frame. */
export const FRAME_TOKEN = '\u0001';
export const ELAPSED_TOKEN = '\u0002';
/** Room left for tokens that grow after truncation ("12s" → "12m 59s"). */
const TOKEN_SLACK = 8;
export function formatDuration(ms) {
    const s = Math.round(ms / 1000);
    if (s < 60)
        return `${s}s`;
    return `${Math.floor(s / 60)}m ${s % 60}s`;
}
const ANSI_RE = /\u001b\[[0-9;?]*[A-Za-z]/y;
/** Cut a line to `width` visible columns, keeping ANSI codes intact. */
export function fitWidth(text, width) {
    if (width <= 0)
        return text;
    let visible = 0;
    let out = '';
    let i = 0;
    let cut = false;
    while (i < text.length) {
        ANSI_RE.lastIndex = i;
        const m = ANSI_RE.exec(text);
        if (m) {
            out += m[0];
            i += m[0].length;
            continue;
        }
        const ch = String.fromCodePoint(text.codePointAt(i));
        if (visible >= width - 1 && i + ch.length < text.length && !cut) {
            out += '…';
            cut = true;
        }
        if (!cut) {
            out += ch;
            visible++;
        }
        i += ch.length;
    }
    return cut ? out + '\u001b[0m' : out;
}
// Shared memory layout (Int32 slots, then a Float64, then UTF-8 text).
const LOCK = 0;
const HEIGHT = 1;
const TEXT_LEN = 2;
const FRAME = 3;
const STARTED_OFFSET = 16; // Float64 byte offset
const TEXT_OFFSET = 24;
const TEXT_CAPACITY = 16 * 1024;
export function fillTokens(text, frame, elapsedMs) {
    return text.split(FRAME_TOKEN).join(FRAMES[frame % FRAMES.length]).split(ELAPSED_TOKEN).join(formatDuration(elapsedMs));
}
function clearSequence(height) {
    let seq = '';
    for (let i = 1; i < height; i++)
        seq += CLEAR_LINE + CURSOR_UP;
    return seq + CLEAR_LINE;
}
// The worker repeats fillTokens/clearSequence: it is eval'd source with no imports.
const WORKER_SOURCE = `
const { workerData } = require('worker_threads');
const fs = require('fs');
const { sab, fd, frames, interval } = workerData;
const i32 = new Int32Array(sab);
const f64 = new Float64Array(sab, ${STARTED_OFFSET}, 1);
const bytes = new Uint8Array(sab, ${TEXT_OFFSET}, ${TEXT_CAPACITY});
const decoder = new TextDecoder();
const dur = ms => { const s = Math.round(ms / 1000); return s < 60 ? s + 's' : Math.floor(s / 60) + 'm ' + (s % 60) + 's'; };
const clear = h => { let s = ''; for (let i = 1; i < h; i++) s += '\\r\\u001b[2K\\u001b[1A'; return s + '\\r\\u001b[2K'; };
setInterval(() => {
  while (Atomics.compareExchange(i32, ${LOCK}, 0, 1) !== 0) Atomics.wait(i32, ${LOCK}, 1, 5);
  try {
    const len = i32[${TEXT_LEN}];
    if (len === 0) return;
    const frame = (i32[${FRAME}] + 1) % frames.length;
    i32[${FRAME}] = frame;
    const text = decoder.decode(bytes.slice(0, len))
      .split('\\u0001').join(frames[frame])
      .split('\\u0002').join(dur(Date.now() - f64[0]));
    const height = i32[${HEIGHT}];
    try { fs.writeSync(fd, clear(height) + text); } catch {}
    i32[${HEIGHT}] = text.split('\\n').length;
  } finally {
    Atomics.store(i32, ${LOCK}, 0);
    Atomics.notify(i32, ${LOCK});
  }
}, interval);
`;
/** One region per stream; commands share it so two renderers never fight over the rows. */
export function createLiveRegion(output, options = {}) {
    const tty = Boolean(output.isTTY);
    const now = options.now ?? Date.now;
    const sab = new SharedArrayBuffer(TEXT_OFFSET + TEXT_CAPACITY);
    const i32 = new Int32Array(sab);
    const f64 = new Float64Array(sab, STARTED_OFFSET, 1);
    const bytes = new Uint8Array(sab, TEXT_OFFSET, TEXT_CAPACITY);
    const encoder = new TextEncoder();
    let template = '';
    let ticker;
    let cursorHidden = false;
    const rawFd = output.fd;
    const fd = typeof rawFd === 'number' ? rawFd : undefined;
    const useWorker = options.worker ?? fd !== undefined;
    const lock = () => {
        while (Atomics.compareExchange(i32, LOCK, 0, 1) !== 0)
            Atomics.wait(i32, LOCK, 1, 5);
    };
    const unlock = () => {
        Atomics.store(i32, LOCK, 0);
        Atomics.notify(i32, LOCK);
    };
    const columns = () => {
        const c = output.columns;
        return typeof c === 'number' && c > 0 ? c : 0;
    };
    const drawn = () => fillTokens(template, i32[FRAME], now() - f64[0]);
    // Caller holds the lock.
    const redraw = (prefix = '') => {
        const text = template ? drawn() : '';
        output.write(clearSequence(i32[HEIGHT]) + prefix + text);
        i32[HEIGHT] = text ? text.split('\n').length : 0;
    };
    const restoreCursor = () => {
        if (!cursorHidden)
            return;
        cursorHidden = false;
        try {
            output.write(SHOW_CURSOR);
        }
        catch {
            // Stream already closed on exit.
        }
    };
    const onSigint = () => {
        restoreCursor();
        if (process.listenerCount('SIGINT') === 0)
            process.exit(130);
    };
    const startTicker = () => {
        if (ticker || !tty)
            return;
        if (!cursorHidden) {
            cursorHidden = true;
            output.write(HIDE_CURSOR);
            process.once('exit', restoreCursor);
            process.once('SIGINT', onSigint);
        }
        if (useWorker && fd !== undefined) {
            try {
                const worker = new Worker(WORKER_SOURCE, { eval: true, workerData: { sab, fd, frames: FRAMES, interval: FRAME_INTERVAL_MS } });
                worker.unref();
                worker.on('error', () => { });
                ticker = { stop: () => void worker.terminate() };
                return;
            }
            catch {
                // Fall through to the main-thread ticker.
            }
        }
        const timer = setInterval(() => {
            lock();
            try {
                i32[FRAME] = (i32[FRAME] + 1) % FRAMES.length;
                if (template)
                    redraw();
            }
            finally {
                unlock();
            }
        }, FRAME_INTERVAL_MS);
        timer.unref?.();
        ticker = { stop: () => clearInterval(timer) };
    };
    const stopTicker = () => {
        ticker?.stop();
        ticker = undefined;
        restoreCursor();
        process.removeListener('exit', restoreCursor);
        process.removeListener('SIGINT', onSigint);
    };
    return {
        tty,
        set(lines, startedAt) {
            if (!tty)
                return;
            const width = columns();
            const next = lines.map(l => (width ? fitWidth(l, Math.max(10, width - TOKEN_SLACK)) : l)).join('\n');
            let encoded = encoder.encode(next);
            if (encoded.length > TEXT_CAPACITY)
                encoded = encoded.slice(0, 0);
            if (encoded.length)
                startTicker();
            lock();
            try {
                if (startedAt !== undefined)
                    f64[0] = startedAt;
                if (!template && next)
                    i32[FRAME] = 0;
                template = encoded.length ? next : '';
                bytes.set(encoded);
                i32[TEXT_LEN] = encoded.length;
                redraw();
            }
            finally {
                unlock();
            }
            if (!template)
                stopTicker();
        },
        print(text, target = output) {
            if (!tty) {
                target.write(text);
                return;
            }
            lock();
            try {
                if (target === output) {
                    redraw(text);
                }
                else {
                    output.write(clearSequence(i32[HEIGHT]));
                    i32[HEIGHT] = 0;
                    target.write(text);
                    redraw();
                }
            }
            finally {
                unlock();
            }
        },
        stop() {
            if (!tty)
                return;
            lock();
            try {
                template = '';
                i32[TEXT_LEN] = 0;
                redraw();
            }
            finally {
                unlock();
            }
            stopTicker();
        },
    };
}
