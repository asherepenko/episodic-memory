import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

import { buildBaseConfig } from '../scripts/codex-e2e.js';

const REPO_ROOT = join(import.meta.dirname, '..');

describe('Codex E2E test harness', () => {
  it.each([
    ['hooks stable true\nplugin_hooks removed false\n', 'hooks'],
    ['hooks stable false\n', 'hooks'],
    ['hooks stable true\nplugin_hooks under development false\n', 'plugin_hooks'],
    ['plugin_hooks under development true\n', 'plugin_hooks'],
  ])('configures the active hook flag from %s', (features, flag) => {
    const config = buildBaseConfig(features);
    expect(config).toContain(`\n${flag} = true\n`);
    const inactive = flag === 'hooks' ? 'plugin_hooks' : 'hooks';
    expect(config).not.toContain(`\n${inactive} = true\n`);
  });

  it('rejects feature output without an active hook flag', () => {
    expect(() => buildBaseConfig('plugins stable true\nplugin_hooks removed false\n'))
      .toThrow('active Codex hook feature');
  });

  it('exposes an opt-in npm script', () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf-8'));
    expect(pkg.scripts['test:codex-e2e']).toBe('node scripts/codex-e2e.js');
  });

  it('contains the production Codex plugin workflow checks', () => {
    const scriptPath = join(REPO_ROOT, 'scripts/codex-e2e.js');
    expect(existsSync(scriptPath)).toBe(true);

    const script = readFileSync(scriptPath, 'utf-8');
    expect(script).toContain('EPISODIC_MEMORY_RUN_CODEX_E2E');
    expect(script).toContain('tmux');
    expect(script).toContain('hooks/list');
    expect(script).toContain('FOUND_MEMORY_E2E');
    expect(script).toContain('MIN_CODEX_VERSION');
  });
});
