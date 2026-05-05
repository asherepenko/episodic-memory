import fs from 'fs';
import path from 'path';
import { SUMMARIZER_CONTEXT_MARKER } from '../constants.js';
import { getExcludedProjects, findJsonlFiles } from '../paths.js';
import { log } from '../logger.js';
import { openConversationSyncStateStore, isRetriable, MAX_ATTEMPTS, } from './conversation-sync-state.js';
const EXCLUSION_MARKERS = [
    '<INSTRUCTIONS-TO-EPISODIC-MEMORY>DO NOT INDEX THIS CHAT</INSTRUCTIONS-TO-EPISODIC-MEMORY>',
    'Only use NO_INSIGHTS_FOUND',
    SUMMARIZER_CONTEXT_MARKER,
];
// Markers always appear in the system prompt or first user turn — well
// inside the first 32 KB of any transcript. Reading the entire JSONL is
// wasteful for multi-megabyte conversations.
const MARKER_SCAN_BYTES = 32 * 1024;
function shouldSkipConversation(filePath) {
    let fd;
    try {
        fd = fs.openSync(filePath, 'r');
        const buf = Buffer.alloc(MARKER_SCAN_BYTES);
        const bytesRead = fs.readSync(fd, buf, 0, MARKER_SCAN_BYTES, 0);
        const head = buf.slice(0, bytesRead).toString('utf-8');
        return EXCLUSION_MARKERS.some(marker => head.includes(marker));
    }
    catch {
        return false;
    }
    finally {
        if (fd !== undefined) {
            try {
                fs.closeSync(fd);
            }
            catch { /* ignore */ }
        }
    }
}
function copyIfNewer(src, dest) {
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
function extractSessionIdFromPath(filePath) {
    // Extract session ID from filename: /path/to/abc-123-def.jsonl -> abc-123-def
    const basename = path.basename(filePath, '.jsonl');
    // Session IDs are UUIDs, validate format
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(basename)) {
        return basename;
    }
    return null;
}
export async function syncConversations(sourceDir, destDir, options = {}) {
    const result = {
        copied: 0,
        skipped: 0,
        indexed: 0,
        summarized: 0,
        errors: []
    };
    // Ensure source directory exists
    if (!fs.existsSync(sourceDir)) {
        return result;
    }
    const store = openConversationSyncStateStore();
    // Collect files to index and summarize
    const filesToIndex = [];
    const filesToSummarize = [];
    // Walk source directory
    const projectEntries = fs.readdirSync(sourceDir, { withFileTypes: true });
    const excludedProjects = getExcludedProjects();
    const excludedDirSet = new Set(excludedProjects);
    for (const projectEntry of projectEntries) {
        // Dirent.isDirectory() does not follow symlinks — worktree symlinks are skipped automatically
        if (!projectEntry.isDirectory())
            continue;
        const project = projectEntry.name;
        if (excludedDirSet.has(project)) {
            log.info("\nSkipping excluded project: " + project);
            continue;
        }
        const projectPath = path.join(sourceDir, project);
        const files = findJsonlFiles(projectPath, excludedDirSet);
        for (const file of files) {
            const srcFile = path.join(projectPath, file);
            const destFile = path.join(destDir, project, file);
            try {
                const wasCopied = copyIfNewer(srcFile, destFile);
                let state;
                if (wasCopied) {
                    result.copied++;
                    filesToIndex.push(destFile);
                    state = store.markStale(destFile);
                }
                else {
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
            }
            catch (error) {
                result.errors.push({
                    file: srcFile,
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }
    }
    // Index copied files (unless skipIndex is set)
    if (!options.skipIndex && filesToIndex.length > 0) {
        const { initDatabase, insertExchange } = await import('../db.js');
        const { initEmbeddings, generateExchangeEmbedding } = await import('../embeddings.js');
        const { parseConversation } = await import('../parser.js');
        const db = initDatabase();
        await initEmbeddings();
        for (const file of filesToIndex) {
            try {
                // Check for DO NOT INDEX marker
                if (shouldSkipConversation(file)) {
                    continue; // Skip indexing but file is already copied
                }
                const project = path.basename(path.dirname(file));
                const exchanges = await parseConversation(file, project, file);
                for (const exchange of exchanges) {
                    const toolNames = exchange.toolCalls?.map(tc => tc.toolName);
                    const embedding = await generateExchangeEmbedding(exchange.userMessage, exchange.assistantMessage, toolNames);
                    insertExchange(db, exchange, embedding, toolNames);
                }
                result.indexed++;
            }
            catch (error) {
                result.errors.push({
                    file,
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }
        db.close();
    }
    // Generate summaries for files that need them
    if (!options.skipSummaries && filesToSummarize.length > 0) {
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
        const concurrencyRaw = parseInt(process.env.EPISODIC_MEMORY_CONCURRENCY ?? '', 10);
        const concurrency = Number.isFinite(concurrencyRaw) && concurrencyRaw > 0 ? concurrencyRaw : 2;
        log.info(`Generating summaries for ${toSummarize.length} conversation(s) (concurrency=${concurrency})...`);
        if (remaining > 0) {
            log.info(`  (${remaining} more need summaries - will process on next sync)`);
        }
        async function summarizeOne(filePath) {
            const startedAt = Date.now();
            try {
                const project = path.basename(path.dirname(filePath));
                const exchanges = await parseConversation(filePath, project, filePath);
                if (exchanges.length === 0) {
                    return; // Skip empty conversations
                }
                // Only resume chunks if exchange count still matches; otherwise the
                // conversation grew/shrank and cached chunks are stale.
                const pre = store.load(filePath);
                const initialChunkSummaries = pre.kind === 'inProgress' && pre.totalExchanges === exchanges.length
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
            }
            catch (error) {
                const msg = error instanceof Error ? error.message : String(error);
                const newState = store.recordFailure(filePath, msg);
                const attempts = newState.kind === 'poison' ? newState.attempts : 0;
                log.warn(`    failed ${path.basename(filePath)} after ${Date.now() - startedAt}ms (attempt ${attempts}/${MAX_ATTEMPTS}): ${msg}`);
                result.errors.push({
                    file: filePath,
                    error: `Summary generation failed: ${msg}`
                });
            }
        }
        // Bounded-concurrency pool: each worker pulls next file index until queue drained.
        let cursor = 0;
        const queue = toSummarize;
        const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
            while (true) {
                const i = cursor++;
                if (i >= queue.length)
                    return;
                await summarizeOne(queue[i].path);
            }
        });
        await Promise.all(workers);
        const poisonCount = store.countPoison();
        if (poisonCount > 0) {
            log.info(`State: ${poisonCount} file(s) recorded as poison-pill (≥${MAX_ATTEMPTS} attempts).`);
        }
    }
    return result;
}
