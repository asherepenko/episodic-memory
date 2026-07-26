import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  getTransformersCacheDir,
  selectTransformersPackage,
  transformersCacheKey,
} from '../src/transformers-runtime.js';

describe('selectTransformersPackage', () => {
  it('uses the Intel-compatible runtime on Intel Macs', () => {
    expect(selectTransformersPackage('darwin', 'x64'))
      .toBe('@huggingface/transformers-darwin-x64');
    expect(transformersCacheKey('darwin', 'x64')).toBe('transformers-v3');
  });

  it('uses the current runtime on Apple Silicon Macs', () => {
    expect(selectTransformersPackage('darwin', 'arm64'))
      .toBe('@huggingface/transformers-darwin-arm64');
    expect(transformersCacheKey('darwin', 'arm64')).toBe('transformers-v4');
  });

  it('uses the current runtime on other supported platforms', () => {
    expect(selectTransformersPackage('linux', 'x64'))
      .toBe('@huggingface/transformers-darwin-arm64');
  });

  it('keeps the model cache stable when the index directory is overridden', () => {
    const configDir = mkdtempSync(path.join(tmpdir(), 'episodic-memory-config-'));
    const previous = process.env.EPISODIC_MEMORY_CONFIG_DIR;
    process.env.EPISODIC_MEMORY_CONFIG_DIR = configDir;
    try {
      expect(getTransformersCacheDir()).not.toContain(configDir);
    } finally {
      if (previous === undefined) delete process.env.EPISODIC_MEMORY_CONFIG_DIR;
      else process.env.EPISODIC_MEMORY_CONFIG_DIR = previous;
      rmSync(configDir, { recursive: true, force: true });
    }
  });
});
