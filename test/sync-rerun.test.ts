import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { requestRerun, takeRerunRequest } from '../src/sync-run.js';

// A SessionEnd sync that finds another sync running must not be lost: the
// running sync may already be past that session's project. The skipped run
// leaves a request; the holder does one more pass when it finishes.
let configDir: string;
let saved: string | undefined;

beforeEach(() => {
  configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'em-rerun-'));
  saved = process.env.EPISODIC_MEMORY_CONFIG_DIR;
  process.env.EPISODIC_MEMORY_CONFIG_DIR = configDir;
});

afterEach(() => {
  if (saved === undefined) delete process.env.EPISODIC_MEMORY_CONFIG_DIR;
  else process.env.EPISODIC_MEMORY_CONFIG_DIR = saved;
  fs.rmSync(configDir, { recursive: true, force: true });
});

describe('sync rerun request', () => {
  it('is empty until a skipped sync requests one', () => {
    expect(takeRerunRequest()).toBe(false);
  });

  it('is taken exactly once, however many syncs asked', () => {
    requestRerun();
    requestRerun();
    expect(takeRerunRequest()).toBe(true);
    expect(takeRerunRequest()).toBe(false);
  });
});
