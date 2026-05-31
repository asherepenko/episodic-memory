/**
 * Reads of `<archive>/<project>/<session>-summary.txt`.
 *
 * The file is pure *derived content*: it holds a real summary or nothing.
 * Error/retry lifecycle is owned entirely by ConversationSyncState (`Poison`),
 * not by any in-file marker.
 */
/**
 * True when the file at `summaryPath` holds a real summary — it exists and is
 * non-empty. Empty files (zero-exchange / metadata-only conversations) return
 * false. Use this for callers that care about "is this conversation summarized
 * and useful" (stats, verify, search).
 */
export declare function hasRealSummary(summaryPath: string): boolean;
