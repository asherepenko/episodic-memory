import fs from 'fs';
import path from 'path';
import { SUMMARIZER_CONTEXT_MARKER } from '../constants.js';
import { getExcludedProjects, findJsonlFiles, entryIsDirectory } from '../paths.js';
import { log } from '../logger.js';
import {
  openConversationSyncStateStore,
  isRetriable,
  MAX_ATTEMPTS,
  SyncState,
} from './conversation-sync-state.js';

const EXCLUSION_MARKERS = [
  '<INSTRUCTIONS-TO-EPISODIC-MEMORY>DO NOT INDEX THIS CHAT</INSTRUCTIONS-TO-EPISODIC-MEMORY>',
  'Only use NO_INSIGHTS_FOUND',
  SUMMARIZER_CONTEXT_MARKER,
];

// Markers always appear in the system prompt or first user turn — well
// inside the first 32 KB of any transcript. Reading the entire JSONL is
// wasteful for multi-megabyte conversations.
const MARKER_SCAN_BYTES = 32 * 1024;

function shouldSkipConversation(filePath: string): boolean {
  let fd: number | undefined;
  try {
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(MARKER_SCAN_BYTES);
    const bytesRead = fs.readSync(fd, buf, 0, MARKER_SCAN_BYTES, 0);
    const head = buf.subarray(0, bytesRead).toString('utf-8');
    return EXCLUSION_MARKERS.some(marker => head.includes(marker));
  } catch {
    return false;
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* ignore */ }
    }
  }
}

export interface SyncResult {
  copied: number;
  skipped: number;
  indexed: number;
  summarized: number;
  errors: Array<{ file: string; error: string }>;
}

/**
 * Progress events for terminal rendering. One project-start/project-done pair
 * per project (copy + index), then one summary-start/summary-done pair per
 * summarized conversation. `index` is 1-based within `total`; summary-done is
 * numbered in completion order. `label` overrides the displayed name and
 * `worktrees` counts worktree dirs folded into the row.
 */
export type SyncEvent =
  | { type: 'project-start'; project: string; index: number; total: number; label?: string }
  | { type: 'project-progress'; project: string; index: number; total: number; done: number; of: number; label?: string }
  | { type: 'project-done'; project: string; index: number; total: number; copied: number; indexed: number; exchanges: number; errors: number; label?: string; worktrees?: number }
  | { type: 'summary-start'; file: string; project: string; index: number; total: number }
  | { type: 'summary-done'; file: string; project: string; index: number; total: number; ms: number; ok: boolean; error?: string };

export interface SyncOptions {
  skipIndex?: boolean;
  skipSummaries?: boolean;
  summaryLimit?: number; // Max summaries to generate per run (default: 10)
  concurrency?: number;  // Parallel summary workers; overrides EPISODIC_MEMORY_CONCURRENCY (default: 2)
  onEvent?: (event: SyncEvent) => void;
}

export interface IndexArchiveOptions {
  /** Archive project dirs already handled by a source pass this run. */
  skipProjects?: ReadonlySet<string>;
  onEvent?: (event: SyncEvent) => void;
}

/**
 * Resolve the parallel-summary-worker count.
 * Precedence: explicit option (the `--concurrency` flag) > EPISODIC_MEMORY_CONCURRENCY env > default 2.
 * Non-positive or non-numeric inputs fall through to the next source.
 */
export function resolveSummaryConcurrency(
  optionConcurrency: number | undefined,
  envValue: string | undefined,
): number {
  if (optionConcurrency !== undefined && optionConcurrency > 0) return optionConcurrency;
  const env = parseInt(envValue ?? '', 10);
  if (Number.isFinite(env) && env > 0) return env;
  return 2;
}

