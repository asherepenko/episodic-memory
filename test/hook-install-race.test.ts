import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import { mkdtempSync, mkdirSync, copyFileSync, rmSync, writeFileSync, chmodSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { REQUIRED_PACKAGES } from '../dist/install-check.js';

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// Reproduces the install-race the SessionStart hook hits when /plugin install
// or /plugin update fires the hook before npm install finishes populating
// node_modules. Hook command shape (from hooks/hooks.json):
//   node "${PLUGIN_ROOT}/cli/episodic-memory.mjs" sync --background
//
// The shim probes each required package (findMissingDeps) and self-heals on
// foreground invocations (#95), while still exiting silently for the
// hook-only background sync during a transient install race.
describe('SessionStart hook install-race tolerance', () => {
  let stageDir: string;

  function plantPackage(pkg: string): void {
    const dir = join(stageDir, 'node_modules', pkg);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: pkg }));
  }

  beforeEach(() => {
    // Build a synthetic plugin root that mirrors the install layout but with
    // an empty node_modules — simulating npm install mid-flight.
    stageDir = mkdtempSync(join(tmpdir(), 'em-install-race-'));
    mkdirSync(join(stageDir, 'cli'), { recursive: true });
    mkdirSync(join(stageDir, 'dist', 'cli'), { recursive: true });
    mkdirSync(join(stageDir, 'node_modules'), { recursive: true });
    // Minimal package.json so Node's parent walk terminates cleanly.
    writeFileSync(join(stageDir, 'package.json'), JSON.stringify({ name: 'fake', type: 'module' }));
    // Copy the real shim under test plus the install-check module it imports.
    copyFileSync(join(REPO_ROOT, 'cli', 'episodic-memory.mjs'), join(stageDir, 'cli', 'episodic-memory.mjs'));
    chmodSync(join(stageDir, 'cli', 'episodic-memory.mjs'), 0o755);
    copyFileSync(join(REPO_ROOT, 'dist', 'install-check.js'), join(stageDir, 'dist', 'install-check.js'));
    // install-check imports file-lock at load; stage it so the shim's import chain resolves.
    copyFileSync(join(REPO_ROOT, 'dist', 'file-lock.js'), join(stageDir, 'dist', 'file-lock.js'));
    // Plant a dist/cli/episodic-memory.js that would crash on import so we can
    // confirm the shim short-circuited before spawning it.
    writeFileSync(
      join(stageDir, 'dist', 'cli', 'episodic-memory.js'),
      `throw new Error('child should not have been spawned');\n`
    );
  });

  afterEach(() => {
    rmSync(stageDir, { recursive: true, force: true });
  });

  it('exits 0 silently when dependencies are missing (sync --background)', () => {
    const result = spawnSync(
      process.execPath,
      [join(stageDir, 'cli', 'episodic-memory.mjs'), 'sync', '--background'],
      { encoding: 'utf-8' }
    );

    // Background hook race: short-circuit before any install attempt or spawn.
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
  });

  it('still exits 0 silently when only some deps are present (sync --background)', () => {
    // A partial extraction (one package landed, others not) must not crash the
    // hook — the background path stays silent until the install completes.
    plantPackage(REQUIRED_PACKAGES[0]);

    const result = spawnSync(
      process.execPath,
      [join(stageDir, 'cli', 'episodic-memory.mjs'), 'sync', '--background'],
      { encoding: 'utf-8' }
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
  });

  it('attempts self-heal (does not silently skip) for foreground commands with missing deps', () => {
    // Stub `npm` on PATH with a fast failure so the self-heal install is
    // hermetic — no network, no real install. A failed install surfaces a
    // nonzero exit rather than a silent skip.
    const binDir = join(stageDir, 'bin');
    mkdirSync(binDir, { recursive: true });
    const fakeNpm = join(binDir, 'npm');
    writeFileSync(fakeNpm, '#!/bin/sh\nexit 1\n');
    chmodSync(fakeNpm, 0o755);

    const result = spawnSync(
      process.execPath,
      [join(stageDir, 'cli', 'episodic-memory.mjs'), 'search', 'whatever'],
      { encoding: 'utf-8', env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` } }
    );

    // Install failed → shim exits nonzero instead of swallowing the problem.
    expect(result.status).not.toBe(0);
  });

  it('runs normally once all deps are present', () => {
    // Populate every required package marker the shim probes for.
    for (const pkg of REQUIRED_PACKAGES) {
      plantPackage(pkg);
    }

    const result = spawnSync(
      process.execPath,
      [join(stageDir, 'cli', 'episodic-memory.mjs'), 'sync', '--background'],
      { encoding: 'utf-8' }
    );

    // Deps present → shim spawns child → planted child throws → nonzero exit.
    expect(result.status).not.toBe(0);
  });
});
