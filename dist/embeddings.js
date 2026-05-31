import { pipeline, env } from '@huggingface/transformers';
// Disable progress callbacks to prevent stdout pollution in MCP context
// In MCP, stdout is reserved for JSON-RPC communication.
env.allowLocalModels = true;
env.useBrowserCache = false;
/**
 * Embedding model configuration.
 *
 * Using BAAI's bge-small-en-v1.5 (via Xenova's ONNX export) instead of the
 * older all-MiniLM-L6-v2 — measured +6.34 R@1 on a 17K-corpus retrieval test
 * against real production data. Same 384 dimensions, so vec_exchanges schema
 * is unchanged.
 *
 * BGE models recommend prepending a task prefix to QUERY embeddings only
 * (passages/documents go through unmodified). See `withQueryPrefix` and
 * `generateQueryEmbedding` below.
 */
const MODEL_ID = 'Xenova/bge-small-en-v1.5';
const MODEL_DTYPE = 'q8';
export const BGE_QUERY_PREFIX = 'Represent this sentence for searching relevant passages: ';
/**
 * Bump when ANYTHING in the embedding pipeline changes (model, dtype, prefix,
 * pooling, normalization, truncation). This is the single source of truth —
 * `embedding-migration.ts` and `db.ts` import it from here. Bumping triggers
 * automatic re-embedding of stale rows on upgrade (see CLAUDE.md).
 *
 * Co-located with the pipeline it versions so the version and the behavior it
 * describes can never drift into separate files.
 */
export const EMBEDDING_VERSION = 1;
let embeddingPipeline = null;
export async function initEmbeddings() {
    if (!embeddingPipeline) {
        console.error('Loading embedding model (first run may take time)...');
        embeddingPipeline = await pipeline('feature-extraction', MODEL_ID, { dtype: MODEL_DTYPE, progress_callback: () => { } });
        console.error('Embedding model loaded');
    }
}
export async function generateEmbedding(text) {
    if (!embeddingPipeline) {
        await initEmbeddings();
    }
    // Truncate text to avoid token limits (512 tokens max for bge-small).
    // Empirically, retrieval quality is best at the 2000-char truncation limit;
    // longer inputs degrade mean-pooled embeddings.
    const truncated = text.substring(0, 2000);
    const output = await embeddingPipeline(truncated, {
        pooling: 'mean',
        normalize: true,
    });
    return Array.from(output.data);
}
/**
 * Cosine similarity between two embeddings produced by `generateEmbedding`.
 * Both vectors are L2-normalized at extraction time (normalize: true above),
 * so cosine collapses to the dot product — keep this in sync if pooling
 * changes.
 */
export function cosineSimilarity(a, b) {
    if (a.length !== b.length)
        return 0;
    let dot = 0;
    for (let i = 0; i < a.length; i++)
        dot += a[i] * b[i];
    return dot;
}
/**
 * Prepend the BGE retrieval prefix to a query string. Idempotent: returns
 * the input unchanged if the prefix is already present.
 */
export function withQueryPrefix(query) {
    if (query.startsWith(BGE_QUERY_PREFIX))
        return query;
    return BGE_QUERY_PREFIX + query;
}
/**
 * Generate an embedding for a search QUERY. Adds the model-specific prefix
 * before embedding, which gives a small but consistent recall lift on
 * retrieval tasks. Document/passage embeddings (`generateExchangeEmbedding`)
 * stay unmodified — that's the asymmetric pattern BGE models are trained for.
 */
export async function generateQueryEmbedding(query) {
    return generateEmbedding(withQueryPrefix(query));
}
export async function generateExchangeEmbedding(userMessage, assistantMessage, toolNames) {
    // Combine user question, assistant answer, and tools used for better searchability
    let combined = `User: ${userMessage}\n\nAssistant: ${assistantMessage}`;
    if (toolNames && toolNames.length > 0) {
        combined += `\n\nTools: ${toolNames.join(', ')}`;
    }
    return generateEmbedding(combined);
}
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
function distanceToSimilarity(distance) {
    const similarity = 1 - (distance * distance) / 2;
    return Math.max(-1, Math.min(1, similarity));
}
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
export const EMBEDDER = {
    version: EMBEDDING_VERSION,
    generate: generateExchangeEmbedding,
    generateQuery: generateQueryEmbedding,
    distanceToSimilarity,
};
