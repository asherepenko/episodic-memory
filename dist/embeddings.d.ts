/**
 * Embedding model registry.
 *
 * Every registered model is 384-dimensional, so the `vec_exchanges` schema
 * (fixed-width vectors) is valid no matter which one is active — switching
 * models never requires recreating the vector table.
 *
 * Retrieval models use an asymmetric prefix scheme: a QUERY prefix and a
 * PASSAGE prefix, applied at embed time. BGE puts a long instruction on the
 * query and nothing on the passage; E5 puts `query:` / `passage:` on each.
 *
 * `version` is stamped into `exchanges.embedding_version` per row and must be
 * UNIQUE per model so that switching models marks every existing row stale and
 * triggers automatic re-embedding (see `embedding-migration.ts`, CLAUDE.md).
 */
/** transformers.js quantization levels we use for embedding models */
type ModelDtype = 'q8' | 'fp32' | 'fp16' | 'int8' | 'uint8' | 'q4' | 'auto';
export interface EmbeddingModel {
    /** selector key for EPISODIC_MEMORY_EMBED_MODEL */
    key: string;
    /** Xenova/HF model id loaded by transformers.js */
    modelId: string;
    dtype: ModelDtype;
    dimensions: 384;
    queryPrefix: string;
    passagePrefix: string;
    /** stamped into embedding_version; unique per model */
    version: number;
}
export declare const BGE_QUERY_PREFIX = "Represent this sentence for searching relevant passages: ";
export declare const EMBEDDING_MODELS: Record<string, EmbeddingModel>;
/**
 * Resolve which registered model to use. Pure for testability: pass the
 * requested key (typically EPISODIC_MEMORY_EMBED_MODEL). An unknown key falls
 * back to the default with a stderr warning rather than failing the process.
 */
export declare function resolveEmbeddingModel(requestedKey: string | undefined): EmbeddingModel;
/**
 * The active embedding pipeline version, stamped into `exchanges.embedding_version`.
 * Equals the active model's `version`; `embedding-migration.ts` and `db.ts`
 * import it. Switching models (default change or EPISODIC_MEMORY_EMBED_MODEL)
 * changes this, marking old rows stale and triggering re-embedding on upgrade.
 */
export declare const EMBEDDING_VERSION: number;
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
 * Prepend the active model's query prefix. Idempotent: returns the input
 * unchanged if the prefix is already present (an empty prefix is a no-op).
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
    readonly version: number;
    readonly generate: typeof generateExchangeEmbedding;
    readonly generateQuery: typeof generateQueryEmbedding;
    readonly distanceToSimilarity: typeof distanceToSimilarity;
};
export {};
