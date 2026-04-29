---
name: remembering-conversations
description: "Searches past conversations to restore context, decisions, and patterns across sessions. Use this when: the user asks 'how should I...' or 'what's the best approach...', you're about to make an architectural decision, you've investigated a problem and hit a dead end, the user says 'last time' / 'we discussed' / 'do you remember' / 'you implemented', you're following an unfamiliar workflow, you're working in a codebase you've touched before and need to understand prior intent, or you encounter an error that feels like it may have come up in a past session. When in doubt, search — it costs nothing and regularly surfaces decisions that prevent 20-minute rabbit holes. Err on the side of searching too often rather than too rarely."
argument-hint: "[topic or question]"
allowed-tools: Agent, mcp__plugin_episodic-memory_episodic-memory__search, mcp__plugin_episodic-memory_episodic-memory__read
---

# Remembering Conversations

**Core principle:** Search before reinventing. Searching costs nothing; reinventing or repeating mistakes costs everything.

## Searching

Dispatch the `search-conversations` subagent. It searches the archive, reads the top 2–5 results in full, and returns a 200–1000 word synthesis with actionable insights and source file pointers. This is 50–100x cheaper than loading raw conversations into your context window — the agent distills only what's relevant rather than flooding context with full transcripts.

Good queries use specific terms — function names, error messages, library names. For multi-faceted problems, pass an array like `["auth", "JWT", "refresh token"]` to find conversations matching all concepts simultaneously.

Announce: "Dispatching search agent to find [topic]."

Then use the Agent tool:

```
Agent tool:
  description: "Search past conversations for [topic]"
  prompt: "Search for [specific query or topic]. Focus on [what you're looking for — e.g., decisions, patterns, gotchas, code examples]."
  subagent_type: "episodic-memory:search-conversations"
```

## Using the Results

Once the agent returns its synthesis:
- Open with a 1–2 sentence summary of what was found (or "Nothing relevant in the archive" if the search came up empty) — the user can't see raw agent output
- When applying patterns or decisions from past conversations, name the source (project + approximate date from the source pointers) so the user can verify or pull the full context if needed
- If nothing relevant was found, continue without historical context — don't invent patterns that weren't there

## When Not to Search

- Current codebase structure — use Grep/Read to explore first
- Information already in the current conversation
- Before you understand what you're being asked (explore first, then search for context)

## Direct MCP Tools (Advanced)

The underlying MCP tools are available if you need finer control than the agent provides:
- `mcp__plugin_episodic-memory_episodic-memory__search`
- `mcp__plugin_episodic-memory_episodic-memory__read`

These return raw results that dump full conversation excerpts into your context window. Use them only when you need precise line ranges or structured JSON output that the agent wouldn't produce. For general historical lookups, the agent's synthesis is almost always sufficient.

See `references/mcp-api.md` for the complete API reference.
