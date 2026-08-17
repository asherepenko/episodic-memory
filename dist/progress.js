const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const FRAME_INTERVAL_MS = 120;
const CLEAR_LINE = '\r\u001b[2K';
let activeProgress;
/** Write a terminal line without corrupting an active spinner row. */
export function writeProgressAwareLine(message, fallback) {
    if (activeProgress) {
        activeProgress.writeLine(message);
        return;
    }
    fallback();
}
/**
 * Lightweight dependency-free progress feedback for long CLI operations.
 * stderr keeps progress out of stdout consumers and out of the MCP protocol.
 */
export function createProgressIndicator(label, output = process.stderr) {
    let currentLabel = label;
    let frame = 0;
    let timer;
    let running = false;
    const render = () => {
        output.write(`${CLEAR_LINE}${currentLabel} ${FRAMES[frame]}`);
    };
    const coordinator = {
        writeLine(message) {
            output.write(`${CLEAR_LINE}${message}\n`);
            render();
        },
    };
    return {
        start() {
            if (running)
                return;
            running = true;
            if (!output.isTTY) {
                output.write(`${currentLabel}...\n`);
                return;
            }
            activeProgress = coordinator;
            render();
            timer = setInterval(() => {
                frame = (frame + 1) % FRAMES.length;
                render();
            }, FRAME_INTERVAL_MS);
            timer.unref?.();
        },
        update(label) {
            currentLabel = label;
            if (running && output.isTTY)
                render();
        },
        complete(label) {
            if (!running)
                return;
            running = false;
            if (timer)
                clearInterval(timer);
            if (activeProgress === coordinator)
                activeProgress = undefined;
            output.write(output.isTTY ? `${CLEAR_LINE}${label}\n` : `${label}\n`);
        },
    };
}
