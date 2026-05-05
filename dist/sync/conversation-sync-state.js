import fs from 'fs';
import path from 'path';
import { getArchiveDir, getIndexDir } from '../paths.js';
/**
 * Per-conversation SyncState store.
 *
 * Sidecar `<conv>.sync.json` lives next to the archived `.jsonl`. Owns the
 * full lifecycle (Pending/InProgress/Complete/Stale/Poison). Replaces the
 * legacy split between `sync-state.ts` (global failure map) and `partial.ts`
 * (per-conv resumable chunks).
 *
 * Failure tracking note: every recordFailure call writes a `poison` sidecar
 * with an incremented `attempts`. Callers use `isRetriable` to decide whether
 * to skip — the store does not distinguish "failing but retriable" from
 * "permanently poisoned".
 */
export const MAX_ATTEMPTS = 3;
const SCHEMA_VERSION = 2;
const LEGACY_PARTIAL_VERSION = 1;
const STATE_FILE = 'sync-state.json';
export function sidecarPathFor(jsonlPath) {
    return jsonlPath.replace(/\.jsonl$/, '.sync.json');
}
function buildPoisonState(current, error) {
    const prevAttempts = current.kind === 'poison' ? current.attempts : 0;
    return {
        kind: 'poison',
        attempts: prevAttempts + 1,
        lastError: error,
        lastAttempt: new Date().toISOString(),
    };
}
function legacyPartialPathFor(jsonlPath) {
    return jsonlPath.replace(/\.jsonl$/, '-summary.partial.json');
}
function legacySummaryPathFor(jsonlPath) {
    return jsonlPath.replace(/\.jsonl$/, '-summary.txt');
}
function isKnownKind(kind) {
    return (kind === 'pending' ||
        kind === 'inProgress' ||
        kind === 'complete' ||
        kind === 'stale' ||
        kind === 'poison');
}
// Distinguish "no sidecar on disk" from "sidecar exists but unreadable".
// Missing → migrate from legacy artifacts. Invalid → return pending without
// migration so we neither overwrite the broken bytes (diagnostic value) nor
// re-migrate a conversation the user has already touched.
function readSidecar(jsonlPath) {
    let raw;
    try {
        raw = fs.readFileSync(sidecarPathFor(jsonlPath), 'utf-8');
    }
    catch {
        return { kind: 'missing' };
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        return { kind: 'invalid' };
    }
    if (!parsed || typeof parsed !== 'object')
        return { kind: 'invalid' };
    const obj = parsed;
    if (obj.version !== SCHEMA_VERSION)
        return { kind: 'invalid' };
    if (!isKnownKind(obj.kind))
        return { kind: 'invalid' };
    switch (obj.kind) {
        case 'pending':
            return { kind: 'valid', state: { kind: 'pending' } };
        case 'inProgress':
            if (!Array.isArray(obj.chunkSummaries) ||
                typeof obj.totalChunks !== 'number' ||
                typeof obj.totalExchanges !== 'number' ||
                typeof obj.lastUpdated !== 'string')
                return { kind: 'invalid' };
            return {
                kind: 'valid',
                state: {
                    kind: 'inProgress',
                    chunkSummaries: obj.chunkSummaries,
                    totalChunks: obj.totalChunks,
                    totalExchanges: obj.totalExchanges,
                    lastUpdated: obj.lastUpdated,
                },
            };
        case 'complete':
            if (typeof obj.lastUpdated !== 'string')
                return { kind: 'invalid' };
            return { kind: 'valid', state: { kind: 'complete', lastUpdated: obj.lastUpdated } };
        case 'stale':
            if (typeof obj.lastUpdated !== 'string')
                return { kind: 'invalid' };
            return { kind: 'valid', state: { kind: 'stale', lastUpdated: obj.lastUpdated } };
        case 'poison':
            if (typeof obj.attempts !== 'number' ||
                typeof obj.lastError !== 'string' ||
                typeof obj.lastAttempt !== 'string')
                return { kind: 'invalid' };
            return {
                kind: 'valid',
                state: {
                    kind: 'poison',
                    attempts: obj.attempts,
                    lastError: obj.lastError,
                    lastAttempt: obj.lastAttempt,
                },
            };
    }
}
function writeSidecar(jsonlPath, state) {
    const sidecar = sidecarPathFor(jsonlPath);
    const body = { version: SCHEMA_VERSION, ...state };
    try {
        const tmp = sidecar + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(body, null, 2), 'utf-8');
        fs.renameSync(tmp, sidecar);
    }
    catch {
        // losing a sidecar write is non-fatal
    }
}
function readLegacyGlobalFailure(jsonlPath) {
    try {
        const raw = fs.readFileSync(path.join(getIndexDir(), STATE_FILE), 'utf-8');
        const parsed = JSON.parse(raw);
        const entry = parsed?.failures?.[jsonlPath];
        if (entry &&
            typeof entry.attempts === 'number' &&
            typeof entry.lastError === 'string' &&
            typeof entry.lastAttempt === 'string') {
            return entry;
        }
    }
    catch {
        // missing or corrupt → no migration signal
    }
    return null;
}
function readLegacyPartial(jsonlPath) {
    let raw;
    try {
        raw = fs.readFileSync(legacyPartialPathFor(jsonlPath), 'utf-8');
    }
    catch {
        return null;
    }
    try {
        const parsed = JSON.parse(raw);
        if (parsed?.version === LEGACY_PARTIAL_VERSION &&
            Array.isArray(parsed.chunkSummaries) &&
            typeof parsed.totalChunks === 'number' &&
            typeof parsed.totalExchanges === 'number' &&
            typeof parsed.lastUpdated === 'string') {
            return {
                kind: 'inProgress',
                chunkSummaries: parsed.chunkSummaries,
                totalChunks: parsed.totalChunks,
                totalExchanges: parsed.totalExchanges,
                lastUpdated: parsed.lastUpdated,
            };
        }
    }
    catch {
        // ignore corrupt partial
    }
    return null;
}
function readLegacySummary(jsonlPath) {
    let summaryStat;
    try {
        summaryStat = fs.lstatSync(legacySummaryPathFor(jsonlPath));
    }
    catch {
        return null;
    }
    // If the source jsonl outpaces the summary, the summary is stale. When we
    // can't stat the jsonl (degenerate case), fall back to complete.
    let jsonlStat = null;
    try {
        jsonlStat = fs.lstatSync(jsonlPath);
    }
    catch {
        jsonlStat = null;
    }
    const lastUpdated = summaryStat.mtime.toISOString();
    if (jsonlStat && jsonlStat.mtime.getTime() > summaryStat.mtime.getTime()) {
        return { kind: 'stale', lastUpdated };
    }
    return { kind: 'complete', lastUpdated };
}
function migrate(jsonlPath, retryAll) {
    const fromPartial = readLegacyPartial(jsonlPath);
    if (fromPartial) {
        writeSidecar(jsonlPath, fromPartial);
        return fromPartial;
    }
    const fromGlobal = readLegacyGlobalFailure(jsonlPath);
    if (fromGlobal) {
        // RETRY_ALL skips sidecar write so the legacy global record stays
        // authoritative for the next run when the env is unset.
        if (retryAll)
            return { kind: 'pending' };
        const poison = {
            kind: 'poison',
            attempts: fromGlobal.attempts,
            lastError: fromGlobal.lastError,
            lastAttempt: fromGlobal.lastAttempt,
        };
        writeSidecar(jsonlPath, poison);
        return poison;
    }
    const fromSummary = readLegacySummary(jsonlPath);
    if (fromSummary) {
        writeSidecar(jsonlPath, fromSummary);
        return fromSummary;
    }
    return { kind: 'pending' };
}
export function isRetriable(state) {
    return state.kind !== 'poison' || state.attempts < MAX_ATTEMPTS;
}
function walkSidecars(dir, out) {
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    }
    catch {
        return;
    }
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walkSidecars(full, out);
        }
        else if (entry.isFile() && entry.name.endsWith('.sync.json')) {
            out.push(full);
        }
    }
}
export function openConversationSyncStateStore(opts) {
    const archiveDir = opts?.archiveDir ?? getArchiveDir();
    const load = (jsonlPath) => {
        const retryAll = !!process.env.EPISODIC_MEMORY_RETRY_ALL;
        const result = readSidecar(jsonlPath);
        if (result.kind === 'valid') {
            // Honour retry-all by masking poison without rewriting the on-disk record.
            if (retryAll && result.state.kind === 'poison')
                return { kind: 'pending' };
            return result.state;
        }
        // Invalid sidecar bytes: do NOT migrate (would clobber diagnostic info)
        // and do NOT overwrite the file. Treat as Pending so the next sync retries.
        if (result.kind === 'invalid')
            return { kind: 'pending' };
        return migrate(jsonlPath, retryAll);
    };
    const save = (jsonlPath, next) => {
        writeSidecar(jsonlPath, next);
    };
    const recordFailure = (jsonlPath, error) => {
        const next = buildPoisonState(load(jsonlPath), error);
        save(jsonlPath, next);
        return next;
    };
    const clearFailure = (jsonlPath) => {
        // Only act on a confirmed-poison sidecar — invalid sidecars are left in
        // place for diagnosis; missing sidecars have nothing to clear.
        const result = readSidecar(jsonlPath);
        if (result.kind === 'valid' && result.state.kind === 'poison') {
            try {
                fs.unlinkSync(sidecarPathFor(jsonlPath));
            }
            catch {
                // ignore
            }
        }
    };
    const markStale = (jsonlPath) => {
        const current = load(jsonlPath);
        if (current.kind === 'complete') {
            const next = { kind: 'stale', lastUpdated: new Date().toISOString() };
            save(jsonlPath, next);
            return next;
        }
        return current;
    };
    const countPoison = () => {
        const sidecars = [];
        walkSidecars(archiveDir, sidecars);
        let count = 0;
        for (const sc of sidecars) {
            try {
                const parsed = JSON.parse(fs.readFileSync(sc, 'utf-8'));
                if (parsed?.version === SCHEMA_VERSION &&
                    parsed?.kind === 'poison' &&
                    typeof parsed.attempts === 'number' &&
                    parsed.attempts >= MAX_ATTEMPTS) {
                    count++;
                }
            }
            catch {
                // skip corrupt sidecar
            }
        }
        return count;
    };
    return { load, save, recordFailure, clearFailure, markStale, countPoison };
}
export function openMemoryConversationSyncStateStore() {
    const map = new Map();
    const load = (jsonlPath) => {
        const current = map.get(jsonlPath) ?? { kind: 'pending' };
        // Mirror filesystem store: retry-all masks poison without mutating storage.
        if (process.env.EPISODIC_MEMORY_RETRY_ALL && current.kind === 'poison') {
            return { kind: 'pending' };
        }
        return current;
    };
    const save = (jsonlPath, next) => {
        map.set(jsonlPath, next);
    };
    const recordFailure = (jsonlPath, error) => {
        const next = buildPoisonState(map.get(jsonlPath) ?? { kind: 'pending' }, error);
        map.set(jsonlPath, next);
        return next;
    };
    const clearFailure = (jsonlPath) => {
        const current = map.get(jsonlPath);
        if (current?.kind === 'poison') {
            map.delete(jsonlPath);
        }
    };
    const markStale = (jsonlPath) => {
        const current = map.get(jsonlPath) ?? { kind: 'pending' };
        if (current.kind === 'complete') {
            const next = { kind: 'stale', lastUpdated: new Date().toISOString() };
            map.set(jsonlPath, next);
            return next;
        }
        return current;
    };
    const countPoison = () => {
        let count = 0;
        for (const state of map.values()) {
            if (state.kind === 'poison' && state.attempts >= MAX_ATTEMPTS) {
                count++;
            }
        }
        return count;
    };
    return { load, save, recordFailure, clearFailure, markStale, countPoison };
}
