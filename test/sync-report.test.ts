import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSyncReporter, displayProjectName, formatRow, fullProjectName } from '../src/sync-report.js';

const CLEAR_LINE = '\r\u001b[2K';
const stripAnsi = (s: string) => s.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '').replace(/\r/g, '');

afterEach(() => {
  vi.useRealTimers();
});

describe('displayProjectName', () => {
  it('drops the home and Projects prefix from encoded Claude project dirs', () => {
    expect(displayProjectName('-Users-andrew-Projects-auto-claude', '/Users/andrew')).toBe('auto-claude');
    expect(displayProjectName('-Users-andrew-dotfiles', '/Users/andrew')).toBe('dotfiles');
    expect(displayProjectName('-Users-andrew', '/Users/andrew')).toBe('~');
    expect(displayProjectName('2026', '/Users/andrew')).toBe('2026');
  });

  it('restores the root dir and hidden-dir dots that the encoding turns into dashes', () => {
    expect(displayProjectName('-', '/Users/andrew')).toBe('/');
    expect(displayProjectName('-Users-andrew--claude-mem-sessions', '/Users/andrew')).toBe('.claude-mem-sessions');
  });

  it('cuts long names in the middle so both ends stay readable', () => {
    const name = displayProjectName('-Users-andrew-Projects-work-pray-com-worktrees-client-mobile-android-feature-x', '/Users/andrew');
    expect(name.length).toBe(36);
    expect(name).toMatch(/^work-pray-com-.*….*android-feature-x$/);
  });

  it('shows paths outside home without a fake hidden-dir dot', () => {
    expect(displayProjectName('-private-tmp-scratch', '/Users/andrew')).toBe('private-tmp-scratch');
  });

  it('can return the untruncated name for sorting', () => {
    const long = '-Users-andrew-Projects-work-pray-com-client-mobile-android-feature-very-long';
    expect(fullProjectName(long, '/Users/andrew')).toBe('work-pray-com-client-mobile-android-feature-very-long');
  });
});

describe('formatRow', () => {
  it('pads the counter and name into aligned columns', () => {
    expect(formatRow(1, 49, 'agent-orchestrator', '↓', '1734 files copied')).toBe(
      '[ 1/49] agent-orchestrator                   ↓  1734 files copied',
    );
    expect(formatRow(10, 49, 'CLI-Anything', '✓', 'up to date')).toBe(
      '[10/49] CLI-Anything                         ✓  up to date',
    );
  });
});

