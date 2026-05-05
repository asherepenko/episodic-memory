import fs from 'fs';
import path from 'path';
import { getIndexDir } from './paths.js';
/**
 * Persistent failure tracking for sync summaries.
 *
 * Stored at <index-dir>/sync-state.json. Survives across runs so a poison-pill
 * conversation that times out repeatedly stops burning subscription quota
 * after MAX_ATTEMPTS retries.
 *
 * Reset all failures: set EPISODIC_MEMORY_RETRY_ALL=1 or delete the file.
 */
const STATE_FILE = 'sync-state.json';
const MAX_ATTEMPTS = 3;
function statePath() {
    return path.join(getIndexDir(), STATE_FILE);
}
export function loadState() {
    if (process.env.EPISODIC_MEMORY_RETRY_ALL) {
        return { failures: {} };
    }
    try {
        const raw = fs.readFileSync(statePath(), 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && parsed.failures) {
            return parsed;
        }
    }
    catch {
        // missing or corrupt → start fresh
    }
    return { failures: {} };
}
export function saveState(state) {
    try {
        const tmp = statePath() + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8');
        fs.renameSync(tmp, statePath());
    }
    catch {
        // ignore — losing state is non-fatal
    }
}
export function shouldSkipFailed(state, filePath) {
    const entry = state.failures[filePath];
    return !!entry && entry.attempts >= MAX_ATTEMPTS;
}
export function recordFailure(state, filePath, error) {
    const prev = state.failures[filePath];
    state.failures[filePath] = {
        attempts: (prev?.attempts ?? 0) + 1,
        lastError: error,
        lastAttempt: new Date().toISOString(),
    };
}
export function clearFailure(state, filePath) {
    delete state.failures[filePath];
}
export function countSkippedPoisonPills(state) {
    return Object.values(state.failures).filter(e => e.attempts >= MAX_ATTEMPTS).length;
}
export { MAX_ATTEMPTS };
