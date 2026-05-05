Semantic search over Claude Code conversations. Forked from obra/episodic-memory.

## Quick Start

**Build & Test**
```bash
npm install           # Installs native deps (better-sqlite3); postinstall runs npm rebuild
npm run build         # tsc + esbuild bundle for MCP server; outputs dist/
npm test              # vitest; 30s timeout for embedding tests
npm run test:watch    # Watch mode
```

**Entry points**
- `cli/episodic-memory` (extension-less shim) → `dist/cli/episodic-memory.js` (compiled from `src/cli/episodic-memory.ts`); unified CLI (subcommands: sync, search, show, stats, verify)
- `dist/mcp-server.js` — MCP server (bundled ESM); exposes search_conversations, show_conversation tools
- `cli/mcp-server` (shim) → `dist/cli/mcp-server-wrapper.js` (compiled from `src/cli/mcp-server-wrapper.ts`); logs stderr separately to prevent protocol corruption
- All CLI logic now in TypeScript under `src/cli/` and compiles to `dist/cli/`. The `cli/` directory holds only thin extension-less spawn shims pinned by package.json `bin` entries.
- CLI bins: episodic-memory, episodic-memory-search, episodic-memory-mcp-server, episodic-memory-index

## Project Structure

```
src/
  types.ts              # ConversationExchange, SearchResult, ToolCall, MultiConceptResult
  paths.ts              # All path resolution; getClaudeDir(), getSuperpowersDir(), getIndexDir(), getDbPath()
  db.ts                 # SQLite + sqlite-vec schema; open(), createTables(), searchVectors()
  embeddings.ts         # Transformers embeddings (@huggingface/transformers); uses env EPISODIC_MEMORY_API_*
  embedding-migration.ts # EMBEDDING_VERSION constant + lock + batch migration
  indexer.ts            # Index conversations from .jsonl; parseExchanges(), indexFile(), validateSchema()
  search.ts             # Vector + text search; searchBySimilarity(), searchByText(), searchByConcepts()
  parser.ts             # Parse JSONL + Claude format exchanges; handles markers, sidechains, tool calls
  summarizer.ts         # AI summaries via Claude API; generateSummary() calls Anthropic
  show.ts               # Render conversation exchanges; formatExchange(), formatToolCall()
  verify.ts             # Index health checks; verifyIndex(), repairIndex()
  mcp-server.ts         # MCP server; exposes tools + resources
  constants.ts          # Schema versions, defaults
  version.ts            # GENERATED — do not edit (written by scripts/generate-version.js)
  
  *-cli.ts              # CLI subcommands (sync-cli, search-cli, show-cli, etc.)

dist/
  index.js              # Exports from src/
  mcp-server.js         # Bundled MCP server (esbuild)
  cli/                  # Compiled CLI scripts (from src/cli/*.ts) with shebangs
    episodic-memory.js
    index-conversations.js
    mcp-server-wrapper.js
    search-conversations.js
  *.d.ts                # Type declarations

src/cli/
  episodic-memory.ts        # Main entry; routes to subcommands
  index-conversations.ts    # Indexing CLI
  mcp-server-wrapper.ts     # MCP server wrapper; redirects stderr
  search-conversations.ts   # Search CLI

cli/                    # Extension-less shims for npm bin entries (spawn dist/cli/*.js)
  episodic-memory
  index-conversations
  mcp-server
  search-conversations

scripts/
  bump-version.sh           # version bumper with drift audit
  generate-version.js       # writes src/version.ts from package.json
  fix-cli-shebangs.mjs      # adds shebangs to dist/cli/*.js after tsc

test/
  *.test.ts             # Real SQLite tests; no mocks
  
.claude-plugin/
  plugin.json           # Claude Code plugin metadata
  marketplace.json      # Marketplace config
```

## Key Conventions

### Path Resolution
- **Claude config**: `~/.claude` (or `CLAUDE_CONFIG_DIR`); checks `projects/` + `transcripts/` subdirs
- **Superpowers dir**: `~/.config/superpowers` (or `XDG_CONFIG_HOME/superpowers`, `PERSONAL_SUPERPOWERS_DIR`, `EPISODIC_MEMORY_CONFIG_DIR`)
- **Archive**: `~/.config/superpowers/conversation-archive/` (raw .jsonl copies)
- **Index**: `~/.config/superpowers/conversation-index/` (SQLite db + exclude.txt config)
- **Database**: `~/.config/superpowers/conversation-index/db.sqlite`

### Directory Walking
- Use `fs.readdirSync({withFileTypes: true})` + `Dirent.isDirectory()` only
- Never use `fs.statSync()` — breaks with git worktree symlinks
- Applied in: `paths.ts#findJsonlFiles()`, `sync.ts`, `indexer.ts`