describe('createSyncReporter', () => {
  const home = '/Users/andrew';

  it('prints a yellow spinner row while a project syncs, then replaces it with the result', () => {
    vi.useFakeTimers();
    let out = '';
    const reporter = createSyncReporter({ isTTY: true, write: s => { out += s; } }, { color: true, home });

    reporter.onEvent({ type: 'project-start', project: '-Users-andrew-Projects-auto-claude', index: 1, total: 2 });
    expect(out).toBe(`${CLEAR_LINE}[1/2] auto-claude                          \u001b[33m⠋  syncing...\u001b[0m`);

    vi.advanceTimersByTime(120);
    expect(out.endsWith(`\u001b[33m⠙  syncing...\u001b[0m`)).toBe(true);

    reporter.onEvent({ type: 'project-progress', project: '-Users-andrew-Projects-auto-claude', index: 1, total: 2, done: 3, of: 40 });
    expect(stripAnsi(out).endsWith('⠙  indexing 3/40...')).toBe(true);

    out = '';
    reporter.onEvent({ type: 'project-done', project: '-Users-andrew-Projects-auto-claude', index: 1, total: 2, copied: 0, indexed: 0, exchanges: 0, errors: 0 });
    expect(out).toBe(`${CLEAR_LINE}[1/2] auto-claude                          \u001b[32m✓\u001b[0m  up to date\n`);
    reporter.finish();
  });

  it('describes copied and indexed work', () => {
    let out = '';
    const reporter = createSyncReporter({ isTTY: false, write: s => { out += s; } }, { color: false, home });

    reporter.onEvent({ type: 'project-done', project: 'a', index: 1, total: 3, copied: 1, indexed: 1, exchanges: 12, errors: 0 });
    reporter.onEvent({ type: 'project-done', project: 'b', index: 2, total: 3, copied: 0, indexed: 40, exchanges: 310, errors: 0 });
    reporter.onEvent({ type: 'project-done', project: 'c', index: 3, total: 3, copied: 2, indexed: 0, exchanges: 0, errors: 1 });

    expect(out.split('\n').filter(Boolean)).toEqual([
      '[1/3] a                                    ↓  1 new transcript · 12 exchanges',
      '[2/3] b                                    ↓  310 exchanges',
      '[3/3] c                                    ✗  2 new transcripts · 1 error',
    ]);
  });

  it('adds a dim worktree line under grouped rows', () => {
    let out = '';
    const reporter = createSyncReporter({ isTTY: false, write: s => { out += s; } }, { color: false, home });
    reporter.onEvent({ type: 'project-done', project: '-Users-andrew-Projects-mapa', index: 3, total: 61, copied: 0, indexed: 4, exchanges: 1885, errors: 0, worktrees: 4 });
    expect(out).toBe(
      '[ 3/61] mapa                                 ↓  1,885 exchanges\n' +
      '        └ 4 worktrees\n',
    );
  });

  it('uses the label over the project dir name', () => {
    let out = '';
    const reporter = createSyncReporter({ isTTY: false, write: s => { out += s; } }, { color: false, home });
    reporter.onEvent({ type: 'project-done', project: '2026', label: 'codex 2026', index: 1, total: 1, copied: 1, indexed: 1, exchanges: 2, errors: 0 });
    expect(out).toContain('codex 2026');
  });

  it('draws a progress bar under the running row and ends on a full bar', () => {
    vi.useFakeTimers();
    let clock = 0;
    let out = '';
    const reporter = createSyncReporter({ isTTY: true, write: s => { out += s; } }, { color: false, home, now: () => clock });

    reporter.start(2);
    reporter.onEvent({ type: 'project-start', project: 'a', index: 1, total: 2 });
    clock = 5000;
    vi.advanceTimersByTime(120);
    expect(stripAnsi(out.slice(out.lastIndexOf('[1/2]')))).toBe(
      '[1/2] a                                    ⠙  syncing...\n' +
      '──────────────────────  0/2 · 5s',
    );

    reporter.onEvent({ type: 'project-done', project: 'a', index: 1, total: 2, copied: 0, indexed: 0, exchanges: 0, errors: 0 });
    reporter.onEvent({ type: 'project-done', project: 'b', index: 2, total: 2, copied: 0, indexed: 0, exchanges: 0, errors: 0 });
    out = '';
    reporter.finish('done in 5s');
    expect(stripAnsi(out)).toBe('\n━━━━━━━━━━━━━━━━━━━━━━  2/2 · done in 5s\n');
  });

  it('treats files that yielded no exchanges as up to date', () => {
    let out = '';
    const reporter = createSyncReporter({ isTTY: false, write: s => { out += s; } }, { color: false, home });
    reporter.onEvent({ type: 'project-done', project: 'a', index: 1, total: 1, copied: 0, indexed: 3, exchanges: 0, errors: 0 });
    expect(out).toBe('');
  });

  it('hides up-to-date rows and draws no spinner when output is not a terminal', () => {
    const write = vi.fn();
    const reporter = createSyncReporter({ isTTY: false, write }, { color: false, home });

    reporter.onEvent({ type: 'project-start', project: 'a', index: 1, total: 1 });
    reporter.onEvent({ type: 'project-done', project: 'a', index: 1, total: 1, copied: 0, indexed: 0, exchanges: 0, errors: 0 });

    expect(write).not.toHaveBeenCalled();
  });

  it('prints a row per finished summary', () => {
    let out = '';
    const reporter = createSyncReporter({ isTTY: false, write: s => { out += s; } }, { color: false, home });
    const file = '/archive/-Users-andrew-Projects-auto-claude/1e5fc7af-904c-4309-b34d-24a273f21af7.jsonl';

    reporter.onEvent({ type: 'summary-start', file, project: '-Users-andrew-Projects-auto-claude', index: 1, total: 2 });
    reporter.onEvent({ type: 'summary-done', file, project: '-Users-andrew-Projects-auto-claude', index: 1, total: 2, ms: 14200, ok: true });
    reporter.onEvent({ type: 'summary-done', file, project: '-Users-andrew-Projects-auto-claude', index: 2, total: 2, ms: 3000, ok: false, error: 'timeout after 180000ms\nstack' });

    expect(out.split('\n').filter(Boolean)).toEqual([
      '[1/2] auto-claude · 1e5fc7af               ✓  summarized in 14s',
      '[2/2] auto-claude · 1e5fc7af               ✗  failed: timeout after 180000ms',
    ]);
  });
});
