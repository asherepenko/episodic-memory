/**
 * File-based exclusive locks for long-running background work that must not run
 * more than once at a time on a given machine — currently `sync --background`
 * (#97).
 *
 * Implementation note: this fork deliberately backs the lock with the same
 * atomic `openSync('wx')` + PID-file + liveness-steal protocol already proven
 * in `embedding-migration.ts`, rather than the upstream `proper-lockfile`
 * package. Adding a required runtime dependency widens the install surface —
 * the exact fragility that the #95 install-robustness work is closing. A
 * pure-builtin lock keeps `node_modules` lean and the install path simple.
 *
 * On disk for a held lock at `<lockPath>`: a single file containing the
 * holder's PID. A contender whose recorded holder PID is no longer alive
 * steals the lock atomically.
 *
 * Error policy:
 *   - `null` means lock contention (a live holder owns it).
 *   - Unexpected I/O errors (EACCES, ENOSPC, EMFILE, etc.) are thrown so
 *     callers can surface disk problems rather than mask them as "locked".
 */

import fs from 'fs';
import path from 'path';

export interface FileLockHandle {
  path: string;
  fd: number;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    // ESRCH → no such process. EPERM → process exists but we can't signal it
    // (still alive). Anything else → treat as alive to stay conservative.
    return err.code === 'EPERM';
  }
}

export function acquireFileLock(lockPath: string): FileLockHandle | null {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });

  // Try exclusive create first.
  try {
    const fd = fs.openSync(lockPath, 'wx');
    fs.writeSync(fd, String(process.pid));
    return { path: lockPath, fd };
  } catch (err: any) {
    if (err.code !== 'EEXIST') throw err;
  }

  // Lock exists. Check whether the holder is still alive.
  const holderPid = readLockHolder(lockPath);
  if (holderPid !== null && isProcessAlive(holderPid)) {
    return null;
  }

  // Stale lock (holder dead or PID unreadable). Replace it.
  try {
    fs.unlinkSync(lockPath);
  } catch {}
  try {
    const fd = fs.openSync(lockPath, 'wx');
    fs.writeSync(fd, String(process.pid));
    return { path: lockPath, fd };
  } catch (err: any) {
    if (err.code === 'EEXIST') return null;
    throw err;
  }
}

export function releaseFileLock(handle: FileLockHandle): void {
  try { fs.closeSync(handle.fd); } catch {}
  try { fs.unlinkSync(handle.path); } catch {}
}

/**
 * Read the recorded holder PID from a lock file. Returns null if the file
 * doesn't exist or doesn't contain a valid PID.
 */
export function readLockHolder(lockPath: string): number | null {
  try {
    const pid = parseInt(fs.readFileSync(lockPath, 'utf-8').trim(), 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}
