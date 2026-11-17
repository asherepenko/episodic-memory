import { createHash } from 'crypto';

export interface Summary {
  n: number;
  r5: number;
  r10: number;
  mrr: number;
}

/** 1-based position of the first result from the gold session, or null on a miss. */
export function rankOfGold(sessionIds: Array<string | undefined>, gold: string): number | null {
  const idx = sessionIds.indexOf(gold);
  return idx === -1 ? null : idx + 1;
}

export function summarize(ranks: Array<number | null>): Summary {
  const n = ranks.length;
  if (n === 0) return { n: 0, r5: 0, r10: 0, mrr: 0 };
  const hit = (k: number) => ranks.filter(r => r !== null && r <= k).length / n;
  const mrr = ranks.reduce<number>((sum, r) => sum + (r === null ? 0 : 1 / r), 0) / n;
  return { n, r5: hit(5), r10: hit(10), mrr };
}

/**
 * Fixed dev/held-out split keyed on the question id, so a question never moves
 * between sets. Tune on dev only; read held-out once per change.
 */
export function splitOf(qid: string): 'dev' | 'heldout' {
  const byte = createHash('sha256').update(qid).digest()[0];
  return byte < 77 ? 'dev' : 'heldout';
}
