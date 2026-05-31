# episodic-memory — Domain Glossary

Use these terms exactly. Drift to "session", "record", "file", "service", "boundary" makes seam placement fuzzy.

## Conversation

A single Claude Code chat exchange stream, persisted by Claude Code as one `.jsonl` file. The unit of input to indexing and summarization. Identified by a session UUID embedded in the filename.

_Avoid_: "session" (overloaded with HTTP/auth sessions), "transcript" (Claude Code's source dir, not a domain noun), "chat".

Relationships: a Conversation **belongs to** exactly one Project. A Conversation has many **Exchanges**.

## Exchange

One `(userMessage, assistantMessage)` pair extracted from a Conversation, plus metadata (sidechain, parent uuid, tool calls, thinking flags). The unit of search and embedding. See `src/types.ts#ConversationExchange`.

_Avoid_: "message", "turn" (ambiguous with sub-message turns inside thinking blocks).

Relationships: an Exchange **belongs to** exactly one Conversation. An Exchange has zero or more **ToolCalls**.

## Project

The top-level directory under `~/.claude/projects/` (or `transcripts/`). Groups conversations by working directory. Used to scope search and exclusion.

_Avoid_: "workspace", "repo".

## Summary

A single rendered text artifact at `<conv>-summary.txt` next to the Conversation's archived `.jsonl`. Produced by hierarchical summarization of all Exchanges. May be replaced by a **Dedup pointer** when near-identical to a sibling summary.

Pure **derived content**: the file holds a real summary or is absent. It carries no lifecycle, error, or retry signal — that is owned entirely by **SyncState** (`Poison` for failures). Readers treat its presence as "summarized", its absence as "not yet"; there is no in-file error marker.

_Avoid_: "abstract", "digest". Do not treat the file as a state marker — the `-summary.txt` sentinel (`__ERRORED__`) was retired; SyncState is the sole authority.

## Dedup pointer

The summary content `Same session as <ref> (cosine=...)` written when a fresh summary's embedding has cosine ≥ threshold against the newest sibling `-summary.txt`. Output of `dedupAgainstSiblings`. **Lifecycle-neutral** — a Conversation in `Complete` state may carry either a real summary or a Dedup pointer; the SyncState machine does not distinguish them.

_Avoid_: treating dedup as a state — it is a content transform applied to a `Complete` summary.

## Codex summarizer

The Codex-native path for producing a **Summary** of a Codex-originated Conversation. Lives in `src/codex-summarizer.ts` and speaks the Codex `app-server` JSON-RPC protocol: it forks the recorded session ephemerally (`thread/fork`, read-only sandbox), runs one summarization turn (`turn/start`), and returns the agent message text. Exposed to the summarization domain through the deep entry point `runCodexSummary(sessionId, prompt, model?, codexBin?)` — a session-in / text-out interface that hides the transport plumbing (`runCodexCommand`, `buildCodexSummarizerCommand`, version-floor check, turn lifecycle). `summarizer.ts` owns only the **Codex→Claude fallback** decision: try the Codex summarizer when the Conversation's harness is `codex`, otherwise (or on any failure) fall back to the Claude SDK tiers.

_Avoid_: "Codex client", "Codex adapter" — the term names the summarization path, not a generic API wrapper.

## SyncState

The lifecycle of a single Conversation through the sync pipeline. Persisted as a per-conversation sidecar `<conv>.sync.json` next to the archived `.jsonl`. Owned by the `ConversationSyncState` module.

States:

- **Pending** — Conversation archived but not yet summarized.
- **InProgress** — Hierarchical summarization started; partial chunk summaries persisted, resumable on next run.
- **Complete** — `<conv>-summary.txt` written.
- **Stale** — Source `.jsonl` overwritten by a newer copy; existing summary is out of date and will be re-summarized.
- **Poison** — Summarization has failed `MAX_ATTEMPTS` times; further runs skip this Conversation until `EPISODIC_MEMORY_RETRY_ALL=1`.

Transitions:

- `Pending → InProgress` — first chunk summarized.
- `InProgress → Complete` — final summary written.
- `Complete → Stale` — `copyIfNewer` overwrites the archived `.jsonl`.
- `Stale → InProgress | Complete` — re-summarization run.
- `* → Poison` — `recordFailure` increments attempts past `MAX_ATTEMPTS`.
- `Poison → Pending` — explicit retry signal.

_Avoid_: "status", "phase", "step". The state machine is the contract.

## Skipped (not a state)

A Conversation containing one of the `EXCLUSION_MARKERS` (e.g., `DO NOT INDEX THIS CHAT`). Detected by content scan; never enters the SyncState machine. The marker scan runs every sync; results are not persisted.

_Avoid_: making Skipped a SyncState — it is a per-run filter, not a lifecycle position.

## Archive

The mirrored copy of `.jsonl` files under `~/.config/superpowers/conversation-archive/<project>/`. Append-only-by-overwrite (`copyIfNewer`). Source of truth for indexing and summarization (the original `~/.claude/projects/` location may be rotated by Claude Code).

_Avoid_: "backup" (it is not for restoration), "cache" (it is durable input, not regenerable).

## Index

The SQLite database at `~/.config/superpowers/conversation-index/index.db` holding Exchanges, ToolCalls, and embedding vectors via `sqlite-vec`. Built from Archive content, not from source directories directly.

## Sidecar

A small JSON file colocated with a Conversation's archived `.jsonl`, named `<conv>.sync.json`. Holds SyncState. Atomic write via tmp+rename. Schema-versioned.

_Avoid_: "metadata file", "manifest" — those terms are reserved for higher-level concepts not in this codebase.
