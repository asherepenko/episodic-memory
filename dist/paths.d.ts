import fs from 'fs';
/**
 * Get the Claude Code configuration directory.
 * Supports CLAUDE_CONFIG_DIR for multiple profiles.
 * Falls back to ~/.claude when not set.
 */
export declare function getClaudeDir(): string;
/**
 * Get the Codex configuration directory.
 * Supports CODEX_HOME for alternate profiles.
 * Falls back to ~/.codex when not set.
 */
export declare function getCodexDir(): string;
/**
 * Get all directories where supported harnesses store conversation files.
 * Checks Claude Code legacy (projects/) and current (transcripts/) locations,
 * plus Codex sessions.
 * Returns only directories that exist.
 */
export declare function getConversationSourceDirs(): string[];
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
export declare function entryIsDirectory(parent: string, entry: fs.Dirent): boolean;
/**
 * True when a readdir entry is a `.jsonl` file — or a symlink to one. Same
 * symlink caveat as {@link entryIsDirectory}: a symlinked transcript would be
 * missed by a bare `Dirent.isFile()`.
 */
export declare function entryIsJsonlFile(parent: string, entry: fs.Dirent): boolean;
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
export declare function findJsonlFiles(dir: string, excludedDirNames?: ReadonlySet<string>, seen?: Set<string>): string[];
/**
 * Get the personal superpowers directory
 *
 * Precedence:
 * 1. EPISODIC_MEMORY_CONFIG_DIR env var (if set, for testing)
 * 2. PERSONAL_SUPERPOWERS_DIR env var (if set)
 * 3. XDG_CONFIG_HOME/superpowers (if XDG_CONFIG_HOME is set)
 * 4. ~/.config/superpowers (default)
 */
export declare function getSuperpowersDir(): string;
/**
 * Get conversation archive directory
 */
export declare function getArchiveDir(): string;
/**
 * Get conversation index directory
 */
export declare function getIndexDir(): string;
/**
 * Get database path
 */
export declare function getDbPath(): string;
/**
 * Get exclude config path
 */
export declare function getExcludeConfigPath(): string;
/**
 * Get list of projects to exclude from indexing
 * Configurable via env var or config file
 */
export declare function getExcludedProjects(): string[];