### Test Environment
- Real SQLite only (no mocks); creates temp DB per test
- Use env vars to override paths: `TEST_DB_PATH`, `TEST_ARCHIVE_DIR`, `TEST_PROJECTS_DIR`
- Timeout: 30s (embeddings + indexing slow)

### Embeddings & API
- Local embeddings via `@huggingface/transformers`; no external calls
- Default encoder: `bge-small-en-v1.5` (384-dim) with auto-migration on upgrade
- Optional Anthropic API for summaries: `EPISODIC_MEMORY_API_BASE_URL`, `EPISODIC_MEMORY_API_MODEL`, `ANTHROPIC_API_KEY`
- Fallback: skip summaries if API keys missing

### Distribution & Installation
- `dist/` is committed; pre-built for plugin install without dev deps
- `node_modules/` NOT committed; `package-lock.json` NOT committed (native deps platform-specific)
- Build on install via `postinstall` hook: `npm rebuild better-sqlite3`

### MCP Server Quirks
- Embedding output sent to stderr, not stdout (prevents protocol corruption)
- `dist/cli/mcp-server-wrapper.js` (compiled from `src/cli/mcp-server-wrapper.ts`) redirects stderr separately
- Bundled via esbuild with externals: `fsevents`, `@anthropic-ai/claude-agent-sdk`, `sharp`, `onnxruntime-node`, `better-sqlite3`, `@huggingface/transformers`, `sqlite-vec`

### Database Schema
- SQLite + sqlite-vec extension
- Tables: exchanges, tool_calls, embeddings
- Vectors: 384-dim (bge-small-en-v1.5 default)
- `exchanges.embedding_version` tracks the encoder version per row; bumping `EMBEDDING_VERSION` triggers automatic re-embedding on upgrade
- `tool_calls` has `ON DELETE CASCADE` FK to exchanges
- Verify + repair via `src/verify.ts`

## Conversation Exchange Format

```typescript
interface ConversationExchange {
  id: string;
  project: string;
  timestamp: string;
  userMessage: string;
  assistantMessage: string;
  archivePath: string;
  lineStart: number;
  lineEnd: number;
  
  // Conversation structure (sidechains, parent exchanges)
  parentUuid?: string;
  isSidechain?: boolean;
  
  // Session context
  sessionId?: string;
  cwd?: string;
  gitBranch?: string;
  claudeVersion?: string;
  
  // Thinking metadata
  thinkingLevel?: string;
  thinkingDisabled?: boolean;
  thinkingTriggers?: string; // JSON array
  
  // Tool calls (populated separately)
  toolCalls?: ToolCall[];
}
```

## Common Tasks

