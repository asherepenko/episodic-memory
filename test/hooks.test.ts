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

// The MCP server is launched by two different hosts that resolve paths in
// incompatible ways, so each gets its own manifest and neither may regress:
//
//   Claude Code -> .claude-plugin/plugin.json  inline mcpServers, absolute via
//                  ${CLAUDE_PLUGIN_ROOT}. Claude Code does NOT honor `cwd`, so a
//                  relative arg would resolve against the process cwd (`/`).
//   Codex       -> .codex-plugin/mcp.json      relative arg + cwd ".", which
//                  Codex resolves against the plugin root.
//
// A root-level .mcp.json is deliberately absent: Claude Code auto-discovers one
// as a *project* MCP server and would launch it with the Codex-shaped relative
// path, producing `Cannot find module '/cli/mcp-server.mjs'`.
describe('MCP server configuration', () => {
  it('does not ship a root .mcp.json that Claude Code would misread as a project server', () => {
    expect(existsSync(join(REPO_ROOT, '.mcp.json'))).toBe(false);
  });

  it('gives Claude Code an absolute plugin-root path that points at a real file', () => {
    const manifest = JSON.parse(
      readFileSync(join(REPO_ROOT, '.claude-plugin/plugin.json'), 'utf-8')
    );
    const server = manifest.mcpServers?.['episodic-memory'];
    expect(server, 'Claude plugin manifest must declare the episodic-memory MCP server').toBeDefined();
    expect(server.command).toBe('node');

    const arg = server.args[0];
    expect(arg.startsWith('${CLAUDE_PLUGIN_ROOT}/')).toBe(true);
    expect(existsSync(join(REPO_ROOT, arg.replace('${CLAUDE_PLUGIN_ROOT}/', '')))).toBe(true);
  });

  it('gives Codex a plugin-root-relative path that points at a real file', () => {
    const mcp = JSON.parse(
      readFileSync(join(REPO_ROOT, '.codex-plugin/mcp.json'), 'utf-8')
    );
    const server = mcp.mcpServers['episodic-memory'];
    expect(server.cwd).toBe('.');
    expect(existsSync(join(REPO_ROOT, server.args[0]))).toBe(true);
  });

  it('launches the same entry point on both hosts', () => {
    const claudeArg = JSON.parse(
      readFileSync(join(REPO_ROOT, '.claude-plugin/plugin.json'), 'utf-8')
    ).mcpServers['episodic-memory'].args[0].replace('${CLAUDE_PLUGIN_ROOT}/', '');
    const codexArg = JSON.parse(
      readFileSync(join(REPO_ROOT, '.codex-plugin/mcp.json'), 'utf-8')
    ).mcpServers['episodic-memory'].args[0].replace(/^\.\//, '');
    expect(claudeArg).toBe(codexArg);
  });
});
