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
export interface FileLockHandle {
    path: string;
    fd: number;
}
export declare function acquireFileLock(lockPath: string): FileLockHandle | null;
export declare function releaseFileLock(handle: FileLockHandle): void;
/**
 * Read the recorded holder PID from a lock file. Returns null if the file
 * doesn't exist or doesn't contain a valid PID.
 */
export declare function readLockHolder(lockPath: string): number | null;
