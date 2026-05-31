export declare const BGE_QUERY_PREFIX = "Represent this sentence for searching relevant passages: ";
/**
 * Bump when ANYTHING in the embedding pipeline changes (model, dtype, prefix,
 * pooling, normalization, truncation). This is the single source of truth —
 * `embedding-migration.ts` and `db.ts` import it from here. Bumping triggers
 * automatic re-embedding of stale rows on upgrade (see CLAUDE.md).
 *
 * Co-located with the pipeline it versions so the version and the behavior it
 * describes can never drift into separate files.
 */
export declare const EMBEDDING_VERSION = 1;
export declare function initEmbeddings(): Promise<void>;
export declare function generateEmbedding(text: string): Promise<number[]>;
/**
 * Cosine similarity between two embeddings produced by `generateEmbedding`.
 * Both vectors are L2-normalized at extraction time (normalize: true above),
 * so cosine collapses to the dot product — keep this in sync if pooling
 * changes.
 */
export declare function cosineSimilarity(a: number[], b: number[]): number;
/**
 * Prepend the BGE retrieval prefix to a query string. Idempotent: returns
 * the input unchanged if the prefix is already present.
 */
export declare function withQueryPrefix(query: string): string;
/**
 * Generate an embedding for a search QUERY. Adds the model-specific prefix
 * before embedding, which gives a small but consistent recall lift on
 * retrieval tasks. Document/passage embeddings (`generateExchangeEmbedding`)
 * stay unmodified — that's the asymmetric pattern BGE models are trained for.
 */
export declare function generateQueryEmbedding(query: string): Promise<number[]>;
export declare function generateExchangeEmbedding(userMessage: string, assistantMessage: string, toolNames?: string[]): Promise<number[]>;
/**
 * Convert an L2 (Euclidean) distance between two unit-normalized vectors
 * into a cosine similarity in [-1, 1].
 *
 * For unit vectors u, v:  ||u - v||^2 = 2 - 2 * cos(u, v)
 * Therefore:               cos(u, v) = 1 - d^2 / 2
 *
 * Embeddings produced by this module are L2-normalized at extraction time
 * (`normalize: true` in `generateEmbedding`), so the L2 distance returned by
 * sqlite-vec satisfies the unit-vector identity. Co-located with the
 * normalization it depends on so the invariant is structural: if normalization
 * ever changes here, this formula sits right beside it.
 */
declare function distanceToSimilarity(distance: number): number;
/**
 * The consolidated embedding pipeline. Co-locates model config, normalization,
 * version, and the distance->similarity formula behind one object so the
 * normalize<->cosine invariant is structural rather than spread across files.
 *
 * - `version`              — the embedding pipeline version (EMBEDDING_VERSION)
 * - `generate`             — passage/document embedding (no query prefix)
 * - `generateQuery`        — query embedding (adds the asymmetric BGE prefix)
 * - `distanceToSimilarity` — sqlite-vec L2 distance -> cosine similarity
 */
export declare const EMBEDDER: {
    readonly version: 1;
    readonly generate: typeof generateExchangeEmbedding;
    readonly generateQuery: typeof generateQueryEmbedding;
    readonly distanceToSimilarity: typeof distanceToSimilarity;
};
export {};
