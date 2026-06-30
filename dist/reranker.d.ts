/**
 * Score each passage's relevance to the query with the cross-encoder. Returns
 * one logit per passage, in input order (higher = more relevant). The query is
 * passed raw — rerankers take the unprefixed query, unlike the E5 embedder.
 */
export declare function rerankScores(query: string, passages: string[]): Promise<number[]>;
/**
 * Decide whether reranking is on. Explicit per-call flag (CLI `--rerank` / MCP
 * `rerank`) wins; otherwise fall back to the EPISODIC_MEMORY_RERANK env switch.
 */
export declare function isRerankEnabled(flag: boolean | undefined): boolean;
