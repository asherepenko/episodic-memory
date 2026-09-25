import os from 'os';
import path from 'path';
import type { SyncEvent } from './sync/index.js';
import { setActiveProgress, type ProgressOutput } from './progress.js';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const FRAME_INTERVAL_MS = 120;
const CLEAR_LINE = '\r\u001b[2K';
const CURSOR_UP = '\u001b[1A';
const NAME_WIDTH = 36;
const BAR_WIDTH = 22;

const ANSI = { yellow: 33, green: 32, cyan: 36, red: 31, bold: 1, dim: 2 } as const;
type Tone = keyof typeof ANSI;

/** Cut the middle: the head says where a project lives, the tail which one it is. */
function truncateMiddle(name: string, width: number): string {
  if (name.length <= width) return name;
  const head = Math.ceil((width - 1) / 2);
  const tail = width - 1 - head;
  return name.slice(0, head) + '…' + name.slice(name.length - tail);
}

function firstLine(text: string, width: number): string {
  const line = text.split('\n')[0];
  return line.length <= width ? line : line.slice(0, width - 1) + '…';
}

/**
 * Claude encodes a project's cwd as its dir name ("/" → "-"). Strip the home
 * dir and a leading Projects- so rows show "auto-claude", not
 * "-Users-andrew-Projects-auto-claude". Untruncated; use for sorting.
 */
export function fullProjectName(project: string, home: string = os.homedir()): string {
  const encodedHome = home.replace(/[\\/]/g, '-');
  if (project === '-') return '/';
  if (project === encodedHome) return '~';
  if (project.startsWith(encodedHome + '-')) {
    let name = project.slice(encodedHome.length + 1);
    if (name.startsWith('Projects-')) name = name.slice('Projects-'.length);
    // "." is encoded as "-" too, so a leading dash under home was a hidden dir.
    return name.startsWith('-') ? '.' + name.slice(1) : name;
  }
  // Outside home the leading dash is the root "/"; drop it.
  return project.startsWith('-') ? project.slice(1) : project;
}

export function displayProjectName(project: string, home: string = os.homedir()): string {
  return truncateMiddle(fullProjectName(project, home), NAME_WIDTH);
}

function counter(index: number, total: number): string {
  const width = String(total).length;
  return `[${String(index).padStart(width)}/${total}]`;
}

export function formatRow(index: number, total: number, name: string, symbol: string, detail: string): string {
  return `${counter(index, total)} ${name.padEnd(NAME_WIDTH)} ${symbol}  ${detail}`;
}

const num = (n: number) => n.toLocaleString('en-US');

