import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import {
  isTruthyEnv,
  isAutoSyncDisabled,
  areSummariesSkipped,
  resolveBusyTimeoutMs,
  DEFAULT_BUSY_TIMEOUT_MS,
} from '../src/env-switches.js';
import { openDatabase } from '../src/db.js';
import { createSyncSession } from '../src/sync/sync.js';

describe('truthy env parsing', () => {
  it.each(['1', 'true', 'TRUE', 'Yes', ' yes '])('%j is truthy', v => {
    expect(isTruthyEnv(v)).toBe(true);
  });
  it.each([undefined, '', '0', 'false', 'no', 'on', '2'])('%j is falsy', v => {
    expect(isTruthyEnv(v)).toBe(false);
  });
  it('wires each switch to its own variable', () => {
    expect(isAutoSyncDisabled({ EPISODIC_MEMORY_DISABLE_AUTO_SYNC: 'true' })).toBe(true);
    expect(isAutoSyncDisabled({ EPISODIC_MEMORY_SKIP_SUMMARIES: '1' })).toBe(false);
    expect(areSummariesSkipped({ EPISODIC_MEMORY_SKIP_SUMMARIES: 'YES' })).toBe(true);
    expect(areSummariesSkipped({})).toBe(false);
  });
});

describe('busy timeout', () => {
  let dir: string;
  const saved = process.env.EPISODIC_MEMORY_BUSY_TIMEOUT_MS;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'busy-timeout-'));
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.EPISODIC_MEMORY_BUSY_TIMEOUT_MS;
    else process.env.EPISODIC_MEMORY_BUSY_TIMEOUT_MS = saved;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('resolves default, override, and rejects invalid values', () => {
    expect(resolveBusyTimeoutMs({})).toBe(DEFAULT_BUSY_TIMEOUT_MS);
    expect(resolveBusyTimeoutMs({ EPISODIC_MEMORY_BUSY_TIMEOUT_MS: '1500' })).toBe(1500);
    expect(resolveBusyTimeoutMs({ EPISODIC_MEMORY_BUSY_TIMEOUT_MS: '0' })).toBe(0);
    for (const bad of ['-1', '1.5', 'abc', '', '12ms']) {
      expect(resolveBusyTimeoutMs({ EPISODIC_MEMORY_BUSY_TIMEOUT_MS: bad })).toBe(DEFAULT_BUSY_TIMEOUT_MS);
    }
  });

  it('applies the default to an opened connection', () => {
    delete process.env.EPISODIC_MEMORY_BUSY_TIMEOUT_MS;
    const db = openDatabase(path.join(dir, 'a.db'));
    expect(db.pragma('busy_timeout', { simple: true })).toBe(5000);
    db.close();
  });

  it('applies the env override, including read-only connections', () => {
    process.env.EPISODIC_MEMORY_BUSY_TIMEOUT_MS = '1234';
    const file = path.join(dir, 'b.db');
    openDatabase(file).close();
    const ro = openDatabase(file, { readonly: true });
    expect(ro.pragma('busy_timeout', { simple: true })).toBe(1234);
    ro.close();
  });
});

describe('summary pass switch', () => {
  let dir: string;
  const saved = { ...process.env };
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skip-summaries-'));
    process.env.EPISODIC_MEMORY_CONFIG_DIR = dir;
    process.env.TEST_DB_PATH = path.join(dir, 'db.sqlite');
  });
  afterEach(() => {
    process.env = { ...saved };
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function seed(): string {
    const archive = path.join(dir, 'archive');
    const proj = path.join(archive, 'proj');
    fs.mkdirSync(proj, { recursive: true });
    fs.writeFileSync(
      path.join(proj, 's1.jsonl'),
      JSON.stringify({ type: 'user', uuid: 'u1', timestamp: '2026-01-01T00:00:00Z', message: { role: 'user', content: 'hello there' } }) + '\n',
    );
    return archive;
  }

  it('does not queue any summary when EPISODIC_MEMORY_SKIP_SUMMARIES is set', async () => {
    process.env.EPISODIC_MEMORY_SKIP_SUMMARIES = '1';
    const events: string[] = [];
    const session = createSyncSession(seed(), { onEvent: e => events.push(e.type) });
    try {
      await session.indexProject('proj');
      await session.summarize();
    } finally {
      session.close();
    }
    expect(events).not.toContain('summary-start');
    expect(session.result.summarized).toBe(0);
  });
});

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
describe('sync-cli auto-sync switch', () => {
  const run = (args: string[], env: Record<string, string>) =>
    spawnSync(process.execPath, ['--import', 'tsx', path.join(REPO_ROOT, 'src', 'sync-cli.ts'), ...args], {
      env: { ...process.env, ...env },
      timeout: 20000,
      encoding: 'utf-8',
    });

  it('background sync exits 0 with one stderr line and spawns nothing', () => {
    const r = run(['--background'], { EPISODIC_MEMORY_DISABLE_AUTO_SYNC: 'TRUE' });
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/background sync disabled/i);
    expect(r.stdout).not.toMatch(/Sync started in background/);
  });

  it('foreground --help is unaffected and documents the switches', () => {
    const r = run(['--help'], { EPISODIC_MEMORY_DISABLE_AUTO_SYNC: '1' });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/EPISODIC_MEMORY_DISABLE_AUTO_SYNC/);
    expect(r.stdout).toMatch(/EPISODIC_MEMORY_SKIP_SUMMARIES/);
    expect(r.stdout).toMatch(/--no-summaries/);
  });
});
