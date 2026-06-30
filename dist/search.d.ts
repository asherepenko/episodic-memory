import { SearchResult, MultiConceptResult } from './types.js';
export interface SearchOptions {
    limit?: number;
    mode?: 'vector' | 'text' | 'both';
    after?: string;
    before?: string;
    project?: string;
    session_id?: string;
    git_branch?: string;
    /** drop vector matches below this cosine similarity (0-1); text-only matches are kept */
    minScore?: number;
}
/**
 * Convert an L2 (Euclidean) distance from sqlite-vec into a cosine similarity.
 *
 * The math lives in the Embedder (`EMBEDDER.distanceToSimilarity`), co-located
 * with the normalization it depends on. This thin wrapper preserves the
 * historical export name for callers and tests.
 */
export declare function l2DistanceToCosineSimilarity(distance: number): number;
export declare function searchConversations(query: string, options?: SearchOptions): Promise<SearchResult[]>;
/**
 * When a search returns nothing, distinguish "index still building" from a
 * genuine no-match so callers (CLI + MCP) can hint instead of looking broken.
 * Returns undefined when the index has content (a real no-match) or when stats
 * can't be read. An empty index covers both no-DB and freshly-installed states.
 */
export declare function buildEmptyResultHint(): Promise<string | undefined>;
export declare function formatResults(results: Array<SearchResult & {
    summary?: string;
}>): Promise<string>;
export declare function searchMultipleConcepts(concepts: string[], options?: Omit<SearchOptions, 'mode'>): Promise<MultiConceptResult[]>;
export declare function formatMultiConceptResults(results: MultiConceptResult[], concepts: string[]): Promise<string>;
