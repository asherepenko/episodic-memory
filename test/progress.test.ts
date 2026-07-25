import { describe, expect, it, vi } from 'vitest';
import { createProgressIndicator } from '../src/progress.js';

describe('createProgressIndicator', () => {
  it('renders a spinner while work is running and clears it with the completion message', () => {
    vi.useFakeTimers();
    const write = vi.fn();
    const progress = createProgressIndicator('Indexing conversations', { isTTY: true, write });

    progress.start();
    expect(write).toHaveBeenLastCalledWith('\rIndexing conversations ⠋');

    vi.advanceTimersByTime(120);
    expect(write).toHaveBeenLastCalledWith('\rIndexing conversations ⠙');

    progress.complete('Index complete');
    expect(write).toHaveBeenLastCalledWith('\rIndex complete\n');
    vi.useRealTimers();
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