**Index conversations**: `episodic-memory sync [--limit N] [--background]`
- Copies .jsonl files from `~/.claude/projects` and `~/.claude/transcripts` to archive
- Parses + indexes into SQLite with vector embeddings
- Supports exclude.txt to skip projects (nested directory matching, see #80)
- Indexes new exchanges appended to previously-indexed transcripts (see #84)

**Search**: `episodic-memory search "query" [--limit N] [--concept "c1" "c2"] [--project P] [--session S] [--git-branch B]`
- Vector similarity search (default; cosine similarity)
- Text search (--text)
- Multi-concept search (--concept)
- Metadata filters: --project, --session-id, --git-branch (see #63)

**Show conversation**: `episodic-memory show <exchange-id>`
- Renders full exchange + metadata

**Verify index**: `episodic-memory verify [--repair]`
- Checks schema, vector dims, tool_call refs
- Repairs broken refs if --repair set

## Key Source Files to Edit

- **Types**: src/types.ts (ConversationExchange, SearchResult)
- **Paths**: src/paths.ts (all directory resolution; safe for testing)
- **Search**: src/search.ts (vector/text/concept search logic)
- **Parser**: src/parser.ts (JSONL parsing; handles sidechains, tool calls)
- **Indexer**: src/indexer.ts (indexing pipeline; schema validation)
- **CLI**: src/*-cli.ts (subcommand entry points)
- **MCP Server**: src/mcp-server.ts (tool definitions + resource handlers)

## Environment Variables

- `CLAUDE_CONFIG_DIR` — Override default `~/.claude` location
- `EPISODIC_MEMORY_CONFIG_DIR` — Override default superpowers dir (testing)
- `EPISODIC_MEMORY_DB_PATH` — Override default DB path (testing)
- `EPISODIC_MEMORY_API_BASE_URL` — Anthropic API base (for summaries)
- `EPISODIC_MEMORY_API_MODEL` — Model for summaries (e.g., claude-opus-4-1)
- `EPISODIC_MEMORY_SUMMARIZER_GUARD` — Set to `1` by `getApiEnv()` to break recursive Claude SDK spawn loops; sync-cli silently exits when seen
- `ANTHROPIC_API_KEY` — For API calls
- `TEST_DB_PATH`, `TEST_ARCHIVE_DIR`, `TEST_PROJECTS_DIR` — Test overrides
- `CONVERSATION_SEARCH_EXCLUDE_PROJECTS` — Comma-separated list of projects to exclude

## Dependencies

- **SQLite**: `better-sqlite3` (sync API), `sqlite-vec` (vector extension)
- **Embeddings**: `@huggingface/transformers` (local, no external calls)
- **MCP**: `@modelcontextprotocol/sdk` (protocol implementation)
- **CLI/API**: `marked` (markdown parsing), `zod` (validation), `@anthropic-ai/claude-agent-sdk` (summarizer)
- **Build**: `typescript`, `esbuild` (bundle for MCP), `vitest` (tests)

## Marketplace Config

- Marketplace name: `asherepenko-claude-marketplace`
- Install: `/plugin marketplace add asherepenko/episodic-memory` then `/plugin install episodic-memory@asherepenko-claude-marketplace`
- Config files: `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`

## Things to be careful with

### The summarizer recursion guard (#87)

`summarizer.ts` calls the Claude Agent SDK's `query()`, which spawns a Claude subprocess that fires `SessionStart` hooks. The plugin's own `SessionStart` hook runs `sync --background`, which calls the summarizer. That loop fans out hundreds of processes within seconds.

The fix:
- `getApiEnv()` always sets `EPISODIC_MEMORY_SUMMARIZER_GUARD=1` in the env it returns to the SDK
- `sync-cli.ts` checks `shouldSkipReentrantSync()` at startup and exits silently when the guard is set

**Anything new that spawns a Claude subprocess via the SDK must inherit this guard.** And nothing should run `sync --background` without checking the guard first. See `test/sync-cli-reentrancy.test.ts`.

### Embedding migration (1.2.0+)

The `exchanges.embedding_version` column tracks which encoder produced each row's vector. New code stamps `EMBEDDING_VERSION` (in `src/embedding-migration.ts`); old rows from earlier installs default to 0. The sync flow re-embeds stale rows in batches behind a lock at `~/.config/superpowers/conversation-index/.embedding-migration.lock`.

If you change anything in the embedding pipeline (model, dtype, prefix, pooling, normalization, truncation), **bump `EMBEDDING_VERSION`**. That triggers automatic re-embedding for everyone on upgrade. Don't change pipeline behavior silently — search results would degrade against indexed vectors from the old pipeline.

### `dist/` is committed

Hand-edits to `dist/` get clobbered by `npm run build`. Always edit `src/`, then build, then commit both together. CI doesn't rebuild for you.

### Test isolation

Tests use `mkdtempSync`, set `TEST_DB_PATH`/`TEST_PROJECTS_DIR`/`EPISODIC_MEMORY_CONFIG_DIR` per-test, and clean up in `afterEach`. Don't reach for the real `~/.config/superpowers/`. The `test-utils.ts` helpers cover the common patterns.

## Version Management

Three files hold the plugin version, all kept in lockstep:

- `package.json`
- `.claude-plugin/plugin.json`
- `.claude-plugin/marketplace.json` (plugins[0].version)

To bump in this repo:

```
./scripts/bump-version.sh X.Y.Z         # updates all three local files
./scripts/bump-version.sh --check       # report current versions
./scripts/bump-version.sh --audit       # scan for stale references
```

The script reads `.version-bump.json` for the file list and audit excludes. The MCP server identity (`version` field in `new Server({...})` in `src/mcp-server.ts`) is derived from `src/version.ts`, which the prebuild script generates from `package.json` — keep that pipeline in place; never hardcode the version.

## Release Process

Follow this every time:

1. **Test:** `npm test` (full suite must pass)
2. **Build:** `npm run build` (committed `dist/` must be fresh)
3. **Bump:** `./scripts/bump-version.sh X.Y.Z` and verify clean audit
4. **Changelog:** add an entry to `CHANGELOG.md`. Write for end users, not engineers — concrete numbers, plain English, active voice. Lead with the user-visible benefit.
5. **Commit and tag:**
   ```
   git commit -m "Release vX.Y.Z: <one-line>"
   git tag -a vX.Y.Z -m "Release vX.Y.Z"
   git push origin main && git push origin vX.Y.Z
   ```
6. **GitHub release:**
   ```
   awk '/^## \[X\.Y\.Z\]/,/^## \[/' CHANGELOG.md | sed '$d' | tail -n +2 > /tmp/notes.md
   gh release create vX.Y.Z --title "vX.Y.Z" --notes-file /tmp/notes.md
   ```
7. **Smoke test from the published release:** clone the new tag into a tmp dir, `npm install && npm run build && npm test`, then run a synthetic sync + search end-to-end. The full suite covers most paths but doesn't exercise first-install model download or MCP boot.
