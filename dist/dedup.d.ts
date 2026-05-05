/**
 * Returns a possibly-rewritten summary. If a near-duplicate sibling exists,
 * returns a short pointer; otherwise returns the original summary.
 */
export declare function dedupAgainstSiblings(summary: string, summaryPath: string): Promise<{
    summary: string;
    deduped: boolean;
    similarity?: number;
}>;
