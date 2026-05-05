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
  embeddings.ts         # Transformers.js embeddings; uses env EPISODIC_MEMORY_API_*
  indexer.ts            # Index conversations from .jsonl; parseExchanges(), indexFile(), validateSchema()
  search.ts             # Vector + text search; searchBySimilarity(), searchByText(), searchByConcepts()
  parser.ts             # Parse JSONL + Claude format exchanges; handles markers, sidechains, tool calls
  summarizer.ts         # AI summaries via Claude API; generateSummary() calls Anthropic
  show.ts               # Render conversation exchanges; formatExchange(), formatToolCall()
  verify.ts             # Index health checks; verifyIndex(), repairIndex()
  mcp-server.ts         # MCP server; exposes tools + resources
  constants.ts          # Schema versions, defaults
  
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
- Local embeddings via `@xenova/transformers` (Transformers.js); no external calls
- Optional Anthropic API for summaries: `EPISODIC_MEMORY_API_BASE_URL`, `EPISODIC_MEMORY_API_MODEL`, `ANTHROPIC_API_KEY`
- Fallback: skip summaries if API keys missing

### Distribution & Installation
- `dist/` is committed; pre-built for plugin install without dev deps
- `node_modules/` NOT committed; `package-lock.json` NOT committed (native deps platform-specific)
- Build on install via `postinstall` hook: `npm rebuild better-sqlite3`

### MCP Server Quirks
- Embedding output sent to stderr, not stdout (prevents protocol corruption)
- `dist/cli/mcp-server-wrapper.js` (compiled from `src/cli/mcp-server-wrapper.ts`) redirects stderr separately
- Bundled via esbuild with externals: `fsevents`, `@anthropic-ai/claude-agent-sdk`, `sharp`, `onnxruntime-node`, `better-sqlite3`, `@xenova/transformers`, `sqlite-vec`

### Database Schema
- SQLite + sqlite-vec extension
- Tables: exchanges, tool_calls, embeddings
- Vectors: 384-dim (Transformers.js Xenova embeddings default)
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
- Supports exclude.txt to skip projects

**Search**: `episodic-memory search "query" [--limit N] [--concept "c1" "c2"]`
- Vector similarity search (default)
- Text search (--text)
- Multi-concept search (--concept)

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
- `ANTHROPIC_API_KEY` — For API calls
- `TEST_DB_PATH`, `TEST_ARCHIVE_DIR`, `TEST_PROJECTS_DIR` — Test overrides
- `CONVERSATION_SEARCH_EXCLUDE_PROJECTS` — Comma-separated list of projects to exclude

## Dependencies

- **SQLite**: `better-sqlite3` (sync API), `sqlite-vec` (vector extension)
- **Embeddings**: `@xenova/transformers` (local, no external calls)
- **MCP**: `@modelcontextprotocol/sdk` (protocol implementation)
- **CLI/API**: `marked` (markdown parsing), `zod` (validation)
- **Build**: `typescript`, `esbuild` (bundle for MCP), `vitest` (tests)

## Marketplace Config

- Marketplace name: `asherepenko-claude-marketplace`
- Install: `/plugin marketplace add asherepenko/episodic-memory` then `/plugin install episodic-memory@asherepenko-claude-marketplace`
- Config files: `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`
