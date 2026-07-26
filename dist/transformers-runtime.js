import os from 'node:os';
import path from 'node:path';
const INTEL_MAC_TRANSFORMERS = '@huggingface/transformers-darwin-x64';
const CURRENT_TRANSFORMERS = '@huggingface/transformers-darwin-arm64';
/**
 * Intel macOS stays on transformers.js 3 because its ONNX model/runtime pair is
 * known to work there. Apple Silicon and other platforms use the current line.
 */
export function selectTransformersPackage(platform = process.platform, arch = process.arch) {
    return platform === 'darwin' && arch === 'x64'
        ? INTEL_MAC_TRANSFORMERS
        : CURRENT_TRANSFORMERS;
}
export function transformersCacheKey(platform = process.platform, arch = process.arch) {
    return selectTransformersPackage(platform, arch) === INTEL_MAC_TRANSFORMERS
        ? 'transformers-v3'
        : 'transformers-v4';
}
/**
 * Model downloads are a machine-level cache, not index data. In particular,
 * EPISODIC_MEMORY_CONFIG_DIR may point at an ephemeral test or repair index.
 */
export function getTransformersCacheDir() {
    const cacheHome = process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), '.cache');
    return path.join(cacheHome, 'episodic-memory', transformersCacheKey());
}
export async function loadTransformers() {
    return import(selectTransformersPackage());
}
