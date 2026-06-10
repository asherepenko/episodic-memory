/**
 * File-based exclusive locks for long-running background work that must not run
 * more than once at a time on a given machine — `sync --background` (#97), the
 * embedding migration, dependency installs, and the native-binding rebuild.
 *
 * This is the single lock implementation for the whole codebase. It deliberately
 * uses an atomic `openSync('wx')` + identity-file + liveness-steal protocol
 * rather than the upstream `proper-lockfile` package: adding a required runtime
 * dependency widens the install surface — the exact fragility the #95 install
 * work is closing — and these locks are single-machine by definition, where
 * PID liveness is a more precise primitive than `proper-lockfile`'s mtime
 * heuristic (instant crash recovery, no false steal of a busy-but-alive holder).
 *
 * Stale detection is PID liveness hardened against PID reuse. The naive check —
 * "recorded PID is alive ⇒ held" — has a race: the holder can crash and the OS
 * recycle its PID for an unrelated process before a contender looks, leaving the
 * lock wedged until that unrelated process exits. To close it, the lock file
 * records the holder's PID *and* an OS-provided process-start token. A contender
 * that finds the PID alive but with a *different* start token knows the PID was
 * recycled and steals the lock. (`proper-lockfile` sidesteps this via mtime;
 * here the start token is exact.)
 *
 * On disk for a held lock at `<lockPath>`: a single JSON line
 * `{"pid":1234,"token":"<start-identity>"}`. A legacy bare-PID file (from an
 * older release lingering across an upgrade) is still understood — it just has
 * no token, so it falls back to plain liveness.
 *
 * Error policy:
 *   - `null` means lock contention (a live holder owns it).
 *   - Unexpected I/O errors (EACCES, ENOSPC, EMFILE, …) are thrown so callers
 *     can surface disk problems rather than mask them as "locked".
 */

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

export interface FileLockHandle {
  path: string;
  fd: number;
}

interface LockRecord {
  pid: number;
  token: string | null;
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

/**
 * An OS-provided token that uniquely identifies a *running instance* of `pid`:
 * its start time. Two processes that happen to share a PID across a crash/reuse
 * (or a reboot) have different start times, so comparing tokens detects reuse.
 * Returns null when the platform/process can't be queried — callers then fall
 * back to plain liveness (conservative: an alive PID is treated as held).
 */
export function getProcessStartToken(pid: number): string | null {
  try {
    if (process.platform === 'linux') {
      // /proc/<pid>/stat field 22 is `starttime` (clock ticks since boot).
      // `comm` (field 2) is parenthesized and may itself contain spaces and
      // ')', so split on the *last* ')' and index from `state` (field 3).
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf-8');
      const after = stat.slice(stat.lastIndexOf(')') + 1).trim().split(/\s+/);
      return after[19] ?? null; // field 22 = after[22 - 3]
    }
    if (process.platform === 'darwin') {
      // No /proc on macOS; `ps` reports the process start instant. Spawned only
      // on lock acquisition (rare), so the cost is irrelevant.
      const out = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      return out || null;
    }
    if (process.platform === 'win32') {
      const out = execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToFileTimeUtc()`,
        ],
        { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] },
      ).trim();
      return out || null;
    }
  } catch {
    return null;
  }
  return null;
}

// The current process's start token never changes; query the OS at most once.
let selfTokenCache: string | null | undefined;
function selfToken(): string | null {
  if (selfTokenCache === undefined) selfTokenCache = getProcessStartToken(process.pid);
  return selfTokenCache;
}

function writeLockRecord(fd: number): void {
  const record: LockRecord = { pid: process.pid, token: selfToken() };
  fs.writeSync(fd, JSON.stringify(record));
}

function readLockRecord(lockPath: string): LockRecord | null {
  let raw: string;
  try {
    raw = fs.readFileSync(lockPath, 'utf-8').trim();
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj.pid === 'number' && obj.pid > 0) {
      return { pid: obj.pid, token: typeof obj.token === 'string' ? obj.token : null };
    }
    return null;
  } catch {
    // Legacy format: a bare PID number written by an older release.
    const pid = parseInt(raw, 10);
    return Number.isFinite(pid) && pid > 0 ? { pid, token: null } : null;
  }
}

/**
 * Whether the recorded holder is genuinely still running this lock. Alive PID
 * with a non-matching start token means the PID was recycled → stale. Alive PID
 * with a matching (or unverifiable) token → held.
 */
function holderStillValid(record: LockRecord): boolean {
  if (!isProcessAlive(record.pid)) return false;
  if (record.token !== null) {
    const live = getProcessStartToken(record.pid);
    if (live !== null && live !== record.token) return false; // PID reused
  }
  return true;
}

export function acquireFileLock(lockPath: string): FileLockHandle | null {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });

  // Try exclusive create first.
  try {
    const fd = fs.openSync(lockPath, 'wx');
    writeLockRecord(fd);
    return { path: lockPath, fd };
  } catch (err: any) {
    if (err.code !== 'EEXIST') throw err;
  }

  // Lock exists. Steal it only if the recorded holder is gone (dead, recycled
  // PID, or unreadable record).
  const record = readLockRecord(lockPath);
  if (record !== null && holderStillValid(record)) {
    return null;
  }

  try {
    fs.unlinkSync(lockPath);
  } catch {}
  try {
    const fd = fs.openSync(lockPath, 'wx');
    writeLockRecord(fd);
    return { path: lockPath, fd };
  } catch (err: any) {
    if (err.code === 'EEXIST') return null; // another contender won the steal
    throw err;
  }
}

export function releaseFileLock(handle: FileLockHandle): void {
  try { fs.closeSync(handle.fd); } catch {}
  try { fs.unlinkSync(handle.path); } catch {}
}

/**
 * Read the recorded holder PID from a lock file. Returns null if the file
 * doesn't exist or doesn't contain a valid record. Used for diagnostics
 * (e.g. "sync already running (pid X)").
 */
export function readLockHolder(lockPath: string): number | null {
  const record = readLockRecord(lockPath);
  return record ? record.pid : null;
}
