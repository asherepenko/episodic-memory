import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { closeLog, log } from '../src/logger.js';
import { createProgressIndicator } from '../src/progress.js';

const CLEAR_LINE = '\r\u001b[2K';
function createTempConfigDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'episodic-memory-progress-'));
}

afterEach(() => {
  closeLog();
  delete process.env.EPISODIC_MEMORY_CONFIG_DIR;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('createProgressIndicator', () => {
  it('renders a spinner while work is running and clears it with the completion message', () => {
    vi.useFakeTimers();
    const write = vi.fn();
    const progress = createProgressIndicator('Indexing conversations', { isTTY: true, write });

    progress.start();
    expect(write).toHaveBeenLastCalledWith(`${CLEAR_LINE}Indexing conversations ⠋`);

    vi.advanceTimersByTime(120);
    expect(write).toHaveBeenLastCalledWith(`${CLEAR_LINE}Indexing conversations ⠙`);

    progress.complete('Index complete');
    expect(write).toHaveBeenLastCalledWith(`${CLEAR_LINE}Index complete\n`);
  });

  it('clears a longer spinner label before rendering completion', () => {
    const write = vi.fn();
    const progress = createProgressIndicator('Updating embeddings', { isTTY: true, write });

    progress.start();
    progress.complete('Sync complete');

    expect(write).toHaveBeenLastCalledWith(`${CLEAR_LINE}Sync complete\n`);
  });

  it('clears the spinner, writes a log line, and repaints the spinner', () => {
    vi.useFakeTimers();
    process.env.EPISODIC_MEMORY_CONFIG_DIR = createTempConfigDir();
    let terminal = '';
    const progress = createProgressIndicator('Syncing source 1/2', {
      isTTY: true,
      write(message) {
        terminal += message;
      },
    });

    progress.start();
    log.info('Summarizing conversation...');
    progress.complete('Sync complete');

    expect(terminal).toBe(
      `${CLEAR_LINE}Syncing source 1/2 ⠋` +
      `${CLEAR_LINE}Summarizing conversation...\n` +
      `${CLEAR_LINE}Syncing source 1/2 ⠋` +
      `${CLEAR_LINE}Sync complete\n`,
    );
  });

  it('leaves non-interactive progress and logger output unchanged', () => {
    process.env.EPISODIC_MEMORY_CONFIG_DIR = createTempConfigDir();
    const write = vi.fn();
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    const progress = createProgressIndicator('Syncing conversations', { isTTY: false, write });

    progress.start();
    log.info('Summarizing conversation...');
    progress.complete('Sync complete');

    expect(write.mock.calls).toEqual([
      ['Syncing conversations...\n'],
      ['Sync complete\n'],
    ]);
    expect(consoleLog).toHaveBeenCalledWith('Summarizing conversation...');
  });

  it('writes start and finish lines for non-interactive output', () => {
    const write = vi.fn();
    const progress = createProgressIndicator('Syncing conversations', { isTTY: false, write });

    progress.start();
    progress.complete('Sync complete');

    expect(write).toHaveBeenNthCalledWith(1, 'Syncing conversations...\n');
    expect(write).toHaveBeenNthCalledWith(2, 'Sync complete\n');
  });
});
