import os from 'os';
import { createInterface } from 'readline';
import { setActiveProgress, type ProgressOutput } from './progress.js';

/**
 * Shared terminal look for every command, matching `sync`: bold section
 * headings, aligned rows with a colored status symbol, dim "└" details, a
 * yellow spinner with a progress bar for slow work, and a closing
 * "━━━ done in 12s · …" line.
 *
 * Content goes to stdout so it can be piped. The live spinner/bar goes to
 * stderr, and only when stderr is a terminal; off a terminal nothing animates.
 */

export const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
export const FRAME_INTERVAL_MS = 120;
export const CLEAR_LINE = '\r\u001b[2K';
export const CURSOR_UP = '\u001b[1A';
export const BAR_WIDTH = 22;
export const LABEL_WIDTH = 18;

export const ANSI = { yellow: 33, green: 32, cyan: 36, red: 31, bold: 1, dim: 2 } as const;
export type Tone = keyof typeof ANSI;

export const num = (n: number) => n.toLocaleString('en-US');

export function plural(n: number, word: string, many = `${word}s`): string {
  return `${num(n)} ${n === 1 ? word : many}`;
}

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function formatBar(done: number, total: number): string {
  const filled = total > 0 ? Math.min(BAR_WIDTH, Math.round((done / total) * BAR_WIDTH)) : BAR_WIDTH;
  return '━'.repeat(filled) + '─'.repeat(BAR_WIDTH - filled);
}

/** Cut the middle: the head says where a thing lives, the tail which one it is. */
export function truncateMiddle(text: string, width: number): string {
  if (text.length <= width) return text;
  const head = Math.ceil((width - 1) / 2);
  const tail = width - 1 - head;
  return text.slice(0, head) + '…' + text.slice(text.length - tail);
}

export function tildify(p: string, home: string = os.homedir()): string {
  return p.startsWith(home) ? '~' + p.slice(home.length) : p;
}

/** "3m ago", "2h ago", "5d ago" for a past instant. */
export function formatAgo(thenMs: number, nowMs: number = Date.now()): string {
  const s = Math.max(0, Math.round((nowMs - thenMs) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export type Status = 'ok' | 'warn' | 'fail' | 'new' | 'info';

const SYMBOLS: Record<Status, { char: string; tone: Tone }> = {
  ok: { char: '✓', tone: 'green' },
  warn: { char: '⚠', tone: 'yellow' },
  fail: { char: '✗', tone: 'red' },
  new: { char: '↓', tone: 'cyan' },
  info: { char: '·', tone: 'dim' },
};

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
  done(startedAt: number, parts: string[], options?: { ok?: boolean; verb?: string }): void;
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

export function createUi(options: UiOptions = {}): Ui {
  const out = options.out ?? process.stdout;
  const live = options.live ?? process.stderr;
  const liveTty = Boolean(live.isTTY);
  const color = options.color ?? (Boolean(out.isTTY) && !process.env.NO_COLOR);
  const interactive = options.interactive ?? Boolean(process.stdin.isTTY && out.isTTY);
  const now = options.now ?? Date.now;
  const paint = (tone: Tone, text: string) => (color ? `\u001b[${ANSI[tone]}m${text}\u001b[0m` : text);

  // Live region (stderr TTY only): spinner row + optional bar, redrawn in place.
  let spinner: { label: string; done: number; of: number; startedAt: number } | undefined;
  let liveHeight = 0;
  let frame = 0;
  let timer: ReturnType<typeof setInterval> | undefined;

  const liveLines = (): string[] => {
    if (!spinner) return [];
    const lines = [`  ${paint('yellow', `${FRAMES[frame]}  ${spinner.label}`)}`];
    if (spinner.of > 0) {
      lines.push(`${paint('dim', formatBar(spinner.done, spinner.of))}  ${num(spinner.done)}/${num(spinner.of)} · ${formatDuration(now() - spinner.startedAt)}`);
    }
    return lines;
  };

  const clearLive = () => {
    if (!liveTty || liveHeight === 0) return;
    let seq = '';
    for (let i = 1; i < liveHeight; i++) seq += CLEAR_LINE + CURSOR_UP;
    live.write(seq + CLEAR_LINE);
    liveHeight = 0;
  };

  const render = () => {
    if (!liveTty) return;
    clearLive();
    const lines = liveLines();
    if (lines.length === 0) return;
    live.write(lines.join('\n'));
    liveHeight = lines.length;
  };

  const line = (text = '') => {
    clearLive();
    out.write(`${text}\n`);
    render();
  };

  const pad = (label: string) => label.padEnd(LABEL_WIDTH);

  return {
    color,
    interactive,
    paint,
    line,

    heading(text) {
      line();
      line(paint('bold', text));
    },

    row(status, label, detail) {
      const { char, tone } = SYMBOLS[status];
      line(`  ${paint(tone, char)}  ${detail === undefined ? label : `${pad(label)} ${detail}`}`.trimEnd());
    },

    field(label, value) {
      // Same column as a row's label, so facts and checks line up in a section.
      line(`     ${pad(label)} ${value}`);
    },

    sub(text) {
      line(`     ${paint('dim', `└ ${text}`)}`);
    },

    async task(label, work) {
      spinner = { label, done: 0, of: 0, startedAt: now() };
      frame = 0;
      if (liveTty) {
        // Log lines written by deep code (logger.info) go above the spinner.
        setActiveProgress({ writeLine: message => line(message) });
        timer = setInterval(() => {
          frame = (frame + 1) % FRAMES.length;
          render();
        }, FRAME_INTERVAL_MS);
        timer.unref?.();
        render();
      }
      try {
        return await work({
          update(done, of, next) {
            if (!spinner) return;
            spinner.done = done;
            spinner.of = of;
            if (next !== undefined) spinner.label = next;
            render();
          },
        });
      } finally {
        if (timer) clearInterval(timer);
        timer = undefined;
        spinner = undefined;
        clearLive();
        if (liveTty) setActiveProgress(undefined);
      }
    },

    done(startedAt, parts, opts = {}) {
      const ok = opts.ok ?? true;
      const verb = opts.verb ?? (ok ? 'done' : 'failed');
      const bar = paint(ok ? 'green' : 'red', formatBar(1, 1));
      line();
      line([`${bar}  ${verb} in ${formatDuration(now() - startedAt)}`, ...parts].join(' · '));
    },

    async confirm(question, fallback = false) {
      if (!interactive) return fallback;
      clearLive();
      const rl = createInterface({ input: process.stdin, output: out as NodeJS.WritableStream });
      const hint = fallback ? '[Y/n]' : '[y/N]';
      const answer = await new Promise<string>(resolve => rl.question(`${question} ${paint('dim', hint)} `, resolve));
      rl.close();
      const a = answer.trim().toLowerCase();
      if (a === '') return fallback;
      return a === 'y' || a === 'yes';
    },
  };
}
