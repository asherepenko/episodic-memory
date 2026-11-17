/**
 * Retrieval eval: runs a question set through searchConversations and prints
 * R@5 / R@10 / MRR per split (dev, held-out) and per question kind.
 *
 *   EPISODIC_MEMORY_DB_PATH=/copy/of/db.sqlite \
 *   npx tsx scripts/eval-search/run.ts --questions .eval/questions.local.jsonl \
 *     --label baseline --ranks-out .eval/baseline.jsonl [--compare .eval/other.jsonl] \
 *     [--options '{"rerank":false}']
 *
 * Point EPISODIC_MEMORY_DB_PATH at a copy of the index, never the live one:
 * opening a database runs schema migrations.
 */
import fs from 'fs';
import { searchConversations, SearchOptions } from '../../src/search.js';
import { rankOfGold, summarize, splitOf, Summary } from './metrics.js';

interface Question {
  qid: string;
  kind: string;
  query: string;
  gold_session: string;
}

interface RankRow {
  qid: string;
  kind: string;
  split: 'dev' | 'heldout';
  rank: number | null;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

function fmt(s: Summary): string {
  const p = (x: number) => (x * 100).toFixed(1).padStart(5);
  return `n=${String(s.n).padStart(3)}  R@5 ${p(s.r5)}  R@10 ${p(s.r10)}  MRR ${s.mrr.toFixed(3)}`;
}

export async function evaluate(questions: Question[], options: SearchOptions): Promise<RankRow[]> {
  const rows: RankRow[] = [];
  for (const q of questions) {
    const results = await searchConversations(q.query, { limit: 10, ...options });
    rows.push({
      qid: q.qid,
      kind: q.kind,
      split: splitOf(q.qid),
      rank: rankOfGold(results.map(r => r.exchange.sessionId), q.gold_session),
    });
  }
  return rows;
}

export function report(label: string, rows: RankRow[]): string {
  const lines = [`== ${label} ==`];
  for (const split of ['dev', 'heldout'] as const) {
    const inSplit = rows.filter(r => r.split === split);
    lines.push(`${split.padEnd(8)} all         ${fmt(summarize(inSplit.map(r => r.rank)))}`);
    for (const kind of [...new Set(rows.map(r => r.kind))].sort()) {
      const sub = inSplit.filter(r => r.kind === kind);
      lines.push(`${split.padEnd(8)} ${kind.padEnd(11)} ${fmt(summarize(sub.map(r => r.rank)))}`);
    }
  }
  return lines.join('\n');
}

/** Paired comparison: per held-out question, did this run rank the gold higher or lower? */
export function compare(rows: RankRow[], base: RankRow[]): string {
  const baseBy = new Map(base.map(r => [r.qid, r.rank]));
  const score = (r: number | null) => (r === null ? 0 : 1 / r);
  const out: string[] = [];
  for (const split of ['dev', 'heldout'] as const) {
    let wins = 0, losses = 0;
    for (const r of rows.filter(x => x.split === split)) {
      if (!baseBy.has(r.qid)) continue;
      const d = score(r.rank) - score(baseBy.get(r.qid) ?? null);
      if (d > 0) wins++;
      else if (d < 0) losses++;
    }
    out.push(`${split}: ${wins} better, ${losses} worse vs the --compare run`);
  }
  return out.join('\n');
}

async function main(): Promise<void> {
  const qPath = arg('questions') ?? '.eval/questions.local.jsonl';
  const label = arg('label') ?? 'run';
  const options = JSON.parse(arg('options') ?? '{}') as SearchOptions;
  const questions = fs.readFileSync(qPath, 'utf-8').split('\n').filter(Boolean).map(l => JSON.parse(l) as Question);
  const rows = await evaluate(questions, options);
  console.log(report(label, rows));
  const ranksOut = arg('ranks-out');
  if (ranksOut) fs.writeFileSync(ranksOut, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  const cmp = arg('compare');
  if (cmp) {
    const base = fs.readFileSync(cmp, 'utf-8').split('\n').filter(Boolean).map(l => JSON.parse(l) as RankRow);
    console.log(compare(rows, base));
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!)) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
