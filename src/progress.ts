export interface ProgressOutput {
  isTTY?: boolean;
  write(message: string): unknown;
}

export interface ActiveProgress {
  writeLine(message: string): void;
}

let activeProgress: ActiveProgress | undefined;

/** Register (or clear) the renderer that owns the terminal's live rows. */
export function setActiveProgress(progress: ActiveProgress | undefined): void {
  activeProgress = progress;
}

/** Write a terminal line without corrupting an active spinner. */
export function writeProgressAwareLine(message: string, fallback: () => void): void {
  if (activeProgress) {
    activeProgress.writeLine(message);
    return;
  }
  fallback();
}
