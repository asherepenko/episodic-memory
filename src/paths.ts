import os from 'os';
import path from 'path';
import fs from 'fs';

/**
 * Ensure a directory exists, creating it if necessary
 */
function ensureDir(dir: string): string {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Get the Claude Code configuration directory.
 * Supports CLAUDE_CONFIG_DIR for multiple profiles.
 * Falls back to ~/.claude when not set.
 */
export function getClaudeDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

/**
 * Get the Codex configuration directory.
 * Supports CODEX_HOME for alternate profiles.
 * Falls back to ~/.codex when not set.
 */
export function getCodexDir(): string {
  return process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
}

/**
 * Get all directories where supported harnesses store conversation files.
 * Checks Claude Code legacy (projects/) and current (transcripts/) locations,
 * plus Codex sessions.
 * Returns only directories that exist.
 */
export function getConversationSourceDirs(): string[] {
  const testDir = process.env.TEST_PROJECTS_DIR;
  if (testDir) return [testDir];

  const claudeDir = getClaudeDir();
  const codexDir = getCodexDir();
  return [
    path.join(claudeDir, 'projects'),
    path.join(claudeDir, 'transcripts'),
    path.join(codexDir, 'sessions'),
  ].filter(d => fs.existsSync(d));
}

/**
 * True when a readdir entry is — or points to — a directory.
 *
 * `Dirent.isDirectory()` is false for a symlink even when it targets a
 * directory, so a plain check silently skips symlinked project dirs. That's
 * common when `~/.claude/projects` (or the archive) is symlinked into a
 * dotfiles repo. We resolve the link with a guarded `statSync` (follows the
 * link); a broken or cyclic link throws and is treated as "not a directory"
 * rather than crashing the walk.
 */
export function entryIsDirectory(parent: string, entry: fs.Dirent): boolean {
  if (entry.isDirectory()) return true;
  if (!entry.isSymbolicLink()) return false;
  try {
    return fs.statSync(path.join(parent, entry.name)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * True when a readdir entry is a `.jsonl` file — or a symlink to one. Same
 * symlink caveat as {@link entryIsDirectory}: a symlinked transcript would be
 * missed by a bare `Dirent.isFile()`.
 */
export function entryIsJsonlFile(parent: string, entry: fs.Dirent): boolean {
  if (!entry.name.endsWith('.jsonl')) return false;
  if (entry.isFile()) return true;
  if (!entry.isSymbolicLink()) return false;
  try {
    return fs.statSync(path.join(parent, entry.name)).isFile();
  } catch {
    return false;
  }
}

/**
 * Recursively find all .jsonl files under a directory.
 * Returns paths relative to the given directory.
 *
 * `excludedDirNames` skips any subdirectory whose name matches an entry in
 * the set, at any depth. Top-level project skipping at the caller is the
 * usual case; this parameter handles nested directories like `subagents/`
 * inside session UUIDs (#80).
 *
 * Symlinked files and directories are followed (see entryIsDirectory /
 * entryIsJsonlFile). A `seen` set of resolved real paths guards against
 * symlink cycles causing infinite recursion.
 */
export function findJsonlFiles(
  dir: string,
  excludedDirNames?: ReadonlySet<string>,
  seen?: Set<string>
): string[] {
  const results: string[] = [];
  const visited = seen ?? new Set<string>();
  // Resolve the real path so a symlink cycle (a → b → a) can't recurse forever.
  let real: string;
  try {
    real = fs.realpathSync(dir);
  } catch {
    return results;
  }
  if (visited.has(real)) return results;
  visited.add(real);
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entryIsJsonlFile(dir, entry)) {
        results.push(entry.name);
      } else if (entryIsDirectory(dir, entry)) {
        if (excludedDirNames?.has(entry.name)) continue;
        const subDir = path.join(dir, entry.name);
        for (const f of findJsonlFiles(subDir, excludedDirNames, visited)) {
          results.push(path.join(entry.name, f));
        }
      }
    }
  } catch {
    // Directory might not be readable
  }
  return results;
}

/**
 * Get the personal superpowers directory
 *
 * Precedence:
 * 1. EPISODIC_MEMORY_CONFIG_DIR env var (if set, for testing)
 * 2. PERSONAL_SUPERPOWERS_DIR env var (if set)
 * 3. XDG_CONFIG_HOME/superpowers (if XDG_CONFIG_HOME is set)
 * 4. ~/.config/superpowers (default)
 */
export function getSuperpowersDir(): string {
  let dir: string;

  if (process.env.EPISODIC_MEMORY_CONFIG_DIR) {
    dir = process.env.EPISODIC_MEMORY_CONFIG_DIR;
  } else if (process.env.PERSONAL_SUPERPOWERS_DIR) {
    dir = process.env.PERSONAL_SUPERPOWERS_DIR;
  } else {
    const xdgConfigHome = process.env.XDG_CONFIG_HOME;
    if (xdgConfigHome) {
      dir = path.join(xdgConfigHome, 'superpowers');
    } else {
      dir = path.join(os.homedir(), '.config', 'superpowers');
    }
  }

  return ensureDir(dir);
}

/**
 * Get conversation archive directory
 */
export function getArchiveDir(): string {
  // Allow test override
  if (process.env.TEST_ARCHIVE_DIR) {
    return ensureDir(process.env.TEST_ARCHIVE_DIR);
  }

  return ensureDir(path.join(getSuperpowersDir(), 'conversation-archive'));
}

/**
 * Get conversation index directory
 */
export function getIndexDir(): string {
  return ensureDir(path.join(getSuperpowersDir(), 'conversation-index'));
}

/**
 * Get database path
 */
export function getDbPath(): string {
  // Allow test override with direct DB path
  if (process.env.EPISODIC_MEMORY_DB_PATH || process.env.TEST_DB_PATH) {
    return process.env.EPISODIC_MEMORY_DB_PATH || process.env.TEST_DB_PATH!;
  }

  return path.join(getIndexDir(), 'db.sqlite');
}

/**
 * Get exclude config path
 */
export function getExcludeConfigPath(): string {
  return path.join(getIndexDir(), 'exclude.txt');
}

/**
 * Get list of projects to exclude from indexing
 * Configurable via env var or config file
 */
export function getExcludedProjects(): string[] {
  // Check env variable first
  if (process.env.CONVERSATION_SEARCH_EXCLUDE_PROJECTS) {
    return process.env.CONVERSATION_SEARCH_EXCLUDE_PROJECTS.split(',').map(p => p.trim());
  }

  // Check for config file
  const configPath = getExcludeConfigPath();
  if (fs.existsSync(configPath)) {
    const content = fs.readFileSync(configPath, 'utf-8');
    return content.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#'));
  }

  // Default: no exclusions
  return [];
}
