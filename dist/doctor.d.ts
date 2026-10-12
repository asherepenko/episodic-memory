import type { CodexHookTrustState } from './codex-hook-trust.js';
import { type Ui } from './cli-ui.js';
export interface CodexDoctorInputs {
    codexVersionOutput: string;
    featuresOutput: string;
    mcpListOutput: string;
    codexHome: string;
    sessionsDirExists: boolean;
    logPath: string;
    dbPath: string;
    hookTrustState: CodexHookTrustState;
}
export interface DoctorReport {
    ok: boolean;
    text: string;
}
export interface DoctorCounts {
    checks: number;
    warnings: number;
    failures: number;
}
/** Draw the Codex checks with the shared UI kit and return the tallies. */
export declare function renderCodexDoctor(ui: Ui, inputs: CodexDoctorInputs): DoctorCounts;
export declare function buildCodexDoctorReport(inputs: CodexDoctorInputs): DoctorReport;
