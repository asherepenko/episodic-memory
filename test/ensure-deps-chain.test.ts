import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import { mkdtempSync, mkdirSync, copyFileSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// ensure-deps.mjs is spawned detached by the SessionStart hook when deps are
// missing. After a successful install it must chain into `sync --background`
// so a brand-new install indexes in the same session. We stage a fake plugin
// root with an env-controlled install-check stub and a fake dist CLI that
// records its argv, then run the REAL ensure-deps.mjs against it.
describe('ensure-deps install→sync chain', () => {
  let stageDir: string;
  let syncMarker: string;

  beforeEach(() => {
    stageDir = mkdtempSync(join(tmpdir(), 'em-ensure-deps-'));
    syncMarker = join(stageDir, 'sync-invoked.json');

    mkdirSync(join(stageDir, 'scripts'), { recursive: true });
    mkdirSync(join(stageDir, 'dist', 'cli'), { recursive: true });
    writeFileSync(join(stageDir, 'package.json'), JSON.stringify({ name: 'fake', type: 'module' }));

    // Real script under test.
    copyFileSync(join(REPO_ROOT, 'scripts', 'ensure-deps.mjs'), join(stageDir, 'scripts', 'ensure-deps.mjs'));

    // Env-controlled install-check stub (no network, no real npm).
    writeFileSync(join(stageDir, 'dist', 'install-check.js'), `
      export function findMissingDeps() {
        return process.env.EM_TEST_MISSING === '0' ? [] : ['stub-missing'];
      }
      export function installDepsSync() {
        return process.env.EM_TEST_INSTALL_OK !== '0';
      }
      export const REQUIRED_PACKAGES = ['stub'];
    `);

    // Fake dist CLI: records the argv it was spawned with, proving the chain.
    writeFileSync(join(stageDir, 'dist', 'cli', 'episodic-memory.js'), `
      import { writeFileSync } from 'fs';
      writeFileSync(process.env.EM_TEST_SYNC_MARKER, JSON.stringify(process.argv.slice(2)));
    `);
  });

  afterEach(() => {
    rmSync(stageDir, { recursive: true, force: true });
  });

  function run(env: Record<string, string>) {
    return spawnSync(process.execPath, [join(stageDir, 'scripts', 'ensure-deps.mjs')], {
      encoding: 'utf-8',
      env: { ...process.env, EM_TEST_SYNC_MARKER: syncMarker, ...env },
    });
  }

  it('chains into `sync --background` after a successful install', () => {
    const result = run({ EM_TEST_MISSING: '1', EM_TEST_INSTALL_OK: '1' });

    expect(result.status).toBe(0);
    expect(existsSync(syncMarker)).toBe(true);
    expect(JSON.parse(readFileSync(syncMarker, 'utf-8'))).toEqual(['sync', '--background']);
  });

  it('exits 1 and does NOT sync when the install fails', () => {
    const result = run({ EM_TEST_MISSING: '1', EM_TEST_INSTALL_OK: '0' });

    expect(result.status).toBe(1);
    expect(existsSync(syncMarker)).toBe(false);
  });

  it('exits 0 without syncing when deps are already present (race lost)', () => {
    const result = run({ EM_TEST_MISSING: '0' });

    expect(result.status).toBe(0);
    expect(existsSync(syncMarker)).toBe(false);
  });
});
