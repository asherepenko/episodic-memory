import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// The SessionStart hook is split per transport: each host resolves the plugin
// install dir through a different env var (Claude Code sets CLAUDE_PLUGIN_ROOT,
// Codex sets PLUGIN_ROOT), and only one of them honors the SessionStart
// `matcher` field. A single shared file had to paper over both with a fallback
// expression and a matcher the other host ignored, so the hook could silently
// fail to launch. Claude Code auto-discovers hooks/hooks.json; Codex is pointed
// at hooks/hooks-codex.json via .codex-plugin/plugin.json.
const TRANSPORTS = [
  { label: 'Claude Code', file: 'hooks/hooks.json', rootVar: '${CLAUDE_PLUGIN_ROOT}', hasMatcher: false },
  { label: 'Codex', file: 'hooks/hooks-codex.json', rootVar: '${PLUGIN_ROOT}', hasMatcher: true },
];

describe('plugin hook configuration', () => {
  for (const { label, file, rootVar, hasMatcher } of TRANSPORTS) {
    describe(`${label} (${file})`, () => {
      const hooks = JSON.parse(readFileSync(join(REPO_ROOT, file), 'utf-8'));
      const entry = hooks.hooks.SessionStart[0];
      const handler = entry.hooks[0];

      it('launches the background sync via the transport-specific plugin root', () => {
        expect(handler.command).toBe(`node "${rootVar}/cli/episodic-memory.mjs" sync --background`);
      });

      it('caps the launch with a short timeout so a slow start cannot hang session startup', () => {
        expect(handler.timeout).toBe(10);
      });

      it('declares a SessionStart matcher only on the host that honors it', () => {
        if (hasMatcher) {
          expect(entry.matcher).toBe('startup|resume|clear');
        } else {
          expect(entry.matcher).toBeUndefined();
        }
      });

      it('does not mark the hook async because Codex plugin hooks do not support async handlers yet', () => {
        expect(handler.async).toBeUndefined();
      });

      it('points at a real file in the repo so SessionStart does not crash with MODULE_NOT_FOUND', () => {
        const match = handler.command.match(/\}\/(\S+?)"/);
        expect(match, `Could not extract script path from: ${handler.command}`).not.toBeNull();
        const scriptRelPath = match![1];
        expect(existsSync(join(REPO_ROOT, scriptRelPath))).toBe(true);
      });
    });
  }
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
