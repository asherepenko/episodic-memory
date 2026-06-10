import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  acquireFileLock,
  releaseFileLock,
  readLockHolder,
  getProcessStartToken,
} from '../src/file-lock.js';

describe('file lock', () => {
  let testDir: string;
  let lockPath: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'em-lock-test-'));
    lockPath = join(testDir, '.work.lock');
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch {}
  });

  it('acquires when free, blocks a second caller, frees on release', () => {
    const first = acquireFileLock(lockPath);
    expect(first).not.toBeNull();

    const second = acquireFileLock(lockPath);
    expect(second).toBeNull();

    releaseFileLock(first!);

    const third = acquireFileLock(lockPath);
    expect(third).not.toBeNull();
    releaseFileLock(third!);
  });

  it('records the holder PID and a start token, readable via readLockHolder', () => {
    const handle = acquireFileLock(lockPath);
    expect(handle).not.toBeNull();

    expect(readLockHolder(lockPath)).toBe(process.pid);
    const record = JSON.parse(readFileSync(lockPath, 'utf-8'));
    expect(record.pid).toBe(process.pid);
    expect(record.token).toBe(getProcessStartToken(process.pid));

    releaseFileLock(handle!);
  });

  it('steals a stale lock left by a dead process', () => {
    const FAKE_PID = 999999; // not a live process
    writeFileSync(lockPath, JSON.stringify({ pid: FAKE_PID, token: 'whatever' }), 'utf-8');

    const handle = acquireFileLock(lockPath);
    expect(handle).not.toBeNull();
    expect(readLockHolder(lockPath)).toBe(process.pid);
    releaseFileLock(handle!);
  });

  it('understands a legacy bare-PID lock file from an older release', () => {
    // Dead PID in legacy format → stealable.
    writeFileSync(lockPath, '999999', 'utf-8');
    const handle = acquireFileLock(lockPath);
    expect(handle).not.toBeNull();
    releaseFileLock(handle!);
  });

  it('steals when the PID is alive but the start token differs (PID reuse)', () => {
    // The recorded PID is alive (it is us), but the start token is from a
    // different process instance — i.e. the original holder died and the OS
    // recycled its PID. The lock must be treated as stale and stolen.
    writeFileSync(
      lockPath,
      JSON.stringify({ pid: process.pid, token: 'not-this-processes-start-token' }),
      'utf-8',
    );

    const handle = acquireFileLock(lockPath);
    expect(handle).not.toBeNull();
    // After stealing, the lock now carries our real identity.
    const record = JSON.parse(readFileSync(lockPath, 'utf-8'));
    expect(record.pid).toBe(process.pid);
    expect(record.token).toBe(getProcessStartToken(process.pid));
    releaseFileLock(handle!);
  });

  it('does NOT steal when the PID is alive and the start token matches (genuinely held)', () => {
    // Live PID + matching token = a real holder. A contender must back off,
    // not steal — otherwise two holders run at once.
    writeFileSync(
      lockPath,
      JSON.stringify({ pid: process.pid, token: getProcessStartToken(process.pid) }),
      'utf-8',
    );

    const handle = acquireFileLock(lockPath);
    expect(handle).toBeNull();
  });

  it('getProcessStartToken returns a stable, non-null value for the current process on this platform', () => {
    const a = getProcessStartToken(process.pid);
    const b = getProcessStartToken(process.pid);
    expect(a).not.toBeNull();
    expect(a).toBe(b); // stable for the life of the process
  });
});
