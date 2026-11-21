import { SearchResult, ConversationExchange, MultiConceptResult } from './types.js';
export interface SearchOptions {
    limit?: number;
    mode?: 'vector' | 'text' | 'both';
    after?: string;
    before?: string;
    project?: string;
    session_id?: string;
    git_branch?: string;
    /** drop matches below this cosine similarity (0-1); text mode has none, so it is unaffected */
    minScore?: number;
    /** rerank a larger candidate pool with a cross-encoder; undefined → EPISODIC_MEMORY_RERANK env */
    rerank?: boolean;
    /** one result per conversation (its best-ranked exchange); default true */
    collapse?: boolean;
}
/**
 * Convert an L2 (Euclidean) distance from sqlite-vec into a cosine similarity.
 *
 * The math lives in the Embedder (`EMBEDDER.distanceToSimilarity`), co-located
 * with the normalization it depends on. This thin wrapper preserves the
 * historical export name for callers and tests.
 */
export declare function l2DistanceToCosineSimilarity(distance: number): number;
/**
 * Reciprocal Rank Fusion over several ranked row lists (each row has an `id`).
 * A row's fused score is the sum of 1/(k + rank) across the lists it appears
 * in (rank is 1-based), so something ranked highly by *both* vector and text
 * search beats something only one list liked. `k` (default 60, the standard
 * RRF constant) damps the weight of deep ranks. Lists are passed
 * highest-authority first; the first list to contain a row supplies the row
 * object that survives (vector rows carry a real distance for display).
 */
export declare function reciprocalRankFusion<T extends {
    id: string;
}>(lists: T[][], limit: number, k?: number): T[];
/** Same as reciprocalRankFusion, but also returns each survivor's fused score. */
export declare function reciprocalRankFusionScored<T extends {
    id: string;
}>(lists: T[][], limit: number, k?: number): Array<{
    row: T;
    score: number;
}>;
/**
 * Turn a free-text query into an FTS5 MATCH expression: word tokens (letters,
 * digits, `_`), lower-cased, stop words dropped, each quoted so FTS syntax in
 * the query is inert, OR-joined so BM25 ranks partial matches. null when
 * nothing searchable is left.
 */
export declare function buildLexicalQuery(query: string): string | null;
/** A result with a known similarity must reach `minScore`; one without (text mode) passes. */
export declare function passesMinScore(r: {
    similarity?: number;
}, minScore: number): boolean;
/** Keep the first (best-ranked) result of each conversation, in order. */
export declare function collapseBySession<T extends {
    exchange: ConversationExchange;
}>(results: T[]): T[];
/** One-line note for output when this process fell back to keyword search. */
export declare function embeddingFallbackNote(): string | undefined;
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
