import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { dedupAgainstSiblings } from '../src/dedup.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'em-dedup-'));
  delete process.env.EPISODIC_MEMORY_DEDUP;
  delete process.env.EPISODIC_MEMORY_DEDUP_THRESHOLD;
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.EPISODIC_MEMORY_DEDUP;
  delete process.env.EPISODIC_MEMORY_DEDUP_THRESHOLD;
});

describe('dedupAgainstSiblings', () => {
  it('returns original when no siblings exist', async () => {
    const summary = 'Built a new feature using JWT and React Router.';
    const summaryPath = path.join(tmpDir, 'session-a-summary.txt');
    const out = await dedupAgainstSiblings(summary, summaryPath);
    expect(out.deduped).toBe(false);
    expect(out.summary).toBe(summary);
  });

  it('deduplicates near-identical summaries', async () => {
    const text = 'Built JWT authentication for React app with refresh tokens and protected routes. Fixed token expiration bug.';
    fs.writeFileSync(path.join(tmpDir, 'session-prev-summary.txt'), text);

    const summaryPath = path.join(tmpDir, 'session-new-summary.txt');
    const out = await dedupAgainstSiblings(text, summaryPath);

    expect(out.deduped).toBe(true);
    expect(out.summary).toMatch(/Same session as session-prev/);
    expect(out.similarity).toBeGreaterThanOrEqual(0.95);
  }, 30000);

  it('keeps distinct summaries', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'session-prev-summary.txt'),
      'Implemented HID keyboard for ESP32 in C with Bluetooth controller.'
    );

    const summary = 'Refactored Postgres connection pool in Node service; added retry-with-backoff.';
    const summaryPath = path.join(tmpDir, 'session-new-summary.txt');
    const out = await dedupAgainstSiblings(summary, summaryPath);

    expect(out.deduped).toBe(false);
    expect(out.summary).toBe(summary);
  }, 30000);

  it('respects EPISODIC_MEMORY_DEDUP=0', async () => {
    const text = 'Same content';
    fs.writeFileSync(path.join(tmpDir, 'a-summary.txt'), text);

    process.env.EPISODIC_MEMORY_DEDUP = '0';
    const out = await dedupAgainstSiblings(text, path.join(tmpDir, 'b-summary.txt'));
    expect(out.deduped).toBe(false);
  });

  it('skips dedup when previous is itself a pointer', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'a-summary.txt'),
      'Same session as something-else (cosine=0.99). Previous: ...'
    );

    const summary = 'Built a feature.';
    const out = await dedupAgainstSiblings(summary, path.join(tmpDir, 'b-summary.txt'));
    expect(out.deduped).toBe(false);
    expect(out.summary).toBe(summary);
  });
});
