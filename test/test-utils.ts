import fs from 'fs';
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3';

/**
 * Suppress console output during test execution
 */
export function suppressConsole(): () => void {
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;

  console.log = () => {};
  console.error = () => {};
  console.warn = () => {};

  return () => {
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;
  };
}

/**
 * Create a temporary test database that will be cleaned up automatically
 */
export function createTestDb(): { db: Database.Database; cleanup: () => void } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'episodic-memory-test-'));
  const dbPath = path.join(tmpDir, 'test.db');

  const db = new Database(dbPath);

  const cleanup = () => {
    try {
      db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore cleanup errors
    }
  };

  return { db, cleanup };
}

/**
 * Resolve a per-test timeout (ms), letting CI / first-install runs extend it.
 *
 * Model-backed tests download an encoder on first use, which can blow past a
 * fixed timeout on a cold cache (e.g. the cross-encoder reranker on a fresh
 * clone). Set EPISODIC_MEMORY_TEST_TIMEOUT_MS to raise the ceiling without
 * touching test code. We take the larger of the env value and the per-test
 * fallback so the override can only lengthen a timeout, never shorten one
 * below what the test actually needs.
 */
export function testTimeoutMs(fallback: number): number {
  const override = Number(process.env.EPISODIC_MEMORY_TEST_TIMEOUT_MS);
  return Number.isFinite(override) && override > 0
    ? Math.max(override, fallback)
    : fallback;
}

/**
 * Get path to test fixture file
 */
export function getFixturePath(filename: string): string {
  return path.join(__dirname, 'fixtures', filename);
}

/**
 * Read a test fixture file
 */
export function readFixture(filename: string): string {
  return fs.readFileSync(getFixturePath(filename), 'utf-8');
}

/**
 * Count lines in a file
 */
export function countLines(filePath: string): number {
  const content = fs.readFileSync(filePath, 'utf-8');
  return content.trim().split('\n').length;
}
