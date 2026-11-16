import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { createLiveRegion, fitWidth, FRAMES, FRAME_TOKEN, ELAPSED_TOKEN } from '../src/live-region.js';

const busyWait = (ms: number) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { /* block the event loop like a sync SQLite call */ }
};

let dir: string | undefined;
afterEach(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

function fdOutput() {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'live-region-'));
  const file = path.join(dir, 'out.txt');
  const fd = fs.openSync(file, 'w');
  return { file, output: { isTTY: true, fd, columns: 80, write: (s: string) => fs.writeSync(fd, s) } };
}

describe('createLiveRegion', () => {
  it('keeps the spinner moving while the main thread is blocked', async () => {
    const { file, output } = fdOutput();
    const region = createLiveRegion(output);
    region.set([`${FRAME_TOKEN} working`], Date.now());
    await new Promise(r => setTimeout(r, 50)); // let the worker boot
    busyWait(700);
    region.stop();
    const seen = new Set(FRAMES.filter(f => fs.readFileSync(file, 'utf-8').includes(f)));
    expect(seen.size).toBeGreaterThanOrEqual(3);
  });

  it('prints content above the live lines and redraws them below', () => {
    let out = '';
    const region = createLiveRegion({ isTTY: true, write: s => { out += s; } }, { worker: false, now: () => 0 });
    region.set([`${FRAME_TOKEN} sync ${ELAPSED_TOKEN}`], 0);
    region.print('row 1\n');
    region.stop();
    expect(out).toContain(`row 1\n${FRAMES[0]} sync 0s`);
    expect(out.endsWith('\r\u001b[2K\u001b[?25h')).toBe(true);
  });

  it('writes nothing live off a terminal but still prints content', () => {
    let out = '';
    const region = createLiveRegion({ isTTY: false, write: s => { out += s; } });
    region.set(['spinner']);
    region.print('row\n');
    region.stop();
    expect(out).toBe('row\n');
  });
});

describe('fitWidth', () => {
  it('cuts long lines to the terminal width and keeps colors balanced', () => {
    const line = `\u001b[33m${'x'.repeat(50)}\u001b[0m`;
    const fitted = fitWidth(line, 20);
    expect(fitted.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '')).toBe('x'.repeat(19) + '…');
    expect(fitted.endsWith('\u001b[0m')).toBe(true);
  });

  it('leaves short lines alone', () => {
    expect(fitWidth('short', 20)).toBe('short');
  });
});
