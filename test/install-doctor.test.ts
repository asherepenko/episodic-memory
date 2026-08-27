import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  buildInstallDoctorReport,
  discoverInstalls,
  readVersionField,
  type InstallStatus,
} from '../src/install-doctor.js';

const temps: string[] = [];

function makeTemp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'em-doctor-'));
  temps.push(dir);
  return dir;
}

function seedInstall(hostDir: string, marketplace: string, version: string): string {
  const path = join(hostDir, 'plugins', 'cache', marketplace, 'episodic-memory', version);
  mkdirSync(path, { recursive: true });
  return path;
}

function status(overrides: Partial<InstallStatus> = {}): InstallStatus {
  return {
    host: 'Claude Code',
    marketplace: 'mkt',
    version: '1.5.8',
    path: '/tmp/does-not-exist',
    missing: [],
    ...overrides,
  };
}

afterEach(() => {
  while (temps.length) {
    rmSync(temps.pop()!, { recursive: true, force: true });
  }
});

describe('install discovery', () => {
  it('finds installs across both host plugin caches', () => {
    const claude = makeTemp();
    const codex = makeTemp();
    seedInstall(claude, 'asherepenko-claude-marketplace', '1.5.8');
    seedInstall(codex, 'episodic-memory-dev', '1.5.8');

    const found = discoverInstalls([
      { host: 'Claude Code', dir: claude },
      { host: 'Codex', dir: codex },
    ]);

    expect(found).toHaveLength(2);
    expect(found.map(i => i.host).sort()).toEqual(['Claude Code', 'Codex']);
    expect(found.map(i => i.marketplace)).toContain('episodic-memory-dev');
  });

  it('reports every installed version separately, since each is its own tree', () => {
    const claude = makeTemp();
    seedInstall(claude, 'mkt', '1.5.6');
    seedInstall(claude, 'mkt', '1.5.8');

    const found = discoverInstalls([{ host: 'Claude Code', dir: claude }]);
    expect(found.map(i => i.version).sort()).toEqual(['1.5.6', '1.5.8']);
  });

  it('is silent about a host that is not installed at all', () => {
    expect(discoverInstalls([{ host: 'Codex', dir: join(makeTemp(), 'absent') }])).toEqual([]);
  });

  it('reads the version from package.json, falling back to the directory name', () => {
    const claude = makeTemp();
    const path = seedInstall(claude, 'mkt', '1.5.8');
    expect(readVersionField(path)).toBeNull();
    writeFileSync(join(path, 'package.json'), JSON.stringify({ version: '7.7.7' }));
    expect(readVersionField(path)).toBe('7.7.7');
  });
});

describe('install doctor report', () => {
  it('passes when every install is complete', () => {
    const report = buildInstallDoctorReport([status()]);
    expect(report.ok).toBe(true);
    expect(report.text).toContain('OK');
  });

  it('fails and names the missing paths', () => {
    const report = buildInstallDoctorReport([
      status({ missing: ['cli/mcp-server.mjs', 'hooks/hooks.json'] }),
    ]);
    expect(report.ok).toBe(false);
    expect(report.text).toContain('cli/mcp-server.mjs');
    expect(report.text).toContain('doctor install --repair');
  });

  it('passes once repair has resolved everything', () => {
    const report = buildInstallDoctorReport(
      [status({ missing: ['cli/mcp-server.mjs'], repaired: ['cli/mcp-server.mjs'], stillMissing: [] })],
      { repairAttempted: true }
    );
    expect(report.ok).toBe(true);
    expect(report.text).toContain('repaired 1 path(s)');
  });

  it('tells the user to reinstall when repair could not finish', () => {
    const report = buildInstallDoctorReport(
      [status({ missing: ['dist/mcp-server.js'], repaired: [], stillMissing: ['dist/mcp-server.js'] })],
      { repairAttempted: true }
    );
    expect(report.ok).toBe(false);
    expect(report.text).toContain('reinstall the plugin');
  });

  // A missing manifest is what makes a host fall back to another config file
  // and launch the server with a path that resolves against `/`.
  it('calls out which host manifests are present', () => {
    const dir = makeTemp();
    mkdirSync(join(dir, '.claude-plugin'), { recursive: true });
    writeFileSync(join(dir, '.claude-plugin', 'plugin.json'), '{}');

    const report = buildInstallDoctorReport([status({ path: dir })]);
    expect(report.text).toContain('Claude manifest only');
  });

  it('says so plainly when there is nothing installed to check', () => {
    const report = buildInstallDoctorReport([]);
    expect(report.ok).toBe(true);
    expect(report.text).toContain('No plugin installs found');
  });
});
