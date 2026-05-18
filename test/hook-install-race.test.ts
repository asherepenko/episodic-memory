import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { execFileSync, spawnSync } from 'child_process';
import { mkdtempSync, mkdirSync, copyFileSync, rmSync, writeFileSync, symlinkSync, existsSync, chmodSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// Reproduces the install-race the SessionStart hook hits when /plugin install
// or /plugin update fires the hook before npm install finishes populating
// node_modules. Hook command shape (from hooks/hooks.json):
//   node "${PLUGIN_ROOT}/cli/episodic-memory.mjs" sync --background
describe('SessionStart hook install-race tolerance', () => {
  let stageDir: string;

  beforeEach(() => {
    // Build a synthetic plugin root that mirrors the install layout but with
    // an empty node_modules — simulating npm install mid-flight.
    stageDir = mkdtempSync(join(tmpdir(), 'em-install-race-'));
    mkdirSync(join(stageDir, 'cli'), { recursive: true });
    mkdirSync(join(stageDir, 'dist', 'cli'), { recursive: true });
    mkdirSync(join(stageDir, 'node_modules'), { recursive: true });
    // Minimal package.json so Node's parent walk terminates cleanly.
    writeFileSync(join(stageDir, 'package.json'), JSON.stringify({ name: 'fake', type: 'module' }));
    // Copy the real shim under test.
    copyFileSync(join(REPO_ROOT, 'cli', 'episodic-memory.mjs'), join(stageDir, 'cli', 'episodic-memory.mjs'));
    chmodSync(join(stageDir, 'cli', 'episodic-memory.mjs'), 0o755);
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

  it('exits 0 silently when @anthropic-ai/claude-agent-sdk has not been installed yet (sync --background)', () => {
    const result = spawnSync(
      process.execPath,
      [join(stageDir, 'cli', 'episodic-memory.mjs'), 'sync', '--background'],
      { encoding: 'utf-8' }
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
  });

  it('still propagates errors for non-hook invocations (no silent skip on interactive commands)', () => {
    const result = spawnSync(
      process.execPath,
      [join(stageDir, 'cli', 'episodic-memory.mjs'), 'search', 'whatever'],
      { encoding: 'utf-8' }
    );

    // Child crashes (planted throw) — shim must NOT swallow it.
    expect(result.status).not.toBe(0);
  });

  it('runs normally once deps are present', () => {
    // Populate the SDK package marker the shim checks for.
    const sdkDir = join(stageDir, 'node_modules', '@anthropic-ai', 'claude-agent-sdk');
    mkdirSync(sdkDir, { recursive: true });
    writeFileSync(join(sdkDir, 'package.json'), JSON.stringify({ name: '@anthropic-ai/claude-agent-sdk' }));

    const result = spawnSync(
      process.execPath,
      [join(stageDir, 'cli', 'episodic-memory.mjs'), 'sync', '--background'],
      { encoding: 'utf-8' }
    );

    // Deps present → shim spawns child → planted child throws → nonzero exit.
    expect(result.status).not.toBe(0);
  });
});
