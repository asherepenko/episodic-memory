import fs from 'fs';
import path from 'path';
import { getIndexDir } from './paths.js';
import { writeProgressAwareLine } from './progress.js';
/**
 * Structured logger that writes to both stderr and a log file under the index dir.
 *
 * Log file: <index-dir>/sync.log
 * Format:   ISO_TIMESTAMP [level] message
 *
 * Use this instead of console.log for sync/summarizer to give Andrew a tail-able log.
 */
let logStream = null;
let logPath = null;
function getStream() {
    if (logStream)
        return logStream;
    logPath = path.join(getIndexDir(), 'sync.log');
    logStream = fs.createWriteStream(logPath, { flags: 'a' });
    return logStream;
}
export function getLogPath() {
    if (!logPath)
        logPath = path.join(getIndexDir(), 'sync.log');
    return logPath;
}
function write(level, msg) {
    const line = `${new Date().toISOString()} [${level}] ${msg}\n`;
    try {
        getStream().write(line);
    }
    catch {
        // ignore log failures
    }
}
let consoleInfoMuted = false;
/**
 * Keep info lines out of the terminal (they still go to sync.log). The sync
 * TUI turns this on so per-chunk summarizer chatter doesn't bury the rows;
 * warnings and errors still print.
 */
export function setConsoleInfoMuted(muted) {
    consoleInfoMuted = muted;
}
export const log = {
    info(msg) {
        write('info', msg);
        if (consoleInfoMuted)
            return;
        writeProgressAwareLine(msg, () => console.log(msg));
    },
    warn(msg) {
        write('warn', msg);
        const line = `⚠️  ${msg}`;
        writeProgressAwareLine(line, () => console.log(line));
    },
    error(msg) {
        write('error', msg);
        const line = `❌ ${msg}`;
        writeProgressAwareLine(line, () => console.error(line));
    },
    debug(msg) {
        write('debug', msg);
        if (process.env.EPISODIC_MEMORY_DEBUG) {
            const line = `🔍 ${msg}`;
            writeProgressAwareLine(line, () => console.error(line));
        }
    },
};
export function closeLog() {
    if (logStream) {
        logStream.end();
        logStream = null;
    }
    logPath = null;
}