function plural(n: number, word: string): string {
  return `${num(n)} ${word}${n === 1 ? '' : 's'}`;
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

function sessionLabel(file: string, project: string, home: string): string {
  const base = path.basename(file, '.jsonl');
  const uuid = base.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  const id = (uuid ? uuid[0] : base).slice(0, 8);
  return `${truncateMiddle(fullProjectName(project, home), NAME_WIDTH - id.length - 3)} · ${id}`;
}

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
export function createSyncReporter(output: ProgressOutput = process.stderr, options: SyncReporterOptions = {}): SyncReporter {
  const tty = Boolean(output.isTTY);
  const color = options.color ?? (tty && !process.env.NO_COLOR);
  const home = options.home ?? os.homedir();
  const now = options.now ?? Date.now;
  const paint = (tone: Tone, text: string) => (color ? `\u001b[${ANSI[tone]}m${text}\u001b[0m` : text);

  // Live region (TTY only): the running row and the progress bar, redrawn in place.
  let live: { prefix: string; label: string } | undefined;
  let bar: { done: number; total: number; startedAt: number } | undefined;
  let liveHeight = 0;
  let frame = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  let pendingHeading: string | undefined;

  // Summaries run in parallel; rows are numbered in the order they finish.
  const summarizing = new Map<string, string>(); // file → display name
  let summariesFinished = 0;
  let summariesCounted = false;

  const liveLines = (): string[] => {
    const lines: string[] = [];
    if (live) lines.push(`${live.prefix} ${paint('yellow', `${FRAMES[frame]}  ${live.label}`)}`);
    if (bar) lines.push(`${paint('dim', formatBar(bar.done, bar.total))}  ${bar.done}/${bar.total} · ${formatDuration(now() - bar.startedAt)}`);
    return lines;
  };

  const clearLive = (): string => {
    let out = '';
    for (let i = 1; i < liveHeight; i++) out += CLEAR_LINE + CURSOR_UP;
    liveHeight = 0;
    return out + CLEAR_LINE;
  };

  const render = () => {
    if (!tty) return;
    const lines = liveLines();
    if (lines.length === 0 && liveHeight === 0) return;
    output.write(clearLive() + lines.join('\n'));
    liveHeight = lines.length;
  };

  const syncTimer = () => {
    if (!tty) return;
    const active = Boolean(live || bar);
    if (active && !timer) {
      timer = setInterval(() => {
        frame = (frame + 1) % FRAMES.length;
        render();
      }, FRAME_INTERVAL_MS);
      timer.unref?.();
    } else if (!active && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };

  const flushHeading = () => {
    if (pendingHeading === undefined) return;
    output.write(`${tty ? clearLive() : ''}\n${paint('bold', pendingHeading)}\n`);
    pendingHeading = undefined;
  };

  const setLive = (next: typeof live) => {
    if (next && !live) frame = 0;
    live = next;
    if (!tty) return;
    if (live) flushHeading();
    syncTimer();
    render();
  };

  // A finished row replaces the live region, which is then redrawn below it.
  const printLine = (line: string) => {
    flushHeading();
    output.write(tty ? `${clearLive()}${line}\n` : `${line}\n`);
    render();
  };

  const prefixFor = (index: number, total: number, name: string) => `${counter(index, total)} ${name.padEnd(NAME_WIDTH)}`;
  const nameOf = (event: { project: string; label?: string }) => event.label ?? displayProjectName(event.project, home);
  const summarizingLabel = () => (summarizing.size > 1 ? `summarizing... (${summarizing.size} running)` : 'summarizing...');

  if (tty) setActiveProgress({ writeLine: printLine });

  return {
    start(totalRows) {
      bar = { done: 0, total: totalRows, startedAt: now() };
      syncTimer();
      render();
    },

    onEvent(event) {
      switch (event.type) {
        case 'project-start':
          if (tty) setLive({ prefix: prefixFor(event.index, event.total, nameOf(event)), label: 'syncing...' });
          return;

        case 'project-progress':
          if (tty && event.of > 0) {
            const label = `indexing ${num(event.done)}/${num(event.of)}...`;
            if (live) {
              live.label = label;
              render();
            } else {
              setLive({ prefix: prefixFor(event.index, event.total, nameOf(event)), label });
            }
          }
          return;

        case 'project-done': {
          // Files that parsed to zero exchanges were checked but add nothing searchable.
          const hasNews = event.copied > 0 || event.exchanges > 0 || event.errors > 0;
          live = undefined;
          if (bar) bar.done++;
          if (!hasNews && !tty) return;
          const parts: string[] = [];
          if (event.copied > 0) parts.push(`${num(event.copied)} new transcript${event.copied === 1 ? '' : 's'}`);
          if (event.exchanges > 0) parts.push(plural(event.exchanges, 'exchange'));
          if (event.errors > 0) parts.push(plural(event.errors, 'error'));
          const symbol = event.errors > 0 ? paint('red', '✗') : hasNews ? paint('cyan', '↓') : paint('green', '✓');
          const detail = parts.length > 0 ? parts.join(' · ') : 'up to date';
          let row = formatRow(event.index, event.total, nameOf(event), symbol, detail);
          if (event.worktrees) {
            const indent = ' '.repeat(counter(event.index, event.total).length + 1);
            row += `\n${indent}${paint('dim', `└ ${plural(event.worktrees, 'worktree')}`)}`;
          }
          printLine(row);
          syncTimer();
          return;
        }

        case 'summary-start': {
          if (!summariesCounted && bar) bar.total += event.total;
          summariesCounted = true;
          const name = sessionLabel(event.file, event.project, home);
          summarizing.set(event.file, name);
          if (tty) setLive({ prefix: prefixFor(summariesFinished + 1, event.total, name), label: summarizingLabel() });
          return;
        }

        case 'summary-done': {
          summariesFinished = event.index;
          summarizing.delete(event.file);
          live = undefined;
          if (bar) bar.done++;
          const name = sessionLabel(event.file, event.project, home);
          printLine(event.ok
            ? formatRow(event.index, event.total, name, paint('green', '✓'), `summarized in ${formatDuration(event.ms)}`)
            : formatRow(event.index, event.total, name, paint('red', '✗'), `failed: ${firstLine(event.error ?? 'unknown error', 60)}`));
          const still = [...summarizing.values()].pop();
          setLive(still ? { prefix: prefixFor(summariesFinished + 1, event.total, still), label: summarizingLabel() } : undefined);
          return;
        }
      }
    },

    heading(text) {
      pendingHeading = text;
    },

    finish(summary) {
      live = undefined;
      const finalBar = bar;
      bar = undefined;
      syncTimer();
      if (tty) {
        if (liveHeight > 0) output.write(clearLive());
        setActiveProgress(undefined);
      }
      if (summary === undefined) return;
      const total = finalBar?.total ?? 0;
      const head = finalBar ? `${paint('green', formatBar(total, total))}  ${total}/${total} · ` : '';
      output.write(`\n${head}${summary}\n`);
    },
  };
}
