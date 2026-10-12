export interface VerificationResult {
    missing: Array<{
        path: string;
        reason: string;
    }>;
    orphaned: Array<{
        uuid: string;
        path: string;
    }>;
    outdated: Array<{
        path: string;
        fileTime: number;
        dbTime: number;
    }>;
    corrupted: Array<{
        path: string;
        error: string;
    }>;
}
export interface VerifyOptions {
    /** Called after each conversation is checked. */
    onProgress?: (done: number, total: number) => void;
}
export declare function verifyIndex(options?: VerifyOptions): Promise<VerificationResult>;
export interface RepairResult {
    removed: number;
    reindexed: number;
    exchanges: number;
    skipped: number;
    summaryFailures: number;
    failed: Array<{
        path: string;
        error: string;
    }>;
}
export interface RepairOptions {
    /** Called before each conversation is re-indexed. */
    onProgress?: (done: number, total: number, file: string) => void;
}
export declare function repairIndex(issues: VerificationResult, options?: RepairOptions): Promise<RepairResult>;
