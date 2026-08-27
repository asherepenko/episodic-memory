import { afterEach, describe, expect, it } from 'vitest';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// @ts-expect-error - plain .mjs module, deliberately untyped so it stays
// loadable with only Node builtins when dist/ is missing.
import {
  REQUIRED_ENTRIES,
  findLocalRepairSource,
  findMissingFiles,
  readInstalledVersion,
  repairInstall,
} from '../cli/repair.mjs';

const VERSION = '9.9.9';
const temps: string[] = [];

function makeTemp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

/** A complete, healthy plugin tree — every entry the integrity check requires. */
function makeHealthyPlugin(root: string): string {
  for (const item of REQUIRED_ENTRIES as Array<string | string[]>) {
    // An array entry lists interchangeable paths; seed the first (current) one.
    const entry = Array.isArray(item) ? item[0] : item;
    const target = join(root, entry);
    if (entry.includes('.')) {
      mkdirSync(join(target, '..'), { recursive: true });
      const body = entry.endsWith('.json')
        ? JSON.stringify({ version: VERSION, repository: 'https://example.invalid/repo.git' })
        : `// ${entry}\n`;
      writeFileSync(target, body);
    } else {
      // Directory entries (skills/, agents/) must be non-empty to count as present.
      mkdirSync(target, { recursive: true });
      writeFileSync(join(target, 'placeholder.md'), '# placeholder\n');
    }
  }
  return root;
}

afterEach(() => {
  while (temps.length) {
    rmSync(temps.pop()!, { recursive: true, force: true });
  }
});

describe('plugin install integrity', () => {
  it('reports a complete install as healthy', () => {
    const root = makeHealthyPlugin(makeTemp('em-healthy-'));
    expect(findMissingFiles(root)).toEqual([]);
    expect(repairInstall(root, { log: () => {} }).healthy).toBe(true);
  });

  // The outage this module exists for: a /plugin install that wrote dist/ and
  // node_modules/ but never wrote cli/ or .claude-plugin/. With no manifest,
  // the host fell back to a sibling MCP config whose relative path resolved
  // against `/`, producing `Cannot find module '/cli/mcp-server.mjs'` behind a
  // 10s connect timeout that retried forever.
  it('detects the half-unpacked install that produced the MODULE_NOT_FOUND outage', () => {
    const root = makeHealthyPlugin(makeTemp('em-partial-'));
    rmSync(join(root, 'cli'), { recursive: true, force: true });
    rmSync(join(root, '.claude-plugin'), { recursive: true, force: true });

    const missing = findMissingFiles(root);
    expect(missing).toContain('cli/mcp-server.mjs');
    expect(missing).toContain('.claude-plugin/plugin.json');
  });

  it('treats an empty directory and a zero-byte script as missing', () => {
    const root = makeHealthyPlugin(makeTemp('em-empty-'));
    rmSync(join(root, 'skills'), { recursive: true, force: true });
    mkdirSync(join(root, 'skills'), { recursive: true });
    writeFileSync(join(root, 'cli/mcp-server.mjs'), '');

    const missing = findMissingFiles(root);
    expect(missing).toContain('skills');
    expect(missing).toContain('cli/mcp-server.mjs');
  });

  it('restores every missing path from a matching local source', () => {
    const source = makeHealthyPlugin(makeTemp('em-source-'));
    const root = makeHealthyPlugin(makeTemp('em-broken-'));
    rmSync(join(root, 'cli'), { recursive: true, force: true });
    rmSync(join(root, '.claude-plugin'), { recursive: true, force: true });
    rmSync(join(root, 'hooks'), { recursive: true, force: true });

    process.env.EPISODIC_MEMORY_REPAIR_SOURCE = source;
    try {
      const report = repairInstall(root, { log: () => {} });
      expect(report.healthy).toBe(true);
      expect(report.stillMissing).toEqual([]);
      expect(report.repaired).toContain('cli/mcp-server.mjs');
      expect(findMissingFiles(root)).toEqual([]);
      expect(existsSync(join(root, 'cli/mcp-server.mjs'))).toBe(true);
    } finally {
      delete process.env.EPISODIC_MEMORY_REPAIR_SOURCE;
    }
  });

  it('never overwrites a file that is already present', () => {
    const source = makeHealthyPlugin(makeTemp('em-source-'));
    const root = makeHealthyPlugin(makeTemp('em-broken-'));
    writeFileSync(join(root, 'cli/mcp-server.mjs'), 'LOCAL EDIT\n');
    rmSync(join(root, 'hooks'), { recursive: true, force: true });

    process.env.EPISODIC_MEMORY_REPAIR_SOURCE = source;
    try {
      repairInstall(root, { log: () => {} });
      // hooks/ was restored, but the present-and-non-empty script is untouched.
      expect(existsSync(join(root, 'hooks/hooks.json'))).toBe(true);
    } finally {
      delete process.env.EPISODIC_MEMORY_REPAIR_SOURCE;
    }
  });

  // Repairing 1.5.8 from a 1.5.6 checkout yields a silently mixed install,
  // which is harder to diagnose than an honest failure.
  it('refuses a local source whose version does not match the install', () => {
    const source = makeHealthyPlugin(makeTemp('em-source-'));
    writeFileSync(
      join(source, 'package.json'),
      JSON.stringify({ version: '1.0.0' })
    );
    const root = makeHealthyPlugin(makeTemp('em-broken-'));

    expect(findLocalRepairSource(source, VERSION)).toBeNull();
    expect(readInstalledVersion(root)).toBe(VERSION);
  });

  it('derives the host marketplace clone from the plugin cache path', () => {
    const host = makeTemp('em-host-');
    const pluginRoot = join(host, 'plugins', 'cache', 'my-marketplace', 'episodic-memory', VERSION);
    const clone = join(host, 'plugins', 'marketplaces', 'my-marketplace');
    mkdirSync(pluginRoot, { recursive: true });
    mkdirSync(clone, { recursive: true });
    makeHealthyPlugin(pluginRoot);
    makeHealthyPlugin(clone);
    rmSync(join(pluginRoot, 'cli'), { recursive: true, force: true });

    expect(findLocalRepairSource(pluginRoot, VERSION)).toBe(clone);
  });

  it('falls back to the version directory name when every manifest is unreadable', () => {
    const host = makeTemp('em-host-');
    const pluginRoot = join(host, 'cache', 'mkt', 'episodic-memory', '1.2.3');
    mkdirSync(pluginRoot, { recursive: true });
    expect(readInstalledVersion(pluginRoot)).toBe('1.2.3');
  });

  it('reports honestly when no repair source can be found', () => {
    const root = makeHealthyPlugin(makeTemp('em-orphan-'));
    rmSync(join(root, 'hooks'), { recursive: true, force: true });
    // No manifests left to read a repository from, so the clone path is skipped.
    rmSync(join(root, 'package.json'), { force: true });
    rmSync(join(root, '.claude-plugin'), { recursive: true, force: true });
    rmSync(join(root, '.codex-plugin'), { recursive: true, force: true });

    const report = repairInstall(root, { log: () => {} });
    expect(report.healthy).toBe(false);
    expect(report.source).toBeNull();
    expect(report.stillMissing.length).toBeGreaterThan(0);
  });

  it('lists the real repo as healthy, so REQUIRED_ENTRIES cannot drift', () => {
    const repoRoot = join(import.meta.dirname, '..');
    // dist/ is committed, so a checked-out repo is a valid healthy install.
    expect(findMissingFiles(repoRoot)).toEqual([]);
  });
});