function copyIfNewer(src: string, dest: string): boolean {
  // Ensure destination directory exists
  const destDir = path.dirname(dest);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  // Check if destination exists and is up-to-date
  if (fs.existsSync(dest)) {
    const srcStat = fs.lstatSync(src);
    const destStat = fs.lstatSync(dest);
    if (destStat.mtimeMs >= srcStat.mtimeMs) {
      return false; // Dest is current, skip
    }
  }

  // Atomic copy: temp file + rename
  const tempDest = dest + '.tmp.' + process.pid;
  fs.copyFileSync(src, tempDest);
  fs.renameSync(tempDest, dest); // Atomic on same filesystem
  return true;
}

interface ArchiveIndexer {
  indexProject(projectDir: string, project: string, onProgress?: (done: number, of: number) => void): Promise<{ indexed: number; exchanges: number; errors: Array<{ file: string; error: string }> }>;
  close(): void;
}

/**
 * Indexes archived transcripts that indexed_files says are missing or stale.
 * Opens the DB on first use and loads the embedding model only when a file
 * actually needs indexing, so an up-to-date sync stays cheap.
 */
function createArchiveIndexer(excludedDirSet: ReadonlySet<string>): ArchiveIndexer {
  let state: {
    db: import('better-sqlite3').Database;
    mtimes: Map<string, number>;
    markFileIndexed: typeof import('../db.js').markFileIndexed;
    insertExchange: typeof import('../db.js').insertExchange;
  } | undefined;
  let embeddingsReady = false;

  async function open() {
    if (state) return state;
    const { initDatabase, insertExchange, getIndexedFileMtimes, markFileIndexed } = await import('../db.js');
    const db = initDatabase();
    state = { db, mtimes: getIndexedFileMtimes(db), markFileIndexed, insertExchange };
    return state;
  }

  return {
    async indexProject(projectDir, project, onProgress) {
      const out = { indexed: 0, exchanges: 0, errors: [] as Array<{ file: string; error: string }> };
      if (!fs.existsSync(projectDir)) return out;
      const { db, mtimes, markFileIndexed, insertExchange } = await open();

      const pending: Array<{ file: string; mtimeMs: number }> = [];
      for (const rel of findJsonlFiles(projectDir, excludedDirSet)) {
        const file = path.join(projectDir, rel);
        try {
          const mtimeMs = fs.statSync(file).mtimeMs;
          const indexedAt = mtimes.get(file);
          if (indexedAt === undefined || mtimeMs > indexedAt) pending.push({ file, mtimeMs });
        } catch {
          // vanished between walk and stat
        }
      }
      if (pending.length === 0) return out;

      const { generateExchangeEmbedding, initEmbeddings } = await import('../embeddings.js');
      const { parseConversation } = await import('../parser.js');

      for (const [i, { file, mtimeMs }] of pending.entries()) {
        onProgress?.(i, pending.length);
        try {
          if (shouldSkipConversation(file)) {
            markFileIndexed(db, file, mtimeMs, 0);
            mtimes.set(file, mtimeMs);
            continue;
          }
          const exchanges = await parseConversation(file, project, file);
          if (exchanges.length > 0 && !embeddingsReady) {
            await initEmbeddings();
            embeddingsReady = true;
          }
          for (const exchange of exchanges) {
            const toolNames = exchange.toolCalls?.map(tc => tc.toolName);
            const embedding = await generateExchangeEmbedding(exchange.userMessage, exchange.assistantMessage, toolNames);
            insertExchange(db, exchange, embedding, toolNames);
          }
          // Recorded only after every exchange landed: a crash mid-file leaves
          // no row, so the next run retries it (inserts are idempotent by id).
          markFileIndexed(db, file, mtimeMs, exchanges.length);
          mtimes.set(file, mtimeMs);
          out.indexed++;
          out.exchanges += exchanges.length;
        } catch (error) {
          out.errors.push({ file, error: error instanceof Error ? error.message : String(error) });
        }
      }
      onProgress?.(pending.length, pending.length);
      return out;
    },
    close() {
      state?.db.close();
      state = undefined;
    },
  };
}

