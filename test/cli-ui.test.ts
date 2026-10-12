import { describe, expect, it } from 'vitest';
import { createUi, formatAgo, plural } from '../src/cli-ui.js';

function capture(isTTY = false) {
  const chunks: string[] = [];
  return { isTTY, write: (s: string) => chunks.push(s), text: () => chunks.join('') };
}

describe('cli-ui (off a terminal)', () => {
  it('renders headings, aligned rows, fields and details without color', async () => {
    const out = capture();
    const live = capture();
    let t = 0;
    const ui = createUi({ out, live, now: () => t });

    ui.heading('Index');
    ui.row('ok', 'Summaries', 'all present');
    ui.row('warn', 'Outdated', '2 conversations');
    ui.sub('~/a.jsonl');
    ui.field('Exchanges', '1,234');
    await ui.task('checking', async p => { p.update(1, 2); });
    t = 3000;
    ui.done(0, ['2 issues'], { ok: false });

    expect(out.text()).toBe([
      '',
      'Index',
      '  ✓  Summaries          all present',
      '  ⚠  Outdated           2 conversations',
      '     └ ~/a.jsonl',
      '     Exchanges          1,234',
      '',
      '━━━━━━━━━━━━━━━━━━━━━━  failed in 3s · 2 issues',
      '',
    ].join('\n'));
    // No spinner or bar when stderr is not a terminal.
    expect(live.text()).toBe('');
  });

  it('never prompts off a terminal', async () => {
    const ui = createUi({ out: capture(), live: capture(), interactive: false });
    expect(await ui.confirm('Repair now?')).toBe(false);
    expect(await ui.confirm('Repair now?', true)).toBe(true);
  });

  it('draws the spinner and bar on a terminal stderr', async () => {
    const live = capture(true);
    const ui = createUi({ out: capture(), live, now: () => 0 });
    await ui.task('checking', async p => { p.update(5, 10); });
    expect(live.text()).toContain('checking');
    expect(live.text()).toContain('5/10');
  });
});

describe('formatting helpers', () => {
  it('pluralizes with thousands separators', () => {
    expect(plural(1, 'issue')).toBe('1 issue');
    expect(plural(1200, 'issue')).toBe('1,200 issues');
  });

  it('describes elapsed time coarsely', () => {
    expect(formatAgo(0, 30_000)).toBe('30s ago');
    expect(formatAgo(0, 14 * 60_000)).toBe('14m ago');
    expect(formatAgo(0, 3 * 3600_000)).toBe('3h ago');
    expect(formatAgo(0, 2 * 86400_000)).toBe('2d ago');
  });
});
