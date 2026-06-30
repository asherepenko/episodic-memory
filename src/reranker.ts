import { AutoModelForSequenceClassification, AutoTokenizer } from '@huggingface/transformers';

/**
 * Optional cross-encoder reranking stage.
 *
 * A bi-encoder (the embedding model) scores query and passage independently;
 * a cross-encoder reads the (query, passage) pair together and is markedly more
 * precise at ordering a candidate set — at the cost of one model forward pass
 * per candidate. So the pipeline is: retrieve a larger pool cheaply with the
 * embedder, then rerank that pool here and keep the top results.
 *
 * Opt-in (EPISODIC_MEMORY_RERANK=1 or --rerank / the MCP `rerank` param) so the
 * extra ~80MB model download and per-query latency are never forced on users
 * who don't want them. Lazy-loaded: nothing is fetched until the first rerank.
 */
const RERANKER_MODEL_ID = process.env.EPISODIC_MEMORY_RERANK_MODEL ?? 'Xenova/bge-reranker-base';
const RERANKER_DTYPE = 'q8';

let loadPromise: Promise<{ model: any; tokenizer: any }> | null = null;

function load(): Promise<{ model: any; tokenizer: any }> {
  if (!loadPromise) {
    loadPromise = (async () => {
      console.error('Loading reranker model (first run may take time)...');
      const [model, tokenizer] = await Promise.all([
        AutoModelForSequenceClassification.from_pretrained(RERANKER_MODEL_ID, {
          dtype: RERANKER_DTYPE,
          progress_callback: () => {},
        }),
        AutoTokenizer.from_pretrained(RERANKER_MODEL_ID),
      ]);
      console.error('Reranker model loaded');
      return { model, tokenizer };
    })().catch(err => {
      // Reset so a transient failure (e.g. offline first run) can retry later.
      loadPromise = null;
      throw err;
    });
  }
  return loadPromise;
}

/**
 * Score each passage's relevance to the query with the cross-encoder. Returns
 * one logit per passage, in input order (higher = more relevant). The query is
 * passed raw — rerankers take the unprefixed query, unlike the E5 embedder.
 */
export async function rerankScores(query: string, passages: string[]): Promise<number[]> {
  if (passages.length === 0) return [];
  const { model, tokenizer } = await load();
  const inputs = tokenizer(
    passages.map(() => query),
    { text_pair: passages, padding: true, truncation: true },
  );
  const { logits } = await model(inputs);
  return Array.from(logits.data as Float32Array, Number);
}

/**
 * Decide whether reranking is on. Explicit per-call flag (CLI `--rerank` / MCP
 * `rerank`) wins; otherwise fall back to the EPISODIC_MEMORY_RERANK env switch.
 */
export function isRerankEnabled(flag: boolean | undefined): boolean {
  if (flag !== undefined) return flag;
  const env = process.env.EPISODIC_MEMORY_RERANK;
  return env === '1' || env === 'true';
}
