import { pipeline, env } from '@huggingface/transformers';
// Disable progress callbacks to prevent stdout pollution in MCP context
// In MCP, stdout is reserved for JSON-RPC communication.
env.allowLocalModels = true;
env.useBrowserCache = false;
export const BGE_QUERY_PREFIX = 'Represent this sentence for searching relevant passages: ';
export const EMBEDDING_MODELS = {
    'bge-small-en': {
        key: 'bge-small-en',
        modelId: 'Xenova/bge-small-en-v1.5',
        dtype: 'q8',
        dimensions: 384,
        queryPrefix: BGE_QUERY_PREFIX,
        passagePrefix: '',
        version: 1,
    },
    'multilingual-e5-small': {
        key: 'multilingual-e5-small',
        modelId: 'Xenova/multilingual-e5-small',
        dtype: 'q8',
        dimensions: 384,
        queryPrefix: 'query: ',
        passagePrefix: 'passage: ',
        version: 2,
    },
};
// Multilingual by default: embeds non-English conversations (e.g. Ukrainian)
// well, where the English-only bge-small fell down. English-only users who want
// maximum English retrieval quality can set EPISODIC_MEMORY_EMBED_MODEL=bge-small-en.
const DEFAULT_MODEL_KEY = 'multilingual-e5-small';
/**
 * Resolve which registered model to use. Pure for testability: pass the
 * requested key (typically EPISODIC_MEMORY_EMBED_MODEL). An unknown key falls
 * back to the default with a stderr warning rather than failing the process.
 */
export function resolveEmbeddingModel(requestedKey) {
    if (requestedKey) {
        const found = EMBEDDING_MODELS[requestedKey];
        if (found)
            return found;
        console.error(`episodic-memory: unknown EPISODIC_MEMORY_EMBED_MODEL "${requestedKey}"; ` +
            `using "${DEFAULT_MODEL_KEY}". Known models: ${Object.keys(EMBEDDING_MODELS).join(', ')}`);
    }
    return EMBEDDING_MODELS[DEFAULT_MODEL_KEY];
}
/**
 * The active model for this process. Resolved once at module load — the
 * embedding version must be stable for the lifetime of the process, so the
 * model is chosen by the environment at startup, not per call.
 */
const ACTIVE_MODEL = resolveEmbeddingModel(process.env.EPISODIC_MEMORY_EMBED_MODEL);
const MODEL_ID = ACTIVE_MODEL.modelId;
const MODEL_DTYPE = ACTIVE_MODEL.dtype;
/**
 * The active embedding pipeline version, stamped into `exchanges.embedding_version`.
 * Equals the active model's `version`; `embedding-migration.ts` and `db.ts`
 * import it. Switching models (default change or EPISODIC_MEMORY_EMBED_MODEL)
 * changes this, marking old rows stale and triggering re-embedding on upgrade.
 */
export const EMBEDDING_VERSION = ACTIVE_MODEL.version;
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
 * Prepend the active model's query prefix. Idempotent: returns the input
 * unchanged if the prefix is already present (an empty prefix is a no-op).
 */
export function withQueryPrefix(query) {
    const prefix = ACTIVE_MODEL.queryPrefix;
    if (!prefix || query.startsWith(prefix))
        return query;
    return prefix + query;
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
    // Passage prefix is model-specific (empty for BGE, "passage: " for E5).
    return generateEmbedding(ACTIVE_MODEL.passagePrefix + combined);
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
