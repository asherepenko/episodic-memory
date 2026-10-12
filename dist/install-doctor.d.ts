import { type Ui } from './cli-ui.js';
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
export declare function discoverInstalls(hostRoots: Array<{
    host: PluginHost;
    dir: string;
}>): DiscoveredInstall[];
export declare function readVersionField(installPath: string): string | null;
export interface InstallDoctorCounts {
    checks: number;
    warnings: number;
    failures: number;
}
/** Draw one install's result with the shared UI kit; returns true when healthy. */
export declare function renderInstallStatus(ui: Ui, status: InstallStatus, repairAttempted: boolean): boolean;
/** Draw the whole install report and return the tallies. */
export declare function renderInstallDoctor(ui: Ui, statuses: InstallStatus[], { repairAttempted }?: {
    repairAttempted?: boolean;
}): InstallDoctorCounts;
/**
 * Render the report to plain text. Pure: discovery and repair happen in the CLI
 * so this stays directly testable against synthetic statuses.
 */
export declare function buildInstallDoctorReport(statuses: InstallStatus[], { repairAttempted }?: {
    repairAttempted?: boolean;
}): InstallDoctorReport;