export function extractSessionIdFromPath(filePath: string): string | null {
  // Extract session ID from filename. Handles two formats:
  //  - Plain Claude UUID:        /path/to/abc-123-def.jsonl -> abc-123-def
  //  - Codex rollout filename:   /path/rollout-2026-05-12T18-00-00-<uuid>.jsonl -> <uuid>
  const basename = path.basename(filePath, '.jsonl');
  const uuidRe = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(basename)) {
    return basename;
  }
  if (basename.startsWith('rollout-')) {
    const match = basename.match(uuidRe);
    if (match) return match[0];
  }
  return null;
}

export interface ProjectOutcome {
  copied: number;
  indexed: number;
  exchanges: number;
  errors: number;
}

/**
 * One sync run over a shared archive, driven one project at a time so a caller
 * can order and group projects across sources. Summaries are collected while
 * projects sync and generated once, by summarize(), at the end.
 */
export interface SyncSession {
  /** Copy a source project's transcripts into the archive, then index its archive dir. */
  syncProject(sourceDir: string, project: string, onProgress?: (done: number, of: number) => void): Promise<ProjectOutcome>;
  /** Index an archive-only project dir (its live transcripts are gone). */
  indexProject(project: string, onProgress?: (done: number, of: number) => void): Promise<ProjectOutcome>;
  summarize(): Promise<void>;
  readonly result: SyncResult;
  close(): void;
}

