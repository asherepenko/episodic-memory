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

export type SyncStateKind = 'pending' | 'inProgress' | 'complete' | 'stale' | 'poison';

export type SyncState =
  | { kind: 'pending' }
  | {
      kind: 'inProgress';
      chunkSummaries: string[];
      totalChunks: number;
      totalExchanges: number;
      lastUpdated: string;
    }
  | { kind: 'complete'; lastUpdated: string }
  | { kind: 'stale'; lastUpdated: string }
  | {
      kind: 'poison';
      attempts: number;
      lastError: string;
      lastAttempt: string;
    };

export interface ConversationSyncStateStore {
  load(jsonlPath: string): SyncState;
  save(jsonlPath: string, next: SyncState): void;
  recordFailure(jsonlPath: string, error: string): SyncState;
  clearFailure(jsonlPath: string): void;
  markStale(jsonlPath: string): void;
  countPoison(): number;
}

export function sidecarPathFor(jsonlPath: string): string {
  return jsonlPath.replace(/\.jsonl$/, '.sync.json');
}

function legacyPartialPathFor(jsonlPath: string): string {
  return jsonlPath.replace(/\.jsonl$/, '-summary.partial.json');
}

function legacySummaryPathFor(jsonlPath: string): string {
  return jsonlPath.replace(/\.jsonl$/, '-summary.txt');
}

function isKnownKind(kind: unknown): kind is SyncStateKind {
  return (
    kind === 'pending' ||
    kind === 'inProgress' ||
    kind === 'complete' ||
    kind === 'stale' ||
    kind === 'poison'
  );
}

function parseSidecar(jsonlPath: string): SyncState | null {
  let raw: string;
  try {
    raw = fs.readFileSync(sidecarPathFor(jsonlPath), 'utf-8');
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  if (obj.version !== SCHEMA_VERSION) return null;
  if (!isKnownKind(obj.kind)) return null;

  switch (obj.kind) {
    case 'pending':
      return { kind: 'pending' };
    case 'inProgress':
      if (
        !Array.isArray(obj.chunkSummaries) ||
        typeof obj.totalChunks !== 'number' ||
        typeof obj.totalExchanges !== 'number' ||
        typeof obj.lastUpdated !== 'string'
      ) return null;
      return {
        kind: 'inProgress',
        chunkSummaries: obj.chunkSummaries as string[],
        totalChunks: obj.totalChunks,
        totalExchanges: obj.totalExchanges,
        lastUpdated: obj.lastUpdated,
      };
    case 'complete':
      if (typeof obj.lastUpdated !== 'string') return null;
      return { kind: 'complete', lastUpdated: obj.lastUpdated };
    case 'stale':
      if (typeof obj.lastUpdated !== 'string') return null;
      return { kind: 'stale', lastUpdated: obj.lastUpdated };
    case 'poison':
      if (
        typeof obj.attempts !== 'number' ||
        typeof obj.lastError !== 'string' ||
        typeof obj.lastAttempt !== 'string'
      ) return null;
      return {
        kind: 'poison',
        attempts: obj.attempts,
        lastError: obj.lastError,
        lastAttempt: obj.lastAttempt,
      };
  }
}

function writeSidecar(jsonlPath: string, state: SyncState): void {
  const sidecar = sidecarPathFor(jsonlPath);
  const body = { version: SCHEMA_VERSION, ...state };
  try {
    const tmp = sidecar + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(body, null, 2), 'utf-8');
    fs.renameSync(tmp, sidecar);
  } catch {
    // losing a sidecar write is non-fatal
  }
}

interface LegacyFailureEntry {
  attempts: number;
  lastError: string;
  lastAttempt: string;
}

function readLegacyGlobalFailure(jsonlPath: string): LegacyFailureEntry | null {
  try {
    const raw = fs.readFileSync(path.join(getIndexDir(), STATE_FILE), 'utf-8');
    const parsed = JSON.parse(raw);
    const entry = parsed?.failures?.[jsonlPath];
    if (
      entry &&
      typeof entry.attempts === 'number' &&
      typeof entry.lastError === 'string' &&
      typeof entry.lastAttempt === 'string'
    ) {
      return entry;
    }
  } catch {
    // missing or corrupt → no migration signal
  }
  return null;
}

function readLegacyPartial(jsonlPath: string): SyncState | null {
  let raw: string;
  try {
    raw = fs.readFileSync(legacyPartialPathFor(jsonlPath), 'utf-8');
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed?.version === LEGACY_PARTIAL_VERSION &&
      Array.isArray(parsed.chunkSummaries) &&
      typeof parsed.totalChunks === 'number' &&
      typeof parsed.totalExchanges === 'number' &&
      typeof parsed.lastUpdated === 'string'
    ) {
      return {
        kind: 'inProgress',
        chunkSummaries: parsed.chunkSummaries as string[],
        totalChunks: parsed.totalChunks,
        totalExchanges: parsed.totalExchanges,
        lastUpdated: parsed.lastUpdated,
      };
    }
  } catch {
    // ignore corrupt partial
  }
  return null;
}

