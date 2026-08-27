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
/**
 * Render the report. Pure: discovery and repair happen in the CLI so this stays
 * directly testable against synthetic statuses.
 */
export declare function buildInstallDoctorReport(statuses: InstallStatus[], { repairAttempted }?: {
    repairAttempted?: boolean;
}): InstallDoctorReport;
