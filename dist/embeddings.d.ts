export declare const BGE_QUERY_PREFIX = "Represent this sentence for searching relevant passages: ";
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
