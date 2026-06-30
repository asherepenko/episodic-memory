import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // 30s default for embedding/indexing tests; raise via
    // EPISODIC_MEMORY_TEST_TIMEOUT_MS for cold-cache / first-install runs
    // where model downloads dominate (see test/test-utils.ts#testTimeoutMs).
    testTimeout: Math.max(Number(process.env.EPISODIC_MEMORY_TEST_TIMEOUT_MS) || 0, 30000),
  },
});
