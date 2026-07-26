import type * as Transformers from '@huggingface/transformers-darwin-arm64';
export type TransformersModule = typeof Transformers;
/**
 * Intel macOS stays on transformers.js 3 because its ONNX model/runtime pair is
 * known to work there. Apple Silicon and other platforms use the current line.
 */
export declare function selectTransformersPackage(platform?: NodeJS.Platform, arch?: NodeJS.Architecture): string;
export declare function transformersCacheKey(platform?: NodeJS.Platform, arch?: NodeJS.Architecture): string;
/**
 * Model downloads are a machine-level cache, not index data. In particular,
 * EPISODIC_MEMORY_CONFIG_DIR may point at an ephemeral test or repair index.
 */
export declare function getTransformersCacheDir(): string;
export declare function loadTransformers(): Promise<TransformersModule>;
