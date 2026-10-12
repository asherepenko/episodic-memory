import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn, spawnSync } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import os from 'os';

// A background sync that dies must say why in the hook log; before this, a
// quarter of runs vanished mid-way with nothing logged.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SYNC_RUN = pathToFileURL(join(REPO_ROOT, 'dist', 'sync-run.js')).href;

let configDir: string;

beforeEach(() => {
  configDir = fs.mkdtempSync(join(os.tmpdir(), 'em-stop-reason-'));
});

afterEach(() => {
  fs.rmSync(configDir, { recursive: true, force: true });
});

function holderScript(body: string): string {
  return `
    const { acquireSyncLock } = await import(${JSON.stringify(SYNC_RUN)});
    if (!acquireSyncLock().ok) process.exit(9);
    ${body}
  `;
}

const env = () => ({ ...process.env, EPISODIC_MEMORY_CONFIG_DIR: configDir });
const lockPath = () => join(configDir, 'logs', 'episodic-memory-sync.lock');

describe('sync stop reason', () => {
  it('logs the signal that stopped a sync', async () => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', holderScript(`
      console.log('ready');
      setInterval(() => {}, 1000);
    `)], { env: env(), stdio: ['ignore', 'pipe', 'pipe'] });

    let stderr = '';
    child.stderr.on('data', d => (stderr += d));
    await new Promise<void>(resolve => child.stdout.once('data', () => resolve()));
    child.kill('SIGTERM');
    const code = await new Promise<number | null>(resolve => child.on('exit', c => resolve(c)));

    expect(code).toBe(143);
    expect(stderr).toMatch(/\[warn\] sync stopped by SIGTERM/);
    expect(fs.existsSync(lockPath())).toBe(false);
  });

  it('logs a non-zero exit code', () => {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', holderScript('process.exit(3);')], {
      env: env(),
      encoding: 'utf-8',
      timeout: 10000,
    });

    expect(result.status).toBe(3);
    expect(result.stderr).toMatch(/\[warn\] sync exited with code 3/);
  });

  it('stays quiet on a clean exit', () => {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', holderScript('')], {
      env: env(),
      encoding: 'utf-8',
      timeout: 10000,
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });

  it('reports a previous sync that died without releasing the lock', () => {
    // A SIGKILLed holder cannot log anything itself; the next run notices.
    const dead = spawnSync(process.execPath, ['-e', '0']).pid!;
    fs.mkdirSync(dirname(lockPath()), { recursive: true });
    fs.writeFileSync(lockPath(), JSON.stringify({ pid: dead, token: null }));

    const result = spawnSync(process.execPath, ['--input-type=module', '-e', holderScript('')], {
      env: env(),
      encoding: 'utf-8',
      timeout: 10000,
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toMatch(new RegExp(`\\[warn\\] previous sync \\(pid ${dead}\\) ended without finishing`));
  });
});
