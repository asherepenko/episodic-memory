import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { findMissingDeps, REQUIRED_PACKAGES, SDK_NATIVE_BINARY_MARKER } from '../src/install-check.js';

// Stage a fake <pluginRoot>/node_modules and assert what findMissingDeps
// reports. The SDK native-binary probe is the reason this exists: `/plugin
// install` lands the SDK package but omits its platform binary package, and
// that gap must be detected so the self-heal install can fix it.
describe('findMissingDeps', () => {
  let pluginRoot: string;
  let nodeModules: string;

  beforeEach(() => {
    pluginRoot = mkdtempSync(join(tmpdir(), 'em-install-check-'));
    nodeModules = join(pluginRoot, 'node_modules');
  });

  afterEach(() => {
    rmSync(pluginRoot, { recursive: true, force: true });
  });

  function stagePackage(name: string) {
    const dir = join(nodeModules, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name }));
  }

  function stageAllRequired() {
    for (const pkg of REQUIRED_PACKAGES) stagePackage(pkg);
  }

  it('reports every required package when node_modules is absent', () => {
    expect(findMissingDeps(pluginRoot)).toEqual(REQUIRED_PACKAGES);
  });

  it('reports nothing on a complete install (incl. SDK platform binary)', () => {
    stageAllRequired();
    stagePackage('@anthropic-ai/claude-agent-sdk-darwin-arm64');
    expect(findMissingDeps(pluginRoot)).toEqual([]);
  });

  it('flags the SDK native binary when the SDK is present but its platform package is not', () => {
    stageAllRequired(); // SDK package present, no claude-agent-sdk-<platform> sibling
    const missing = findMissingDeps(pluginRoot);
    expect(missing).toContain(SDK_NATIVE_BINARY_MARKER);
  });

  it('does not double-report the binary when the SDK package itself is missing', () => {
    // Everything except the SDK package.
    for (const pkg of REQUIRED_PACKAGES.filter(p => p !== '@anthropic-ai/claude-agent-sdk')) {
      stagePackage(pkg);
    }
    const missing = findMissingDeps(pluginRoot);
    expect(missing).toContain('@anthropic-ai/claude-agent-sdk');
    expect(missing).not.toContain(SDK_NATIVE_BINARY_MARKER);
  });

  it('accepts any platform binary variant (e.g. linux musl)', () => {
    stageAllRequired();
    stagePackage('@anthropic-ai/claude-agent-sdk-linux-x64-musl');
    expect(findMissingDeps(pluginRoot)).toEqual([]);
  });
});
