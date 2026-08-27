/**
 * Install-integrity reporting for `episodic-memory doctor install`.
 *
 * The plugin self-heals its own files at startup (see cli/repair.mjs), but that
 * can only run when an entry point survived the partial install. When `cli/` is
 * itself missing, nothing inside the install is reachable and the host just
 * retries a connect timeout. This command is the outside-in path: run it from
 * any working copy to find every episodic-memory install on the machine, report
 * what each is missing, and optionally repair them.
 */
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';

export type PluginHost = 'Claude Code' | 'Codex';

export interface DiscoveredInstall {
  host: PluginHost;
  marketplace: string;
  version: string;
  path: string;
}

export interface InstallStatus extends DiscoveredInstall {
  missing: string[];
  repaired?: string[];
  stillMissing?: string[];
}

export interface InstallDoctorReport {
  ok: boolean;
  text: string;
}

/**
 * Both hosts lay plugins out as
 * `<host>/plugins/cache/<marketplace>/<plugin>/<version>/`, so one walk covers
 * either. Missing directories are not an error: a machine with only one of the
 * two hosts installed is normal.
 */
export function discoverInstalls(hostRoots: Array<{ host: PluginHost; dir: string }>): DiscoveredInstall[] {
  const found: DiscoveredInstall[] = [];

  for (const { host, dir } of hostRoots) {
    const cacheDir = join(dir, 'plugins', 'cache');
    for (const marketplace of safeReaddir(cacheDir)) {
      const pluginDir = join(cacheDir, marketplace, 'episodic-memory');
      for (const version of safeReaddir(pluginDir)) {
        const path = join(pluginDir, version);
        found.push({ host, marketplace, version, path });
      }
    }
  }

  return found.sort((a, b) => a.path.localeCompare(b.path));
}

function safeReaddir(dir: string): string[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter(entry => !entry.name.startsWith('.'))
      .map(entry => entry.name);
  } catch {
    return [];
  }
}

/**
 * Which host manifest each install exposes. Reported because a missing manifest
 * is precisely the failure that makes a host fall back to another config file
 * and launch the server with the wrong path.
 */
function manifestSummary(installPath: string): string {
  const claude = existsSync(join(installPath, '.claude-plugin', 'plugin.json'));
  // Codex's MCP config moved out of the repo root in 1.5.9; either satisfies it.
  const codex =
    existsSync(join(installPath, '.codex-plugin', 'mcp.json')) ||
    existsSync(join(installPath, '.mcp.json'));
  if (claude && codex) return 'Claude + Codex manifests present';
  if (claude) return 'Claude manifest only (Codex MCP config missing)';
  if (codex) return 'Codex manifest only (Claude plugin manifest missing)';
  return 'no host manifest — neither host can launch this install';
}

export function readVersionField(installPath: string): string | null {
  try {
    const parsed = JSON.parse(readFileSync(join(installPath, 'package.json'), 'utf-8'));
    return typeof parsed.version === 'string' ? parsed.version : null;
  } catch {
    return null;
  }
}

/**
 * Render the report. Pure: discovery and repair happen in the CLI so this stays
 * directly testable against synthetic statuses.
 */
export function buildInstallDoctorReport(
  statuses: InstallStatus[],
  { repairAttempted = false }: { repairAttempted?: boolean } = {}
): InstallDoctorReport {
  const lines: string[] = ['episodic-memory install integrity', ''];

  if (statuses.length === 0) {
    lines.push('  No plugin installs found under the Claude Code or Codex plugin caches.');
    lines.push('  If you run episodic-memory from a git checkout or a global npm install,');
    lines.push('  there is nothing for this check to inspect.');
    lines.push('');
    return { ok: true, text: lines.join('\n') };
  }

  let ok = true;

  for (const status of statuses) {
    const unresolved = status.stillMissing ?? status.missing;
    const healthy = unresolved.length === 0;
    if (!healthy) ok = false;

    lines.push(`  ${healthy ? 'OK  ' : 'FAIL'} ${status.host} · ${status.marketplace} · v${status.version}`);
    lines.push(`       ${status.path}`);
    lines.push(`       ${manifestSummary(status.path)}`);

    if (status.repaired?.length) {
      lines.push(`       repaired ${status.repaired.length} path(s): ${status.repaired.join(', ')}`);
    }
    if (!healthy) {
      lines.push(`       missing ${unresolved.length} path(s): ${unresolved.join(', ')}`);
      lines.push(
        repairAttempted
          ? '       repair could not complete — reinstall the plugin'
          : '       run: episodic-memory doctor install --repair'
      );
    }
    lines.push('');
  }

  return { ok, text: lines.join('\n') };
}
