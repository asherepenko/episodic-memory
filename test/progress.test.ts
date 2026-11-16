import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { closeLog, log } from '../src/logger.js';
import { createUi } from '../src/cli-ui.js';

function createTempConfigDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'episodic-memory-progress-'));
}

afterEach(() => {
  closeLog();
  delete process.env.EPISODIC_MEMORY_CONFIG_DIR;
  vi.restoreAllMocks();
});

describe('logger lines during a spinner', () => {
  it('prints log lines above the spinner, then redraws the spinner', async () => {
    process.env.EPISODIC_MEMORY_CONFIG_DIR = createTempConfigDir();
    let terminal = '';
    const tty = { isTTY: true, write: (s: string) => { terminal += s; } };
    const ui = createUi({ out: tty, live: tty, color: false, now: () => 0 });

    await ui.task('syncing', async () => {
      log.info('Summarizing conversation...');
    });

    const plain = terminal.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r/g, '');
    expect(plain).toBe('  ⠋  syncingSummarizing conversation...\n  ⠋  syncing');
  });

  it('falls back to console.log when no spinner is running', () => {
    process.env.EPISODIC_MEMORY_CONFIG_DIR = createTempConfigDir();
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    log.info('Summarizing conversation...');
    expect(consoleLog).toHaveBeenCalledWith('Summarizing conversation...');
  });
});
