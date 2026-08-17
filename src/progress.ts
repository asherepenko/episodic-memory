export interface ProgressOutput {
  isTTY?: boolean;
  write(message: string): unknown;
}

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const FRAME_INTERVAL_MS = 120;
const CLEAR_LINE = '\r\u001b[2K';

interface ActiveProgress {
  writeLine(message: string): void;
}

let activeProgress: ActiveProgress | undefined;

/** Write a terminal line without corrupting an active spinner row. */
export function writeProgressAwareLine(message: string, fallback: () => void): void {
  if (activeProgress) {
    activeProgress.writeLine(message);
    return;
  }
  fallback();
}

export interface ProgressIndicator {
  start(): void;
  update(label: string): void;
  complete(label: string): void;
}

/**
 * Lightweight dependency-free progress feedback for long CLI operations.
 * stderr keeps progress out of stdout consumers and out of the MCP protocol.
 */
export function createProgressIndicator(label: string, output: ProgressOutput = process.stderr): ProgressIndicator {
  let currentLabel = label;
  let frame = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  let running = false;

  const render = () => {
    output.write(`${CLEAR_LINE}${currentLabel} ${FRAMES[frame]}`);
  };

  const coordinator: ActiveProgress = {
    writeLine(message) {
      output.write(`${CLEAR_LINE}${message}\n`);
      render();
    },
  };

  return {
    start() {
      if (running) return;
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
      if (running && output.isTTY) render();
    },
    complete(label) {
      if (!running) return;
      running = false;
      if (timer) clearInterval(timer);
      if (activeProgress === coordinator) activeProgress = undefined;
      output.write(output.isTTY ? `${CLEAR_LINE}${label}\n` : `${label}\n`);
    },
  };
}
