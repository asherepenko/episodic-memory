import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

describe('plugin hook configuration', () => {
  it('uses a plugin root fallback that works in Codex and Claude Code', () => {
    const hooks = JSON.parse(
      readFileSync(new URL('../hooks/hooks.json', import.meta.url), 'utf-8')
    );

    const command = hooks.hooks.SessionStart[0].hooks[0].command;

    expect(command).toBe('node "${PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/cli/episodic-memory" sync --background');
  });

  it('does not mark the hook async because Codex plugin hooks do not support async handlers yet', () => {
    const hooks = JSON.parse(
      readFileSync(new URL('../hooks/hooks.json', import.meta.url), 'utf-8')
    );

    const handler = hooks.hooks.SessionStart[0].hooks[0];

    expect(handler.async).toBeUndefined();
  });

  it('points at a real file in the repo so SessionStart does not crash with MODULE_NOT_FOUND', () => {
    const hooks = JSON.parse(
      readFileSync(new URL('../hooks/hooks.json', import.meta.url), 'utf-8')
    );
    const command = hooks.hooks.SessionStart[0].hooks[0].command;
    const match = command.match(/\}\/(\S+?)"/);
    expect(match, `Could not extract script path from: ${command}`).not.toBeNull();
    const scriptRelPath = match![1];
    expect(existsSync(join(REPO_ROOT, scriptRelPath))).toBe(true);
  });
});

describe('Codex MCP server configuration', () => {
  it('points at a real file in the repo so Codex MCP boot does not crash', () => {
    const mcp = JSON.parse(
      readFileSync(new URL('../.mcp.json', import.meta.url), 'utf-8')
    );
    const scriptRelPath = mcp.mcpServers['episodic-memory'].args[0];
    expect(existsSync(join(REPO_ROOT, scriptRelPath))).toBe(true);
  });
});
