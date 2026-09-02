import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const REPO_ROOT = join(import.meta.dirname, '..');

// Agent hosts that discover profiles through the agents/*.md directory
// convention reject any file whose frontmatter has no name
// (agent_missing_required_frontmatter), and the plugin manifest's `agents`
// array is only recorded, never executed, on those hosts — so a nameless
// profile silently never registers there even though Claude Code reads it.
describe('search agent profile', () => {
  const raw = readFileSync(join(REPO_ROOT, 'agents/search-conversations.md'), 'utf-8');
  const frontmatter = raw.split(/^---$/m)[1] ?? '';

  it('declares its name so convention-discovered agents are not dropped', () => {
    expect(frontmatter).toMatch(/^name: search-conversations$/m);
  });

  it('keeps the description that routes when the agent should be used', () => {
    expect(frontmatter).toMatch(/^description:\s*\S+/m);
  });
});
