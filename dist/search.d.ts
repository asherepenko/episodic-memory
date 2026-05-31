import { SearchResult, MultiConceptResult } from './types.js';
export interface SearchOptions {
    limit?: number;
    mode?: 'vector' | 'text' | 'both';
    after?: string;
    before?: string;
    project?: string;
    session_id?: string;
    git_branch?: string;
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
export declare function formatResults(results: Array<SearchResult & {
    summary?: string;
}>): Promise<string>;
export declare function searchMultipleConcepts(concepts: string[], options?: Omit<SearchOptions, 'mode'>): Promise<MultiConceptResult[]>;
export declare function formatMultiConceptResults(results: MultiConceptResult[], concepts: string[]): Promise<string>;
