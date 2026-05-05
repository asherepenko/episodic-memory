import fs from 'fs';
import path from 'path';
import { generateEmbedding, cosineSimilarity } from './embeddings.js';

/**
 * Lightweight summary deduplication (#8).
 *
 * After producing a summary for project P, compare its embedding to the most
 * recent existing -summary.txt sibling in the same project directory. If
 * cosine similarity ≥ DEDUP_THRESHOLD, replace the new summary with a short
 * "duplicate of" pointer so the index does not bloat with repeated sessions
 * (e.g. multiple "fix typo" or "rebuild project" sessions in a row).
 *
 * Tunable via env:
 *   EPISODIC_MEMORY_DEDUP=0  → disable
 *   EPISODIC_MEMORY_DEDUP_THRESHOLD=0.95  → similarity cutoff (default 0.95)
 */

const DEFAULT_THRESHOLD = 0.95;

function getThreshold(): number {
  const raw = process.env.EPISODIC_MEMORY_DEDUP_THRESHOLD;
  const parsed = raw ? parseFloat(raw) : NaN;
  if (Number.isFinite(parsed) && parsed > 0 && parsed <= 1) return parsed;
  return DEFAULT_THRESHOLD;
}

function isEnabled(): boolean {
  return process.env.EPISODIC_MEMORY_DEDUP !== '0';
}

/**
 * Find the newest *-summary.txt in the same directory other than `selfPath`.
 * Returns null if none.
 */
function findNewestSibling(projectDir: string, selfPath: string): string | null {
  let entries: string[];
  try {
    entries = fs.readdirSync(projectDir);
  } catch {
    return null;
  }

  const selfBase = path.basename(selfPath);
  let newest: { p: string; mtime: number } | null = null;
  for (const name of entries) {
    if (!name.endsWith('-summary.txt') || name === selfBase) continue;
    const full = path.join(projectDir, name);
    try {
      const stat = fs.lstatSync(full);
      if (!newest || stat.mtimeMs > newest.mtime) {
        newest = { p: full, mtime: stat.mtimeMs };
      }
    } catch {
      // skip unreadable
    }
  }
  return newest?.p ?? null;
}

/**
 * Returns a possibly-rewritten summary. If a near-duplicate sibling exists,
 * returns a short pointer; otherwise returns the original summary.
 */
export async function dedupAgainstSiblings(
  summary: string,
  summaryPath: string
): Promise<{ summary: string; deduped: boolean; similarity?: number }> {
  if (!isEnabled() || summary.length < 40) {
    return { summary, deduped: false };
  }

  const projectDir = path.dirname(summaryPath);
  const sibling = findNewestSibling(projectDir, summaryPath);
  if (!sibling) return { summary, deduped: false };

  let prev: string;
  try {
    prev = fs.readFileSync(sibling, 'utf-8');
  } catch {
    return { summary, deduped: false };
  }

  // Skip dedup if previous was itself a "duplicate of" pointer or trivial.
  if (prev.startsWith('Same session as ') || prev.startsWith('Trivial conversation')) {
    return { summary, deduped: false };
  }

  const [a, b] = await Promise.all([generateEmbedding(summary), generateEmbedding(prev)]);
  const sim = cosineSimilarity(a, b);
  const threshold = getThreshold();

  if (sim >= threshold) {
    const ref = path.basename(sibling).replace(/-summary\.txt$/, '');
    return {
      summary: `Same session as ${ref} (cosine=${sim.toFixed(3)}). Previous: ${prev.split('\n')[0].slice(0, 200)}`,
      deduped: true,
      similarity: sim,
    };
  }

  return { summary, deduped: false, similarity: sim };
}