export function createSyncSession(destDir: string, options: SyncOptions = {}): SyncSession {
  const result: SyncResult = { copied: 0, skipped: 0, indexed: 0, summarized: 0, errors: [] };
  const store = openConversationSyncStateStore();
  const emit = options.onEvent ?? (() => {});
  const excludedDirSet = new Set(getExcludedProjects());
  const indexer = createArchiveIndexer(excludedDirSet);
  const filesToSummarize: Array<{ path: string; sessionId: string; state: SyncState }> = [];

  // Index everything in the project's archive dir that indexed_files lacks —
  // not just what was copied now. A run that dies between copy and index
  // (e.g. a broken native binding) is healed here on the next run.
  async function indexInto(outcome: ProjectOutcome, project: string, onProgress?: (done: number, of: number) => void) {
    if (options.skipIndex) return;
    try {
      const r = await indexer.indexProject(path.join(destDir, project), project, onProgress);
      outcome.indexed += r.indexed;
      outcome.exchanges += r.exchanges;
      outcome.errors += r.errors.length;
      result.indexed += r.indexed;
      result.errors.push(...r.errors);
    } catch (error) {
      outcome.errors++;
      result.errors.push({ file: path.join(destDir, project), error: error instanceof Error ? error.message : String(error) });
    }
  }

  return {
    result,

    async syncProject(sourceDir, project, onProgress) {
      const outcome: ProjectOutcome = { copied: 0, indexed: 0, exchanges: 0, errors: 0 };
      const projectPath = path.join(sourceDir, project);

      for (const file of findJsonlFiles(projectPath, excludedDirSet)) {
        const srcFile = path.join(projectPath, file);
        const destFile = path.join(destDir, project, file);

        try {
          const wasCopied = copyIfNewer(srcFile, destFile);
          let state: SyncState;
          if (wasCopied) {
            result.copied++;
            outcome.copied++;
            state = store.markStale(destFile);
          } else {
            result.skipped++;
            state = store.load(destFile);
          }

          // Check if this file needs a summary (whether newly copied or existing)
          if (!options.skipSummaries && state.kind !== 'complete' && !shouldSkipConversation(destFile)) {
            const sessionId = extractSessionIdFromPath(destFile);
            if (sessionId) {
              filesToSummarize.push({ path: destFile, sessionId, state });
            }
          }
        } catch (error) {
          outcome.errors++;
          result.errors.push({
            file: srcFile,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      await indexInto(outcome, project, onProgress);
      return outcome;
    },

    async indexProject(project, onProgress) {
      const outcome: ProjectOutcome = { copied: 0, indexed: 0, exchanges: 0, errors: 0 };
      await indexInto(outcome, project, onProgress);
      return outcome;
    },

    async summarize() {
      if (options.skipSummaries || filesToSummarize.length === 0) return;
      const { parseConversation } = await import('../parser.js');
      const { summarizeConversation } = await import('../summarizer.js');
      const { dedupAgainstSiblings } = await import('../dedup.js');

      const beforeFilter = filesToSummarize.length;
      const eligible = filesToSummarize.filter(f => f.state.kind !== 'poison' || isRetriable(f.state));
      const skippedPoison = beforeFilter - eligible.length;
      if (skippedPoison > 0) {
        log.info(`Skipping ${skippedPoison} file(s) that exceeded ${MAX_ATTEMPTS} retries (set EPISODIC_MEMORY_RETRY_ALL=1 to retry).`);
      }

      const summaryLimit = options.summaryLimit ?? 10;
      const toSummarize = eligible.slice(0, summaryLimit);
      const remaining = eligible.length - toSummarize.length;

      const concurrency = resolveSummaryConcurrency(
        options.concurrency,
        process.env.EPISODIC_MEMORY_CONCURRENCY,
      );

      log.info(`Generating summaries for ${toSummarize.length} conversation(s) (concurrency=${concurrency})...`);
      if (remaining > 0) {
        log.info(`  (${remaining} more need summaries - will process on next sync)`);
      }

      const total = toSummarize.length;
      let finished = 0;

      async function summarizeOne(filePath: string, index: number): Promise<void> {
        const startedAt = Date.now();
        const project = path.basename(path.dirname(filePath));
        emit({ type: 'summary-start', file: filePath, project, index, total });
        // Rows are numbered in completion order so parallel workers print 1, 2, 3...
        const done = (ok: boolean, error?: string) =>
          emit({ type: 'summary-done', file: filePath, project, index: ++finished, total, ms: Date.now() - startedAt, ok, error });
        try {
          const exchanges = await parseConversation(filePath, project, filePath);

          if (exchanges.length === 0) {
            // Zero-exchange / metadata-only file (#91). Mark the state terminal
            // so it isn't re-parsed and re-queued on every sync run. If the file
            // later grows, copyIfNewer → markStale re-opens it for summarization.
            store.save(filePath, { kind: 'complete', lastUpdated: new Date().toISOString() });
            done(true);
            return;
          }

          // Only resume chunks if exchange count still matches; otherwise the
          // conversation grew/shrank and cached chunks are stale.
          const pre = store.load(filePath);
          const initialChunkSummaries =
            pre.kind === 'inProgress' && pre.totalExchanges === exchanges.length
              ? pre.chunkSummaries
              : [];

          log.info(`  Summarizing ${path.basename(filePath)} (${exchanges.length} exchanges)...`);
          const rawSummary = await summarizeConversation(exchanges, {
            initialChunkSummaries,
            onChunkComplete: (chunkSummaries, totalChunks, totalExchanges) => {
              store.save(filePath, {
                kind: 'inProgress',
                chunkSummaries,
                totalChunks,
                totalExchanges,
                lastUpdated: new Date().toISOString(),
              });
            },
          });

          const summaryPath = filePath.replace('.jsonl', '-summary.txt');
          const { summary, deduped, similarity } = await dedupAgainstSiblings(rawSummary, summaryPath);
          if (deduped) {
            log.info(`    deduped ${path.basename(filePath)} (similarity=${similarity?.toFixed(3)})`);
          }
          const tmpSummaryPath = `${summaryPath}.tmp.${process.pid}`;
          fs.writeFileSync(tmpSummaryPath, summary, 'utf-8');
          fs.renameSync(tmpSummaryPath, summaryPath);
          result.summarized++;
          store.clearFailure(filePath);
          store.save(filePath, { kind: 'complete', lastUpdated: new Date().toISOString() });
          log.info(`    done ${path.basename(filePath)} in ${Date.now() - startedAt}ms`);
          done(true);
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          const newState = store.recordFailure(filePath, msg);
          const attempts = newState.kind === 'poison' ? newState.attempts : 0;
          log.warn(`    failed ${path.basename(filePath)} after ${Date.now() - startedAt}ms (attempt ${attempts}/${MAX_ATTEMPTS}): ${msg}`);
          result.errors.push({
            file: filePath,
            error: `Summary generation failed: ${msg}`
          });
          done(false, msg);
        }
      }

      // Bounded-concurrency pool: each worker pulls next file index until queue drained.
      let cursor = 0;
      const queue = toSummarize;
      const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
        while (true) {
          const i = cursor++;
          if (i >= queue.length) return;
          await summarizeOne(queue[i].path, i + 1);
        }
      });
      await Promise.all(workers);
      const poisonCount = store.countPoison();
      if (poisonCount > 0) {
        log.info(`State: ${poisonCount} file(s) recorded as poison-pill (≥${MAX_ATTEMPTS} attempts).`);
      }
    },

    close() {
      indexer.close();
    },
  };
}

/** Project dirs in a source, minus excluded ones, sorted. */
export function listSourceProjects(sourceDir: string): string[] {
  if (!fs.existsSync(sourceDir)) return [];
  const excluded = new Set(getExcludedProjects());
  return fs.readdirSync(sourceDir, { withFileTypes: true })
    // Dirent.isDirectory() does not follow symlinks — worktree symlinks are skipped automatically
    .filter(entry => entry.isDirectory() && !excluded.has(entry.name))
    .map(entry => entry.name)
    .sort();
}

/** Archive project dirs, minus excluded ones, sorted. */
export function listArchiveProjects(destDir: string): string[] {
  if (!fs.existsSync(destDir)) return [];
  const excluded = new Set(getExcludedProjects());
  return fs.readdirSync(destDir, { withFileTypes: true })
    .filter(entry => entryIsDirectory(destDir, entry) && !excluded.has(entry.name))
    .map(entry => entry.name)
    .sort();
}

async function runProjects(
  projects: string[],
  session: SyncSession,
  onEvent: SyncOptions['onEvent'],
  run: (project: string, onProgress: (done: number, of: number) => void) => Promise<ProjectOutcome>,
): Promise<void> {
  const emit = onEvent ?? (() => {});
  for (const [i, project] of projects.entries()) {
    const index = i + 1;
    const total = projects.length;
    emit({ type: 'project-start', project, index, total });
    const outcome = await run(project, (done, of) => emit({ type: 'project-progress', project, index, total, done, of }));
    emit({ type: 'project-done', project, index, total, ...outcome });
  }
}

/**
 * Index archive project dirs that no source pass covered — typically projects
 * whose live transcripts Claude Code has already deleted.
 */
export async function indexArchive(destDir: string, options: IndexArchiveOptions = {}): Promise<SyncResult> {
  const projects = listArchiveProjects(destDir).filter(name => !options.skipProjects?.has(name));
  const session = createSyncSession(destDir, { skipSummaries: true });
  try {
    await runProjects(projects, session, options.onEvent, (project, onProgress) => session.indexProject(project, onProgress));
  } finally {
    session.close();
  }
  return session.result;
}

export async function syncConversations(
  sourceDir: string,
  destDir: string,
  options: SyncOptions = {}
): Promise<SyncResult> {
  const session = createSyncSession(destDir, options);
  try {
    await runProjects(listSourceProjects(sourceDir), session, options.onEvent, (project, onProgress) =>
      session.syncProject(sourceDir, project, onProgress));
  } finally {
    session.close();
  }
  await session.summarize();
  return session.result;
}
