import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { EMBEDDER } from '../src/embeddings.js';

/**
 * Pins the normalize <-> distance->similarity invariant structurally.
 *
 * The Embedder owns model config, normalization, version, AND the
 * distance->cosine formula. This round-trip proves they stay in sync:
 * embed the same text as a passage and as a query, run KNN through real
 * sqlite-vec, and confirm EMBEDDER.distanceToSimilarity(distance) ~= 1.0.
 *
 * Real SQLite + real embeddings, no mocks. Embeddings are slow; tests
 * inherit the 30s suite timeout.
 */
describe('EMBEDDER round-trip', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'episodic-memory-embedder-'));
    mkdirSync(testDir, { recursive: true });
    process.env.EPISODIC_MEMORY_CONFIG_DIR = testDir;
    process.env.EPISODIC_MEMORY_DB_PATH = join(testDir, 'db.sqlite');
  });

  afterEach(() => {
    delete process.env.EPISODIC_MEMORY_CONFIG_DIR;
    delete process.env.EPISODIC_MEMORY_DB_PATH;
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it('exposes version, generate, generateQuery, distanceToSimilarity', () => {
    expect(typeof EMBEDDER.version).toBe('number');
    expect(EMBEDDER.version).toBeGreaterThanOrEqual(1);
    expect(typeof EMBEDDER.generate).toBe('function');
    expect(typeof EMBEDDER.generateQuery).toBe('function');
    expect(typeof EMBEDDER.distanceToSimilarity).toBe('function');
  });

  it('round-trips same text to ~1.0 similarity through real KNN', async () => {
    // Lazy import so the env overrides above are in place before db.ts
    // resolves paths at module init time.
    const { initDatabase } = await import('../src/db.js');

    const text = 'How do I configure the embedding pipeline and version?';

    // Passage embedding (no query prefix) -> stored in the index.
    const passage = await EMBEDDER.generate(text, '');
    expect(passage.length).toBe(384);

    const db = initDatabase();
    try {
      db.prepare(
        `INSERT INTO exchanges (id, project, timestamp, user_message, assistant_message, archive_path, line_start, line_end, embedding_version) VALUES (?, 'p', 't', ?, '', '/x', 1, 2, ?)`
      ).run('rt-1', text, EMBEDDER.version);
      db.prepare('INSERT INTO vec_exchanges (id, embedding) VALUES (?, ?)').run(
        'rt-1',
        Buffer.from(new Float32Array(passage).buffer)
      );

      // Query embedding (with prefix) -> KNN against the stored passage.
      const query = await EMBEDDER.generateQuery(text);
      const row = db
        .prepare(
          `SELECT id, distance FROM vec_exchanges WHERE embedding MATCH ? AND k = 1 ORDER BY distance ASC`
        )
        .get(Buffer.from(new Float32Array(query).buffer)) as { id: string; distance: number };

      expect(row.id).toBe('rt-1');

      const similarity = EMBEDDER.distanceToSimilarity(row.distance);
      // Same text via the asymmetric passage/query pattern should be near 1.0.
      expect(similarity).toBeGreaterThan(0.9);
      expect(similarity).toBeLessThanOrEqual(1);
    } finally {
      db.close();
    }
  });
});
