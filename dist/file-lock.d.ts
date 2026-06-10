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
export interface FileLockHandle {
    path: string;
    fd: number;
}
/**
 * An OS-provided token that uniquely identifies a *running instance* of `pid`:
 * its start time. Two processes that happen to share a PID across a crash/reuse
 * (or a reboot) have different start times, so comparing tokens detects reuse.
 * Returns null when the platform/process can't be queried — callers then fall
 * back to plain liveness (conservative: an alive PID is treated as held).
 */
export declare function getProcessStartToken(pid: number): string | null;
export declare function acquireFileLock(lockPath: string): FileLockHandle | null;
export declare function releaseFileLock(handle: FileLockHandle): void;
/**
 * Read the recorded holder PID from a lock file. Returns null if the file
 * doesn't exist or doesn't contain a valid record. Used for diagnostics
 * (e.g. "sync already running (pid X)").
 */
export declare function readLockHolder(lockPath: string): number | null;
