let activeProgress;
/** Register (or clear) the renderer that owns the terminal's live rows. */
export function setActiveProgress(progress) {
    activeProgress = progress;
}
/** Write a terminal line without corrupting an active spinner. */
export function writeProgressAwareLine(message, fallback) {
    if (activeProgress) {
        activeProgress.writeLine(message);
        return;
    }
    fallback();
}
