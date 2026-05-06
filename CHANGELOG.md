# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.4] - 2026-05-06

### Security
- **MCP `read` tool now restricted to the archive directory.** The tool previously accepted any filesystem path from the MCP client and read the file directly, which would have let a caller read SSH keys, env files, or anything else the process could see. Paths are now resolved and rejected if they fall outside `~/.config/superpowers/conversation-archive/`.

### Fixed
- **Atomic exchange writes.** `insertExchange` now wraps the exchange row, its vector counterpart, and tool-call rows in a single SQLite transaction. A crash mid-write can no longer leave the vector table out of sync with the main table (the failure mode was an exchange that existed but wasn't searchable, or vice versa).
- **Stale archives on full re-index.** The `--full` indexing path was only copying source `.jsonl` files into the archive when the archive copy didn't exist. Subsequent `show`/MCP `read` calls served outdated content. The full path now uses the same source-vs-archive size+mtime check as the incremental path.
- **Worktree-safe stat calls (round 2).** `search.ts` and `verify.ts` now use `fs.lstatSync` instead of `fs.statSync`, completing the project's symlink-safe convention rollout.

### Performance
- **Faster search rendering on repeated transcripts.** When multiple search results pointed at the same transcript file, each row paid for its own full readline pass to count lines. Result rendering now memoizes line count and file size per archive path within a single render call — no more N×full-file reads when 5 of 10 results come from the same conversation.

## [1.2.3] - 2026-05-06

### Performance
- **Faster sync on large transcripts.** The exclusion-marker check now reads only the first 32 KB of each `.jsonl` instead of the entire file. Multi-MB conversations no longer pay full-read cost on every sync pass.
- **Fewer sidecar reads per sync.** Conversation state is loaded once per file and threaded through the indexing and summary queues; previous code reloaded the same `.sync.json` two or three times per file.
- **Skip redundant archive copies.** `indexer.ts` now compares source vs archive size and mtime before recopying. Idle re-runs no longer rewrite multi-MB transcript copies that haven't changed.
- **Cached API env for long sessions.** `getApiEnv()` memoizes its `process.env` spread keyed on the watched API config vars. Long-tier conversations (10+ chunks) reuse the same allocation across calls.

### Fixed
- **Worktree-safe stat calls.** `dedup.ts` and `sync/sync.ts` now use `fs.lstatSync` instead of `fs.statSync`, matching the project's symlink-safe convention so summary dedup and `copyIfNewer` no longer break on git-worktree symlinks.
- **`HierarchicalSession` now honors `sessionId`.** Long-tier summarization passes `resume: sessionId` to the SDK on the first turn, so the documented `SummarizeOptions.sessionId` option is no longer silently dropped for long conversations.
- **Accurate turn counts after fallback.** `HierarchicalSession.reopen()` (thinking-budget fallback path) preserves `turnsSent` so log lines stay correct across the recycle.

### Changed
- **Single source of truth for cosine similarity.** `cosineSimilarity()` now lives in `src/embeddings.ts` next to `generateEmbedding`. `src/dedup.ts` consumes it. The L2-normalized dot-product invariant is no longer duplicated inline.
- **Single source of truth for poison-state construction.** `buildPoisonState()` in `src/sync/conversation-sync-state.ts` is shared between the filesystem and in-memory store implementations.
- **Single source of truth for summarizer system prompts.** Two named constants (`SUMMARIZER_SYSTEM_PROMPT`, `HIERARCHICAL_SUMMARIZER_SYSTEM_PROMPT`) replace duplicated prompt strings.
- **`store.markStale()` returns the resulting `SyncState`** so callers can use it without a follow-up `load()`.

### Removed
- **Dead `buildSummarizerQueryOptions`.** The function was exported and tested but never called from production code (`callClaude` and `HierarchicalSession.send` inlined a different option set). Its four tests were validating fiction. Both are gone; the real call sites remain unchanged.

### Tests
- 190/190 passing (was 190 in 1.2.2 — net zero after dropping the four dead `buildSummarizerQueryOptions` tests and adding none new for the refactors covered by existing tests).

## [1.2.2] - 2026-05-05

### Merged from upstream (obra/episodic-memory)
- **bge-small-en-v1.5 encoder + auto-migration** (upstream 1.2.0): replaces `all-MiniLM-L6-v2`. Top-1 retrieval accuracy 47% → 53%, top-10 68% → 75%. Existing indexes auto-migrate in batches behind a lock; tunable via `EPISODIC_MEMORY_MIGRATION_BATCH`. New `exchanges.embedding_version` column tracks per-row encoder version. Switches from `@xenova/transformers` to `@huggingface/transformers`. Resolves upstream #82.
- **Search metadata filters** (upstream #63): `--project`, `--session-id`, `--git-branch` flags on CLI and MCP; bound parameters replace string interpolation for time filters.
- **`exclude.txt` nested directory matching** (upstream #80): adding `subagents` now also skips `<project>/<session>/subagents/agent-*.jsonl`.
- **Indexer no longer skips appended exchanges** (upstream #84): `MAX(line_end)` high-water mark replaces `COUNT(*) > 0`, so transcripts that grow after their first index pass pick up their tail.
- **Cosine similarity scores corrected** (upstream #55): `1 - d²/2` for unit-normalized embeddings instead of `1 - row.distance`. Display/aggregation correction; ordering unchanged.
- **`tool_calls` `ON DELETE CASCADE`** (upstream #81): one-time idempotent migration recreates the table with cascade and drops orphaned rows. `index --repair` no longer crashes with `SQLITE_CONSTRAINT_FOREIGNKEY`.
- **Recursive process cascade hotfix** (upstream #87, #88): `EPISODIC_MEMORY_SUMMARIZER_GUARD` env var is set when calling the SDK and inherited by the spawned subprocess; `sync-cli` exits silently when seen, breaking the recursive sync→summarizer→SessionStart loop.
- **Summarizer no longer pollutes `~/.claude/projects/`** (upstream #83): `persistSession: false` passed to the SDK so summarization no longer creates fake session JSONLs.
- **Single source of truth for version numbers** (upstream 1.1.1): `src/version.ts` is generated from `package.json` at prebuild/pretest time; MCP server reports the actual plugin version. Drift test in `test/version-consistency.test.ts`.
- **Windows hook quoting fix** (upstream #75): SessionStart hook command quotes `${CLAUDE_PLUGIN_ROOT}`.
- **`--prefer-offline` removed** from MCP wrapper's `npm install` (upstream #76).
- **API configuration env vars for summarization** (upstream #37): `EPISODIC_MEMORY_API_MODEL`, `EPISODIC_MEMORY_API_MODEL_FALLBACK`, `EPISODIC_MEMORY_API_BASE_URL`, `EPISODIC_MEMORY_API_TOKEN`, `EPISODIC_MEMORY_API_TIMEOUT_MS`.
- **`@anthropic-ai/claude-agent-sdk` bumped to 0.2.x** (transitively requires zod 4).

## [1.2.1] - 2026-05-05

### Fixed
- **MCP server failed to start after 1.1.1**: `.claude-plugin/plugin.json` referenced `cli/mcp-server-wrapper.js`, which was removed during the TS migration (the surviving shim is `cli/mcp-server`, extensionless). The MCP launcher hit ENOENT and the plugin could not connect. Pointed `mcpServers.episodic-memory.args` at the compiled `dist/cli/mcp-server-wrapper.js` directly.

## [1.2.0] - 2026-05-05

### Changed
- **Sync state machine unified into `ConversationSyncState`**: replaces the legacy global `<index>/sync-state.json` (failure tracking) and per-conversation `<conv>-summary.partial.json` (resumable chunks) with a single per-conversation sidecar `<conv>.sync.json` adjacent to the archived `.jsonl`. Sidecars are schema-versioned (`version: 2`), discriminated by `kind`, and written atomically via tmp+rename. Public `syncConversations` API and `SyncResult` shape are unchanged.
- **Sync code colocated under `src/sync/`**: `src/sync.ts` → `src/sync/sync.ts`, plus the new `src/sync/conversation-sync-state.ts` module and an `src/sync/index.ts` barrel re-exporting the public sync API.
- **`-summary.txt` write is now atomic** (tmp+rename) so a crash mid-write no longer leaves a truncated summary that the sidecar could otherwise promote to `complete` on the next run.

### Added
- **`Stale` state for re-summarization**: when `copyIfNewer` overwrites an archived `.jsonl`, the existing sidecar transitions `Complete → Stale`, and the next sync run treats it like a `Pending`/`InProgress` file and re-summarizes. Conversations with a pre-existing stale `-summary.txt` (mtime older than the source jsonl) are also detected on first migration and queued for re-summary instead of being permanently locked into `Complete`. **Heads-up**: on the first sync after upgrade, users with stale summaries on disk may see additional summarizer API calls (and quota burn) until those conversations re-summarize once.
- **In-memory `ConversationSyncStateStore` adapter** (`openMemoryConversationSyncStateStore`) backed by `Map<string, SyncState>`. Same interface as the filesystem adapter, no fs I/O, no migration. Used by unit tests; available for embedders that don't want to touch disk.
- **Lazy migration from legacy artifacts**: on first `load()` for a conversation with no sidecar, the store consults legacy `<conv>-summary.partial.json` (→ `inProgress`), then legacy `<index>/sync-state.json` failures (→ `poison`), then `<conv>-summary.txt` mtime vs source jsonl mtime (→ `complete` or `stale`), and writes a fresh sidecar. Legacy files are not deleted; users may clean them up manually.
- **`EPISODIC_MEMORY_RETRY_ALL` honored at first migration**: when set, legacy global poison entries no longer get baked into a fresh poison sidecar — `load` returns `pending`, and the legacy state remains consultable on the next run.
- **Corrupt or future-version sidecars no longer fall through to migration**: invalid sidecars now return `pending` without re-migrating from legacy artifacts and without overwriting the bad sidecar. Bad sidecar bytes are preserved on disk for diagnostics.
- **`CONTEXT.md`** at the repo root: domain glossary defining `Conversation`, `Exchange`, `Project`, `Summary`, `Dedup pointer`, `SyncState`, `Skipped`, `Archive`, `Index`, `Sidecar`. Used by code review and architecture skills to keep terminology stable across sessions.

### Removed
- `src/sync-state.ts` and `src/partial.ts` deleted; their behavior is now owned by `ConversationSyncState`. Their tests (`test/sync-state.test.ts`, `test/partial.test.ts`) replaced by `test/conversation-sync-state.test.ts` (50 tests covering both filesystem and in-memory adapters, schema validation, lazy migration, RETRY_ALL semantics, atomic writes, and Stale-on-overwrite).

### Tests
- 150/150 passing (was 100 in 1.1.0; was 114 before this refactor).

## [1.1.1] - 2026-05-05

### Changed
- **Migrated all CLI scripts from plain JavaScript to TypeScript**: `cli/*.js` logic moved to `src/cli/*.ts`, compiled into `dist/cli/*.js` by `tsc`. The `cli/` directory now holds only thin extension-less spawn shims pinned by `package.json` `bin` entries. New `scripts/fix-cli-shebangs.mjs` re-prepends `#!/usr/bin/env node` and `chmod +x`s the compiled CLI files (tsc strips shebangs by default). No user-visible behavior change.

## [1.1.0] - 2026-05-05

### Fixed
- **Sync no longer hangs forever during summarization**: `callClaude` now wraps the Claude SDK call in an `AbortController` with a configurable timeout (default 180s, override via `EPISODIC_MEMORY_API_TIMEOUT_MS`). Throws `SummarizerTimeoutError` on hang; sync logs the failure and continues with the next file instead of locking up.

### Added
- **Structured sync log** at `<index-dir>/sync.log` with ISO-timestamped lines for every step (start/end/elapsed/errors, per-chunk progress, SDK stderr at debug level). `sync` command prints the log path on startup; `EPISODIC_MEMORY_DEBUG=1` adds verbose stderr output.
- **Subprocess isolation for summarizer SDK calls**: `settingSources: []`, `mcpServers: {}`, `allowedTools: []`, `disallowedTools: ['*']`, `strictMcpConfig: true` passed to every `query()`. Cuts subprocess cold-start from ~10s to ~2s per call by skipping all user MCP servers and settings.
- **Bounded-concurrency summarization**: parallel summary workers via a fixed-size cursor pool. Default 2; tune with `EPISODIC_MEMORY_CONCURRENCY`.
- **Smart triviality detection** (`detectTrivial`): conversations that are empty, slash-commands-only, ack-only (`yes`/`no`/`ok`/`thanks`/...), under 500 chars on both sides, or with no assistant output return a canned label without calling the SDK at all. Cuts backlog substantially with zero quota burn.
- **Resumable failure state** at `<index-dir>/sync-state.json`: tracks per-file attempt count + last error. After 3 consecutive failures a file is marked poison-pill and silently skipped on subsequent runs to stop wasting subscription quota. Reset with `EPISODIC_MEMORY_RETRY_ALL=1` or by deleting the file.
- **Tiered prompts** by conversation size:
  - `short` (≤3 exchanges, <2000 chars) → one-line label prompt
  - `medium` (≤15) → XML-structured `<summary><changes/><decisions/><blockers/></summary>` schema with three real-world few-shot examples
  - `long` (>15) → hierarchical with shared-rules block and synthesis schema
  Output format is now grep-friendly and decision-focused.
- **Embedding-based dedup** (`src/dedup.ts`): after producing a summary, embedding-cosine compared against the newest existing sibling `*-summary.txt` in the same project. Cosine ≥ 0.95 (configurable via `EPISODIC_MEMORY_DEDUP_THRESHOLD`) replaces the new summary with a `Same session as <prev-id>` pointer. Disable with `EPISODIC_MEMORY_DEDUP=0`. Skips chains of pointers to prevent rot.
- **Resumable hierarchical chunks**: long-conversation chunk summaries persist to `<jsonl>-summary.partial.json` after each chunk. On retry, summarization resumes at the next un-done chunk instead of restarting from chunk 1. Schema-versioned and invalidated on conversation growth or chunk-count change.
- **Single-subprocess hierarchical pipeline** (`HierarchicalSession`): one isolated CLI subprocess kept alive across all chunks + synthesis of one long conversation, fed via `query({ prompt: AsyncIterable<SDKUserMessage> })`. ~50% faster on long conversations by amortizing one cold-start across N+1 turns. Per-turn timeout aborts the entire session on hang.
- **Subprocess stderr capture**: SDK `stderr` callback wired into the structured log at debug level — gives live visibility into MCP/auth/network behavior inside the spawned `claude` subprocess.

### New environment variables
- `EPISODIC_MEMORY_API_TIMEOUT_MS` — per-call SDK timeout in ms (default 180000)
- `EPISODIC_MEMORY_CONCURRENCY` — parallel summary workers (default 2)
- `EPISODIC_MEMORY_RETRY_ALL` — reset poison-pill state on the next run
- `EPISODIC_MEMORY_DEDUP` — set to `0` to disable summary dedup
- `EPISODIC_MEMORY_DEDUP_THRESHOLD` — cosine cutoff (default 0.95)
- `EPISODIC_MEMORY_DEBUG` — verbose stderr debug logs

### Tests
- 26 new tests across `dedup`, `partial`, `summarizer-trivial`, `sync-state`. Total 100/100 passing.

## [1.0.17] - 2026-04-29

### Improved
- **`remembering-conversations` skill**: Improved trigger coverage, body structure, and result-handling guidance
  - Description now covers "familiar error from a past session" as a trigger
  - Added "Using the Results" section: summarize findings, cite sources by project+date, handle empty results gracefully
  - Added query formulation guidance: use specific terms (function names, error messages); multi-concept array search
  - Moved MCP tools reference to `references/mcp-api.md` for progressive disclosure
  - Frontmatter: description converted to double-quoted string, `argument-hint` and `allowed-tools` added
  - Fixed MCP tool name: `__show` → `__read` (correct tool name per API)
  - Fixed `subagent_type`: `"search-conversations"` → `"episodic-memory:search-conversations"`

## [1.0.16] - 2026-04-29

### Fixed
- **Worktree symlinks crash or double-index sync**: All directory walkers (`sync`, `indexer`, `verify`, `index-cli`) now use `readdirSync({ withFileTypes: true })` + `Dirent.isDirectory()` instead of `statSync`
  - `Dirent.isDirectory()` never follows symlinks, so broken worktree symlinks no longer crash background sync silently
  - Valid worktree symlinks (pointing to another project dir) are skipped instead of being indexed twice under a different project name

### Added
- **`--limit <n>` flag for `sync` command**: Control how many summaries are generated per sync run (default: 10)
  - Example: `episodic-memory sync --limit 50`
  - Correctly forwarded when combined with `--background`
---

## Upstream release history (obra/episodic-memory)

The fork-version numbers above (1.1.x, 1.2.x) reuse the same major.minor as upstream but carry different content. Upstream's own release notes are preserved below for reference; their fixes have been merged into this fork as noted in the **1.2.2 — Merged from upstream** section at the top.

## Upstream [1.2.0] - 2026-05-03

### Better search results

This release upgrades the embedding model used for semantic search. On a 17,000-exchange retrieval test built from real production data, the new model puts the right answer at rank 1 about **53% of the time, up from 47%**. Top-10 accuracy improves from 68% to 75%.

The new model is `bge-small-en-v1.5` (BAAI), replacing `all-MiniLM-L6-v2`. Both produce 384-dimensional embeddings, so storage is unchanged.

### Automatic migration

Existing indexes upgrade themselves in the background. After you install 1.2.0, each `episodic-memory sync` re-embeds up to 500 stored exchanges with the new model. Claude Code triggers a sync at every session start, so most indexes finish migrating after roughly 60 sync runs — a few days of normal use.

During sync you'll see a line like this on stderr:

    episodic-memory: re-embedding batch of 500 (29569 stale total)...

Search keeps working throughout. The index holds a mix of old and new embeddings until migration finishes; ranking is slightly noisier but never broken.

To finish faster, run a sync with a larger batch:

    EPISODIC_MEMORY_MIGRATION_BATCH=5000 episodic-memory sync

That takes about a minute per call on a recent Mac.

If two syncs run at once, only one re-embeds; the other skips its migration step. A crash mid-batch leaves the unfinished rows tagged for migration, and the next sync picks up where the previous one stopped.

### Other notes

- **First sync after upgrade** downloads a new 34 MB model file.
- **Rollback to 1.1.x is safe.** Search still works against a partially-migrated index.
- **Resolves #82** (ONNX runtime crash on Node 23 and earlier) as a side effect of the underlying library upgrade.

## Upstream [1.1.2] - 2026-05-03

### Fixed
- **Critical: recursive process explosion from auto-sync** (#87, #88, thanks @kaankoken and @materemias for the diagnosis):
  - The `persistSession: false` fix in 1.1.0 (#83) prevented the SDK-spawned Claude subprocess from *saving* its session JSONL, but did not stop the subprocess from *firing the SessionStart hook*. That re-ran `episodic-memory sync --background`, which re-summarized, which spawned another Claude subprocess, which fired the hook again — fanning out hundreds of detached processes, saturating CPU, and burning API quota.
  - Added a reentrancy guard env var `EPISODIC_MEMORY_SUMMARIZER_GUARD`, set when calling the SDK's `query()` and inherited by the spawned subprocess. The `sync-cli` entry point checks the guard at startup and exits silently when it's set, breaking the recursive cascade at its only feasible point.
  - Coverage: unit tests for `getApiEnv()` (always sets the guard) and `shouldSkipReentrantSync()`, plus an integration test that spawns `dist/sync-cli.js` with the guard env and asserts a clean exit without doing work.
  - Anyone affected by the cascade should update to 1.1.2 immediately. If 1.1.0 or 1.1.1 had been spawning processes, kill any lingering `episodic-memory` and `claude-agent-sdk` children before restarting Claude Code.

## Upstream [1.1.1] - 2026-05-03

### Fixed
- **MCP server now reports the actual plugin version** in its protocol handshake instead of the long-stale hardcoded `1.0.0`. Inspector tools and any client logging the server identity will now see the real version.

### Changed
- **Single source of truth for version numbers.** `package.json` is the source; `src/version.ts` is generated from it at prebuild/pretest time and is referenced by `mcp-server.ts`. Source code can no longer drift from the declared package version.
- **Drift test for manifest files.** A new `test/version-consistency.test.ts` asserts `package.json`, `.claude-plugin/plugin.json`, and `.claude-plugin/marketplace.json` all agree. CI fails if anyone bumps one without the others.
- **`scripts/bump-version.sh` + `.version-bump.json`** for one-command version bumps with built-in audit (greps the repo for stale version strings in undeclared files). Run `./scripts/bump-version.sh X.Y.Z` to update all declared files; `--check` reports current state, `--audit` scans for stragglers.

## Upstream [1.1.0] - 2026-05-02

### Added
- **Search metadata filters** (#63, thanks @jwk2601 for the design): `--project`, `--session-id`, and `--git-branch` flags scope results by exact-match project name, session ID, or git branch. Available on the CLI and the MCP `search` tool. Filter values bind as positional SQL parameters; the existing `--after`/`--before` time filters were converted from string interpolation to bound parameters in the same change.
- **API configuration env vars for summarization** (#37, thanks @techjoec):
  - `EPISODIC_MEMORY_API_MODEL` — override the summarizer model (default: haiku)
  - `EPISODIC_MEMORY_API_MODEL_FALLBACK` — fallback model on errors (default: sonnet)
  - `EPISODIC_MEMORY_API_BASE_URL` — custom Anthropic endpoint
  - `EPISODIC_MEMORY_API_TOKEN` — auth token for custom endpoint
  - `EPISODIC_MEMORY_API_TIMEOUT_MS` — request timeout

### Changed
- **Bumped `@anthropic-ai/claude-agent-sdk` to 0.2.x** (transitively requires zod 4). Required for the `persistSession` option used by the #83 fix.
- **`tool_calls` schema now uses `ON DELETE CASCADE`** (#81). Fresh databases create the table with cascade; existing databases get a one-time migration that recreates `tool_calls` with cascade and drops any orphaned rows. The migration is idempotent and runs only when the schema lacks `ON DELETE CASCADE`.
- **`exclude.txt` matches nested directory names** (#80, thanks @rohitgehe05 for the diagnosis): adding `subagents` now also skips `<project>/<session>/subagents/agent-*.jsonl` instead of only matching top-level project directories.

### Fixed
- **Indexer skipped appended exchanges** (#84, thanks @jamster for the diagnosis and detection script): the `COUNT(*) > 0` skip was replaced with a `MAX(line_end)` high-water mark, so transcripts that grow after their first index pass now pick up their tail. Resumed sessions and SessionStart syncs that race the still-running session no longer silently lose the trailing content.
- **Search similarity scores were wrong** (#55, thanks @gmax111): `1 - row.distance` was treating L2 distance as cosine distance. For unit-normalized embeddings the correct conversion is `1 - d²/2`. Result ordering was already correct (the formula was monotonic in distance), so this is a display/aggregation correction, not a ranking change.
- **Summarizer session pollution** (#83, thanks @benseeley for the detailed reproduction): `persistSession: false` is now passed to the SDK, so summarization no longer creates fake session JSONLs in `~/.claude/projects/<cwd-slug>/`.
- **`deleteExchange` FK crash** (#81, thanks @rohitgehe05): `index --repair` no longer fails with `SQLITE_CONSTRAINT_FOREIGNKEY` on exchanges that have associated tool_calls.
- **Windows hook fails on home directories with spaces** (#75, thanks @phantomsecurityandfire and @officialasishkumar): the SessionStart hook command now quotes `${CLAUDE_PLUGIN_ROOT}`.
- **MCP install fails with `ETARGET` on stale npm cache** (#76, thanks @DarkbyteAT and @mvanhorn): removed `--prefer-offline` from the wrapper's `npm install` invocation.
- **MCP protocol corruption from embedding model output** (#48): the embedding model's stdout is now redirected to stderr.
- **Orphaned MCP processes** (#54): added SIGHUP handler and stdin-close detection to the wrapper.
- **`exclude.txt` ignored at sync time** (#38): now honored by sync and verify commands.
- **Bundled file-discovery and path fixes** (#42, #50, #57, #62, #68, #70, #72): sidechain filtering in search, SessionStart `clear` matcher, `CLAUDE_CONFIG_DIR` support, recursive subagent file discovery, support for both `~/.claude/projects` and `~/.claude/transcripts`, and explicit surfacing of summarization failures.

### Documentation
- Fix npm install instructions to use the GitHub source (#71).

---

## Shared release history (1.0.0 – 1.0.15)

## [1.0.15] - 2025-12-17

### Changed
- **Stop shipping package-lock.json**: Removed from git tracking so npm generates platform-appropriate lockfile on install
- **Remove file deletion from MCP wrapper**: No longer deletes package-lock.json on first run (unnecessary without shipped lockfile)

## [1.0.14] - 2025-12-16

### Fixed
- **Windows spawn ENOENT error**: Add `shell` option for npx commands on Windows (#36, thanks @andrewcchoi!)
  - On Windows, npx is a .cmd file requiring `shell: true` for spawn() to work
  - Applied fix to `cli/episodic-memory.js` and `cli/index-conversations.js`
  - Resolves plugin initialization failures and silent SessionStart hook failures on Windows
- **Agent conversations polluting search index**: Add exclusion marker to summarizer prompts (#15, thanks @one1zero1one!)
  - Summarizer agent conversations are now properly excluded from indexing
  - Extracted marker to shared constant (`SUMMARIZER_CONTEXT_MARKER`) for maintainability
- **Background sync silently failing**: CLI now uses compiled JS instead of tsx at runtime (#25 root cause, thanks @stromseth for identifying!)
  - `--background` flag on sync command now works correctly
  - Fixes SessionStart hook auto-sync that was silently failing
- **Directory auto-creation**: Config directories are now created automatically (inspired by #18, thanks @gingerbeardman!)
  - `getSuperpowersDir()`, `getArchiveDir()`, `getIndexDir()` now ensure directories exist
  - Prevents errors on fresh installs where directories don't exist yet

### Changed
- **CLI uses compiled JavaScript**: Remove tsx from runtime path
  - All CLI commands now route through `dist/*.js` instead of `npx tsx src/*.ts`
  - Faster startup, lighter runtime dependencies
  - tsx is now dev-only (for tests and development)
  - Obsoletes PR #25 (background sync fix) by fixing root cause
- **CLI architecture cleanup**: Replace bash scripts with Node.js wrappers
  - All CLI entry points (`episodic-memory`, `index-conversations`, `search-conversations`, `mcp-server`) are now Node.js scripts
  - Eliminates bash dependency entirely for full cross-platform support (Windows, NixOS, etc.)
  - SessionStart hook now calls `node cli/episodic-memory.js` directly
  - Added `search-conversations.js` to complete Node.js CLI coverage
  - Obsoletes PRs #29 (pnpm workspace), #11 (env bash), and #17 (shebang fix)

## [1.0.13] - 2025-11-22

### Fixed
- **MCP server startup error**: Fix "Invalid or unexpected token" error when starting MCP server
  - Changed plugin.json to use `cli/mcp-server-wrapper.js` instead of bash script `cli/mcp-server`
  - MCP server configuration was pointing to bash script which was being executed with `node` command
  - Wrapper script properly handles Node.js execution and runs bundled `dist/mcp-server.js`

## [1.0.12] - 2025-11-22

### Changed
- **Skill triggering behavior**: Improved episodic memory skill to trigger at appropriate times
  - Changed from "ALWAYS USE THIS SKILL WHEN STARTING ANY KIND OF WORK" to contextual triggers
  - Now triggers when user asks for approach/decision after exploring code
  - Now triggers when stuck on complex problems after investigating
  - Now triggers for unfamiliar workflows or explicit historical references
  - Prevents premature memory searches before understanding current codebase
  - Empirically tested with subagents: 5/5 scenarios passed vs 3/5 with previous description

## [1.0.11] - 2025-11-20

### Fixed
- **Plugin Configuration**: Fix duplicate hooks file error in Claude Code
  - Remove duplicate `"hooks": "./hooks/hooks.json"` reference from plugin.json
  - Claude Code automatically loads hooks/hooks.json, so manifest should only reference additional hook files
  - Update MCP server reference from obsolete `mcp-server-wrapper.js` to direct `mcp-server` script

### Changed
- Simplified plugin.json configuration for cleaner Claude Code integration

## [1.0.10] - 2025-11-20

### Fixed
- **Search result formatting**: Prevent Claude's Read tool 256KB limit failures
  - Search results now include file metadata (size in KB, total line count)
  - Changed from verbose 3-line format to clean 1-line: "Lines 10-25 in /path/file.jsonl (295.7KB, 1247 lines)"
  - Removes prescriptive MCP tool instructions, trusting Claude to choose correct tool based on file size
  - Eliminates issue where episodic memory search triggered built-in Read tool instead of specialized MCP read tool

### Changed
- Enhanced `formatResults()` and `formatMultiConceptResults()` with async file metadata collection
- Added efficient streaming line counting and file size utilities
- Updated MCP server and CLI callers to handle async formatting functions

## [1.0.9] - 2025-10-31

### Removed
- **Dead code cleanup**: Removed obsolete bash script `cli/mcp-server-wrapper`
  - Eliminates duplicate wrapper implementations
  - Only Node.js cross-platform wrapper `mcp-server-wrapper.js` remains
  - Prevents confusion about which wrapper to use
  - Cleaner codebase with single MCP server entry point

### Changed
- Simplified MCP server architecture with single wrapper implementation
- Improved maintainability by removing redundant bash script

## [1.0.8] - 2025-10-31

### Fixed
- **Issue #7**: Fixed Windows support for MCP server provided in plugin
  - Replaced bash script `mcp-server-wrapper` with cross-platform Node.js version
  - MCP server now works on Windows with Claude Code native install
  - Resolves "No such file or directory" errors on Windows when using `/bin/bash`

### Changed
- MCP server wrapper now uses `node cli/mcp-server-wrapper.js` instead of bash script
- Cross-platform dependency installation with proper Windows npm.cmd handling
- Improved signal forwarding and process management in wrapper

### Added
- Cross-platform Node.js wrapper script for MCP server initialization
- Better error handling and messaging for missing dependencies
- Windows-compatible npm command detection (`npm.cmd` vs `npm`)

## [1.0.7] - 2025-10-31

### Fixed
- **Issue #10**: Fixed SessionStart hook configuration that prevented memory sync from running
  - Removed invalid `args` property from hook configuration
  - Added `async: true` and `--background` flag to prevent blocking Claude startup
- **Issue #5**: Fixed summary generation failure during sync command
  - Resolved confusion between archived conversation IDs and active session IDs
  - Sync now properly generates summaries for archived conversations
- **Issue #9**: Fixed better-sqlite3 Node.js version compatibility issues
  - Added postinstall script to automatically rebuild native modules
  - Resolves NODE_MODULE_VERSION mismatch errors on Node.js v25+
- **Issue #8**: Fixed version mismatch between git tags and marketplace.json
  - Synchronized plugin version metadata with release tags

### Added
- Background sync mode with `--background` flag for non-blocking operation
- Automatic native module rebuilding for cross-Node.js version compatibility
- Enhanced CLI help documentation with background mode usage examples

### Changed
- SessionStart hook now uses `episodic-memory sync --background` for instant startup
- Sync command forks to background process when `--background` flag is used
- Improved hook configuration follows Claude Code hook specification exactly
- Updated marketplace.json versions in both embedded and superpowers-marketplace locations

### Security
- Fixed potential process blocking during Claude Code startup
- Improved process detachment for background operations

## [1.0.6] - 2025-10-27

### Fixed
- **Issue #1**: Fixed Windows CLI execution failure by replacing bash scripts with cross-platform Node.js implementation
- **Issue #4**: Fixed sqlite-vec extension loading error on macOS ARM64 and Linux by adding `--external:sqlite-vec` to esbuild configuration
- Resolved "Loadable extension for sqlite-vec not found" error on affected platforms

### Added
- Cross-platform CLI support using Node.js instead of bash scripts
- Enhanced error handling with clear error messages and troubleshooting guidance
- Automatic dependency validation (npx, tsx) in CLI tools
- Proper symlink resolution for npm link and global installations

### Changed
- CLI entry points now use `.js` extension for universal compatibility
- Replaced `shell: true` spawn calls with direct spawn for improved security
- Updated build configuration to externalize sqlite-vec native module
- Improved process execution without shell interpretation to prevent command injection

### Security
- Removed shell dependencies from CLI execution
- Added input validation and protection against command injection vulnerabilities
- Safer process execution using direct spawn calls

## [1.0.5] - 2025-10-25

### Fixed
- MCP server wrapper now deletes package-lock.json before npm install to ensure platform-specific sqlite-vec packages are installed
- Resolves "Loadable extension for sqlite-vec not found" error on fresh plugin installs

### Changed
- Add package-lock.json to .gitignore to prevent cross-platform optional dependency issues
- Improve wrapper script to handle npm's platform-specific optional dependency installation behavior

## [1.0.4] - 2025-10-23

### Changed
- Strengthen agent and MCP tool descriptions to emphasize memory restoration
- Use empowering "this restores it" framing instead of deficit-focused language
- Make it crystal clear the tool provides cross-session memory and should be used before every task

## [1.0.3] - 2025-10-23

### Fixed
- MCP server now automatically installs npm dependencies on first startup via wrapper script
- Resolves "Cannot find module" errors for @modelcontextprotocol/sdk and native dependencies

### Added
- MCP server wrapper script (`cli/mcp-server-wrapper`) that auto-installs dependencies before starting
- esbuild bundling for MCP server to reduce dependency load time

### Changed
- MCP server now uses wrapper script instead of direct node execution
- Removed SessionStart ensure-dependencies hook (no longer needed)

### Removed
- `cli/ensure-dependencies` script (replaced by MCP server wrapper)

## [1.0.2] - 2025-10-23

### Fixed
- Pre-build and commit dist/ directory to avoid MCP server startup errors
- Remove dist/ from .gitignore to ensure built files are available after plugin install

### Changed
- Built JavaScript files now tracked in git for immediate plugin availability

## [1.0.1] - 2025-10-23

### Added
- Automatic dependency installation on plugin install via SessionStart hook
- `ensure-dependencies` script that checks and installs npm dependencies when needed

### Changed
- Plugin installation now automatically runs `npm install` if `node_modules` is missing
- Improved first-time plugin installation experience

### Fixed
- Plugin dependencies not being installed automatically after plugin installation

## [1.0.0] - 2025-10-14

### Added
- Initial release of episodic-memory
- Semantic search for Claude Code conversations
- MCP server integration for Claude Code
- Automatic session-end indexing via plugin hooks
- Multi-concept AND search for finding conversations matching all terms
- Unified CLI with commands: sync, search, show, stats, index
- Support for excluding conversations from indexing via DO NOT INDEX marker
- Comprehensive metadata tracking (session ID, git branch, thinking level, etc.)
- Both vector (semantic) and text (exact match) search modes
- Conversation display with markdown and HTML output formats
- Database verification and repair tools
- Full test suite with 71 tests

### Features
- **Search Modes**: Vector search, text search, or combined
- **Automatic Indexing**: SessionStart hook runs sync automatically
- **Privacy**: Exclude sensitive conversations from search index
- **Offline**: Uses local Transformers.js for embeddings (no API calls)
- **Fast**: SQLite with sqlite-vec for efficient similarity search
- **Rich Metadata**: Tracks project, date, git branch, Claude version, and more

### Components
- Core TypeScript library for indexing and searching
- CLI tools for manual operations
- MCP server for Claude Code integration
- Automatic search agent that triggers on relevant queries
- SessionStart hook for dependency installation and sync
