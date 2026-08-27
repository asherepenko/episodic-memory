/**
 * Plugin-file integrity check and self-repair.
 *
 * Distinct from install-check.js, which heals `node_modules`. This module heals
 * the *plugin's own files*: a `/plugin install` or marketplace sync can leave a
 * version directory half-populated, with `dist/` and `node_modules/` present but
 * `cli/`, `hooks/`, or `.claude-plugin/` never written. The host then either
 * finds no manifest at all or falls back to a sibling config, and the failure
 * surfaces as an opaque `MODULE_NOT_FOUND` behind a 10s MCP connect timeout.
 *
 * Deliberately lives in `cli/` and imports only Node builtins, so it stays
 * loadable in exactly the situation it exists to fix — when `dist/` is one of
 * the things that went missing. Nothing here throws: a repair that cannot run
 * must still let the caller start (or fail with its own clearer error).
 */
import { spawnSync } from 'child_process';
import {
  closeSync,
  cpSync,
  existsSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'fs';
import { tmpdir } from 'os';
import { basename, join, sep } from 'path';

/**
 * Top-level paths every healthy install must contain, regardless of host.
 *
 * Files, not directories, wherever a specific file is what actually gets
 * executed — a present-but-empty `cli/` is the same outage as a missing one.
 * `skills/` and `agents/` are checked as directories because both manifests
 * declare them as directories and their contents vary by version.
 *
 * An array entry means "any one of these satisfies the requirement", and is
 * reported by its first (current) path. Codex's MCP config moved out of the
 * repo root in 1.5.9 — where Claude Code was auto-discovering it as a project
 * server — so an install from an earlier version is complete with the old path
 * and must not be reported as broken.
 */
export const REQUIRED_ENTRIES = [
  'package.json',
  'cli/episodic-memory.mjs',
  'cli/mcp-server.mjs',
  'cli/index-conversations.mjs',
  'cli/search-conversations.mjs',
  'dist/mcp-server.js',
  'dist/install-check.js',
  'dist/cli/episodic-memory.js',
  'dist/cli/mcp-server-wrapper.js',
  'scripts/ensure-deps.mjs',
  '.claude-plugin/plugin.json',
  '.codex-plugin/plugin.json',
  ['.codex-plugin/mcp.json', '.mcp.json'],
  'hooks/hooks.json',
  'hooks/hooks-codex.json',
  'skills',
  'agents',
];

const REPAIR_LOCK = '.episodic-memory-repair.lock';

function isPresent(root, relPath) {
  const target = join(root, relPath);
  if (!existsSync(target)) return false;
  try {
    const stat = statSync(target);
    // An empty directory is as broken as a missing one for `skills/` and
    // `agents/`, which the hosts enumerate at load time; an empty file is as
    // broken as a missing script.
    return stat.isDirectory() ? readdirSync(target).length > 0 : stat.size > 0;
  } catch {
    return false;
  }
}

/**
 * Return the required entries absent from `pluginRoot`. Empty means healthy.
 */
export function findMissingFiles(pluginRoot) {
  return REQUIRED_ENTRIES
    .filter(entry => !alternativesOf(entry).some(path => isPresent(pluginRoot, path)))
    .map(entry => alternativesOf(entry)[0]);
}

/** Normalize a REQUIRED_ENTRIES item to the list of paths that satisfy it. */
function alternativesOf(entry) {
  return Array.isArray(entry) ? entry : [entry];
}

/**
 * Best-effort read of the installed version, tried across the manifests most
 * likely to have survived a partial write. Returns null when none are readable
 * — repair then cannot verify a candidate source and will refuse to copy.
 */
export function readInstalledVersion(pluginRoot) {
  const candidates = [
    'package.json',
    '.claude-plugin/plugin.json',
    '.codex-plugin/plugin.json',
  ];
  for (const rel of candidates) {
    try {
      const parsed = JSON.parse(readFileSync(join(pluginRoot, rel), 'utf-8'));
      if (typeof parsed.version === 'string') return parsed.version;
    } catch {
      // Unreadable or absent — that is the case we are recovering from.
    }
  }
  // The version directory itself is named for the version in both host layouts.
  const dirName = basename(pluginRoot);
  return /^\d+\.\d+\.\d+/.test(dirName) ? dirName : null;
}

function readSourceVersion(candidate) {
  for (const rel of ['package.json', '.claude-plugin/plugin.json']) {
    try {
      const parsed = JSON.parse(readFileSync(join(candidate, rel), 'utf-8'));
      if (typeof parsed.version === 'string') return parsed.version;
    } catch {
      // Try the next manifest.
    }
  }
  return null;
}

/**
 * Locate an on-disk copy of this exact version to repair from, without any
 * network access.
 *
 * Both hosts materialize plugins as
 * `<host>/plugins/cache/<marketplace>/<plugin>/<version>/` and keep the git
 * clone they were built from at `<host>/plugins/marketplaces/<marketplace>/`,
 * so the clone is derivable from the install path alone. A candidate is only
 * accepted when its version matches — repairing 1.5.8 from a 1.5.6 checkout
 * would produce a subtly mixed install, which is worse than failing.
 */
export function findLocalRepairSource(pluginRoot, version) {
  const candidates = [];

  const override = process.env.EPISODIC_MEMORY_REPAIR_SOURCE;
  if (override) candidates.push(override);

  // pluginRoot = .../plugins/cache/<marketplace>/<plugin>/<version>
  const parts = pluginRoot.split(sep);
  const cacheIndex = parts.lastIndexOf('cache');
  if (cacheIndex > 0 && parts.length >= cacheIndex + 3) {
    const pluginsDir = parts.slice(0, cacheIndex).join(sep);
    const marketplace = parts[cacheIndex + 1];
    candidates.push(join(pluginsDir, 'marketplaces', marketplace));
  }

  for (const candidate of candidates) {
    if (!candidate || candidate === pluginRoot) continue;
    if (!existsSync(join(candidate, 'cli', 'mcp-server.mjs'))) continue;
    if (version && readSourceVersion(candidate) !== version) continue;
    return candidate;
  }
  return null;
}

/**
 * Clone this plugin's own repository at the installed version's tag into a temp
 * directory. Only reached when no local copy matches; requires git and network.
 * Returns the temp path (caller must remove it) or null.
 */
function cloneRepairSource(pluginRoot, version) {
  let repository = null;
  for (const rel of ['package.json', '.claude-plugin/plugin.json', '.codex-plugin/plugin.json']) {
    try {
      const parsed = JSON.parse(readFileSync(join(pluginRoot, rel), 'utf-8'));
      const repo = parsed.repository;
      repository = typeof repo === 'string' ? repo : repo?.url ?? null;
      if (repository) break;
    } catch {
      // Try the next manifest.
    }
  }
  if (!repository || !version) return null;

  const temp = mkdtempSync(join(tmpdir(), 'episodic-memory-repair-'));
  const result = spawnSync(
    'git',
    ['clone', '--depth', '1', '--branch', `v${version}`, repository, temp],
    { stdio: ['ignore', 'ignore', 'ignore'], timeout: 120_000 }
  );
  if (result.status === 0 && existsSync(join(temp, 'cli', 'mcp-server.mjs'))) {
    return temp;
  }
  rmSync(temp, { recursive: true, force: true });
  return null;
}

/**
 * Restore missing plugin files in place.
 *
 * Copies are non-destructive (`force: false`): only absent paths are written,
 * so a repair can never clobber a file the user or a newer install put there.
 * Serialized by a lock file so two entry points starting at once — the MCP
 * server and the SessionStart hook — cannot copy over each other.
 *
 * Returns a report; never throws. `dist/` is intentionally repairable from the
 * source tree because it is committed, so no build step is required.
 */
export function repairInstall(pluginRoot, { log = msg => process.stderr.write(msg) } = {}) {
  const missing = findMissingFiles(pluginRoot);
  if (missing.length === 0) {
    return { healthy: true, missing: [], repaired: [], stillMissing: [], source: null };
  }

  const version = readInstalledVersion(pluginRoot);
  log(`episodic-memory: install is missing ${missing.length} required path(s): ${missing.join(', ')}\n`);

  let source = findLocalRepairSource(pluginRoot, version);
  let cloned = null;
  if (!source) {
    log('episodic-memory: no local copy of this version found, cloning from source...\n');
    cloned = cloneRepairSource(pluginRoot, version);
    source = cloned;
  }

  if (!source) {
    log(
      'episodic-memory: could not repair automatically. Reinstall the plugin, ' +
      `or restore the missing paths into "${pluginRoot}".\n`
    );
    return { healthy: false, missing, repaired: [], stillMissing: missing, source: null };
  }

  const lock = acquireRepairLock(pluginRoot);
  const repaired = [];
  try {
    for (const entry of missing) {
      const from = join(source, entry);
      if (!existsSync(from)) continue;
      try {
        cpSync(from, join(pluginRoot, entry), { recursive: true, force: false, errorOnExist: false });
        repaired.push(entry);
      } catch {
        // Read-only install dir or a race with a concurrent repair; the
        // stillMissing report below is what the caller acts on.
      }
    }
  } finally {
    if (lock) releaseRepairLock(lock);
    if (cloned) rmSync(cloned, { recursive: true, force: true });
  }

  const stillMissing = findMissingFiles(pluginRoot);
  if (stillMissing.length === 0) {
    log(`episodic-memory: repaired ${repaired.length} path(s) from ${source}.\n`);
  } else {
    log(
      `episodic-memory: repair incomplete, still missing: ${stillMissing.join(', ')}. ` +
      'Reinstall the plugin to fix.\n'
    );
  }
  return { healthy: stillMissing.length === 0, missing, repaired, stillMissing, source };
}

/**
 * Minimal advisory lock, written with `wx` so creation is atomic. Deliberately
 * not the shared file-lock module: that lives under `dist/`, which is one of
 * the things this file must work without. A failed acquisition is not fatal —
 * copies are non-destructive, so the worst case of a race is duplicated effort.
 */
function acquireRepairLock(pluginRoot) {
  const lockPath = join(pluginRoot, REPAIR_LOCK);
  try {
    closeSync(openSync(lockPath, 'wx'));
    return lockPath;
  } catch {
    return null;
  }
}

function releaseRepairLock(lockPath) {
  try {
    rmSync(lockPath, { force: true });
  } catch {
    // Nothing actionable; a stale lock is cleared by the next successful start.
  }
}
