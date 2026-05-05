import fs from 'fs';
/**
 * Persists partial hierarchical-summarization progress so a long conversation
 * that times out mid-pipeline can resume on the next sync run instead of
 * re-doing every chunk (#3).
 *
 * File: <jsonl>-summary.partial.json next to the future -summary.txt.
 * Schema versioned so format changes invalidate stale partials.
 */
const SCHEMA_VERSION = 1;
export function partialPathFor(jsonlPath) {
    return jsonlPath.replace(/\.jsonl$/, '-summary.partial.json');
}
export function loadPartial(partialPath, expectedTotalChunks, expectedExchanges) {
    let raw;
    try {
        raw = fs.readFileSync(partialPath, 'utf-8');
    }
    catch {
        return [];
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        return [];
    }
    if (parsed.version !== SCHEMA_VERSION ||
        parsed.totalChunks !== expectedTotalChunks ||
        parsed.totalExchanges !== expectedExchanges ||
        !Array.isArray(parsed.chunkSummaries) ||
        parsed.chunkSummaries.length > expectedTotalChunks) {
        // Invalidated — conversation grew, schema bumped, or corrupt.
        return [];
    }
    return parsed.chunkSummaries;
}
export function savePartial(partialPath, totalChunks, chunkSummaries, totalExchanges) {
    const state = {
        version: SCHEMA_VERSION,
        totalChunks,
        chunkSummaries,
        totalExchanges,
        lastUpdated: new Date().toISOString(),
    };
    try {
        const tmp = partialPath + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8');
        fs.renameSync(tmp, partialPath);
    }
    catch {
        // ignore — losing partial is non-fatal
    }
}
export function clearPartial(partialPath) {
    try {
        fs.unlinkSync(partialPath);
    }
    catch {
        // ignore
    }
}
