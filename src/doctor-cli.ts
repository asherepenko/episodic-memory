#!/usr/bin/env node
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { buildCodexDoctorReport } from './doctor.js';
import {
  buildInstallDoctorReport,
  discoverInstalls,
  readVersionField,
  type InstallStatus,
} from './install-doctor.js';
import { getClaudeDir, getCodexDir } from './paths.js';
import { getDbPath } from './paths.js';
import { getSyncLogPath } from './logging.js';
import { detectCodexHookTrustState } from './codex-hook-trust.js';

function capture(command: string, args: string[]): string {
  const result = spawnSync(command, args, {
    encoding: 'utf-8',
    timeout: 10000,
  });
  return `${result.stdout || ''}${result.stderr || ''}`.trim();
}

function showHelp(): void {
  console.log(`Usage: episodic-memory doctor <target>

TARGETS:
  codex              Diagnose the local Codex plugin, hook, MCP, archive, and index setup.
  install            Check every episodic-memory plugin install for missing files.

OPTIONS:
  --repair           (install) Restore missing files from a matching local copy.`);
}

/**
 * The integrity engine lives in cli/repair.mjs rather than src/ so it stays
 * loadable when dist/ is one of the missing pieces. Resolve it relative to the
 * plugin root: this file runs from <plugin>/dist/doctor-cli.js.
 */
async function loadRepairModule(): Promise<any> {
  const pluginRoot = path.join(import.meta.dirname, '..');
  return import(pathToFileURL(path.join(pluginRoot, 'cli', 'repair.mjs')).href);
}

async function runInstallDoctor(args: string[]): Promise<never> {
  const repair = args.includes('--repair');
  const { findMissingFiles, repairInstall } = await loadRepairModule();

  const installs = discoverInstalls([
    { host: 'Claude Code', dir: getClaudeDir() },
    { host: 'Codex', dir: getCodexDir() },
  ]);

  const statuses: InstallStatus[] = installs.map(install => {
    const missing: string[] = findMissingFiles(install.path);
    const version = readVersionField(install.path) ?? install.version;
    if (missing.length === 0 || !repair) {
      return { ...install, version, missing };
    }
    const result = repairInstall(install.path, { log: () => {} });
    return {
      ...install,
      version,
      missing,
      repaired: result.repaired,
      stillMissing: result.stillMissing,
    };
  });

  const report = buildInstallDoctorReport(statuses, { repairAttempted: repair });
  process.stdout.write(report.text);
  process.exit(report.ok ? 0 : 1);
}

async function main(): Promise<void> {
  const target = process.argv[2];
  if (target === 'install') {
    await runInstallDoctor(process.argv.slice(3));
  }
  if (target !== 'codex') {
    showHelp();
    process.exit(target ? 1 : 0);
  }

  const codexHome = getCodexDir();
  const hookTrustState = await detectCodexHookTrustState(codexHome, process.cwd());
  const report = buildCodexDoctorReport({
    codexVersionOutput: capture('codex', ['--version']),
    featuresOutput: capture('codex', ['features', 'list']),
    mcpListOutput: capture('codex', ['mcp', 'list']),
    codexHome,
    sessionsDirExists: fs.existsSync(path.join(codexHome, 'sessions')),
    logPath: getSyncLogPath(),
    dbPath: getDbPath(),
    hookTrustState,
  });

  process.stdout.write(report.text);
  process.exit(report.ok ? 0 : 1);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
