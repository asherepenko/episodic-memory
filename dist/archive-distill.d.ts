/**
 * Record types that carry no searchable conversation content. Unknown types are
 * kept: this is a drop-list, so new record kinds survive until someone decides.
 */
export declare const DROP_TYPES: ReadonlySet<string>;
export declare const TRIM_HEAD_CHARS = 2048;
export declare const IMAGE_PLACEHOLDER = "[image omitted]";
/**
 * Distill one JSONL line. Returns null to drop it, or the line itself when
 * nothing changed — unchanged lines keep their exact bytes, which keeps line
 * numbers (and so exchange ids) stable as a live conversation grows.
 */
export declare function distillLine(line: string): string | null;
/** Distill a whole JSONL conversation. Idempotent: distilling the output again changes nothing. */
export declare function distillTranscript(text: string): string;
export interface CopyResult {
    copied: boolean;
    /** The destination existed and the new bytes do not extend it: its line numbers moved. */
    shifted: boolean;
}
/**
 * Copy a live conversation into the archive, distilled. Copies when the
 * destination is missing or the source mtime is newer (the same rule the raw
 * copy used). Writes through a same-directory temp file and a rename.
 */
export declare function copyDistilled(src: string, dest: string): CopyResult;
