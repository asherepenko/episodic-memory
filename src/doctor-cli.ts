#!/usr/bin/env node
import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { renderCodexDoctor, type DoctorCounts } from './doctor.js';
import { createUi, plural } from './cli-ui.js';
import {
  renderInstallDoctor,
  renderInstallStatus,
  discoverInstalls,
  readVersionField,
  type InstallStatus,
} from './install-doctor.js';
import { getClaudeDir, getCodexDir } from './paths.js';
import { getDbPath } from './paths.js';
import { getSyncLogPath } from './logging.js';
import { detectCodexHookTrustState } from './codex-hook-trust.js';

/** Async so the spinner keeps animating while `codex` runs. */
function capture(command: string, args: string[]): Promise<string> {
  return new Promise(resolve => {
    execFile(command, args, { encoding: 'utf-8', timeout: 10000 }, (_error, stdout, stderr) => {
      resolve(`${stdout || ''}${stderr || ''}`.trim());
    });
  });
}

function summaryParts(counts: DoctorCounts): string[] {
  const parts = [`${plural(counts.checks, 'check')} passed`];
  if (counts.warnings > 0) parts.push(plural(counts.warnings, 'warning'));
  if (counts.failures > 0) parts.push(plural(counts.failures, 'problem'));
  return parts;
}

function showHelp(): void {
  const ui = createUi();
  ui.heading('Usage: episodic-memory doctor <target>');
  ui.heading('Targets');
  ui.field('codex', 'Diagnose the local Codex plugin, hook, MCP, archive, and index setup.');
  ui.field('install', 'Check every episodic-memory plugin install for missing files.');
  ui.heading('Options');
  ui.field('--repair', '(install) Restore missing files from a matching local copy.');
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
  const ui = createUi();
  const startedAt = Date.now();
  const { findMissingFiles, repairInstall } = await loadRepairModule();

  const repairOne = (install: InstallStatus): InstallStatus => {
    const result = repairInstall(install.path, { log: () => {} });
    return { ...install, repaired: result.repaired, stillMissing: result.stillMissing };
  };

  let statuses: InstallStatus[] = await ui.task('checking installs...', async () => {
    const installs = discoverInstalls([
      { host: 'Claude Code', dir: getClaudeDir() },
      { host: 'Codex', dir: getCodexDir() },
    ]);
    return installs.map(install => {
      const missing: string[] = findMissingFiles(install.path);
      const version = readVersionField(install.path) ?? install.version;
      const status: InstallStatus = { ...install, version, missing };
      return missing.length === 0 || !repair ? status : repairOne(status);
    });
  });

  const counts = renderInstallDoctor(ui, statuses, { repairAttempted: repair });

  // Offer the repair on a terminal; non-interactive runs never prompt.
  if (!repair && counts.failures > 0 && ui.interactive && (await ui.confirm('Restore missing files now?'))) {
    statuses = await ui.task('restoring files...', async () =>
      statuses.map(status => (status.missing.length > 0 ? repairOne(status) : status)));
    ui.heading('Repair');
    counts.checks = 0;
    counts.failures = 0;
    for (const status of statuses) {
      if (status.missing.length === 0) {
        counts.checks++;
      } else if (renderInstallStatus(ui, status, true)) {
        counts.checks++;
      } else {
        counts.failures++;
      }
    }
  }

  ui.done(startedAt, summaryParts(counts), { ok: counts.failures === 0 });
  process.exit(counts.failures === 0 ? 0 : 1);
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

  const ui = createUi();
  const startedAt = Date.now();
  const codexHome = getCodexDir();
  const inputs = await ui.task('checking codex...', async () => ({
    codexVersionOutput: await capture('codex', ['--version']),
    featuresOutput: await capture('codex', ['features', 'list']),
    mcpListOutput: await capture('codex', ['mcp', 'list']),
    codexHome,
    sessionsDirExists: fs.existsSync(path.join(codexHome, 'sessions')),
    logPath: getSyncLogPath(),
    dbPath: getDbPath(),
    hookTrustState: await detectCodexHookTrustState(codexHome, process.cwd()),
  }));

  const counts = renderCodexDoctor(ui, inputs);
  ui.done(startedAt, summaryParts(counts), { ok: counts.failures === 0 });
  process.exit(counts.failures === 0 ? 0 : 1);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