function readLegacySummary(jsonlPath: string): SyncState | null {
  try {
    const stat = fs.lstatSync(legacySummaryPathFor(jsonlPath));
    return { kind: 'complete', lastUpdated: stat.mtime.toISOString() };
  } catch {
    return null;
  }
}

function migrate(jsonlPath: string): SyncState {
  const fromPartial = readLegacyPartial(jsonlPath);
  if (fromPartial) {
    writeSidecar(jsonlPath, fromPartial);
    return fromPartial;
  }
  const fromGlobal = readLegacyGlobalFailure(jsonlPath);
  if (fromGlobal) {
    const poison: SyncState = {
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

export function isRetriable(state: SyncState): boolean {
  return state.kind !== 'poison' || state.attempts < MAX_ATTEMPTS;
}

function walkSidecars(dir: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkSidecars(full, out);
    } else if (entry.isFile() && entry.name.endsWith('.sync.json')) {
      out.push(full);
    }
  }
}

export function openConversationSyncStateStore(opts?: { archiveDir?: string }): ConversationSyncStateStore {
  const archiveDir = opts?.archiveDir ?? getArchiveDir();

  const load = (jsonlPath: string): SyncState => {
    const fromSidecar = parseSidecar(jsonlPath);
    if (fromSidecar) {
      // Honour retry-all by masking poison without rewriting the on-disk record.
      if (process.env.EPISODIC_MEMORY_RETRY_ALL && fromSidecar.kind === 'poison') {
        return { kind: 'pending' };
      }
      return fromSidecar;
    }
    return migrate(jsonlPath);
  };

  const save = (jsonlPath: string, next: SyncState): void => {
    writeSidecar(jsonlPath, next);
  };

  const recordFailure = (jsonlPath: string, error: string): SyncState => {
    const current = load(jsonlPath);
    const prevAttempts = current.kind === 'poison' ? current.attempts : 0;
    const next: SyncState = {
      kind: 'poison',
      attempts: prevAttempts + 1,
      lastError: error,
      lastAttempt: new Date().toISOString(),
    };
    save(jsonlPath, next);
    return next;
  };

  const clearFailure = (jsonlPath: string): void => {
    const current = parseSidecar(jsonlPath);
    if (current?.kind === 'poison') {
      try {
        fs.unlinkSync(sidecarPathFor(jsonlPath));
      } catch {
        // ignore
      }
    }
  };

  const markStale = (jsonlPath: string): void => {
    const current = load(jsonlPath);
    if (current.kind === 'complete') {
      save(jsonlPath, { kind: 'stale', lastUpdated: new Date().toISOString() });
    }
  };

  const countPoison = (): number => {
    const sidecars: string[] = [];
    walkSidecars(archiveDir, sidecars);
    let count = 0;
    for (const sc of sidecars) {
      try {
        const parsed = JSON.parse(fs.readFileSync(sc, 'utf-8'));
        if (
          parsed?.version === SCHEMA_VERSION &&
          parsed?.kind === 'poison' &&
          typeof parsed.attempts === 'number' &&
          parsed.attempts >= MAX_ATTEMPTS
        ) {
          count++;
        }
      } catch {
        // skip corrupt sidecar
      }
    }
    return count;
  };

  return { load, save, recordFailure, clearFailure, markStale, countPoison };
}

export function openMemoryConversationSyncStateStore(): ConversationSyncStateStore {
  const map = new Map<string, SyncState>();

  const load = (jsonlPath: string): SyncState => {
    const current = map.get(jsonlPath) ?? { kind: 'pending' };
    // Mirror filesystem store: retry-all masks poison without mutating storage.
    if (process.env.EPISODIC_MEMORY_RETRY_ALL && current.kind === 'poison') {
      return { kind: 'pending' };
    }
    return current;
  };

  const save = (jsonlPath: string, next: SyncState): void => {
    map.set(jsonlPath, next);
  };

  const recordFailure = (jsonlPath: string, error: string): SyncState => {
    const current = map.get(jsonlPath) ?? { kind: 'pending' };
    const prevAttempts = current.kind === 'poison' ? current.attempts : 0;
    const next: SyncState = {
      kind: 'poison',
      attempts: prevAttempts + 1,
      lastError: error,
      lastAttempt: new Date().toISOString(),
    };
    map.set(jsonlPath, next);
    return next;
  };

  const clearFailure = (jsonlPath: string): void => {
    const current = map.get(jsonlPath);
    if (current?.kind === 'poison') {
      map.delete(jsonlPath);
    }
  };

  const markStale = (jsonlPath: string): void => {
    const current = map.get(jsonlPath) ?? { kind: 'pending' };
    if (current.kind === 'complete') {
      map.set(jsonlPath, { kind: 'stale', lastUpdated: new Date().toISOString() });
    }
  };

  const countPoison = (): number => {
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
