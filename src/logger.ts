import fs from 'fs';
import path from 'path';
import { getIndexDir } from './paths.js';

/**
 * Structured logger that writes to both stderr and a log file under the index dir.
 *
 * Log file: <index-dir>/sync.log
 * Format:   ISO_TIMESTAMP [level] message
 *
 * Use this instead of console.log for sync/summarizer to give Andrew a tail-able log.
 */

let logStream: fs.WriteStream | null = null;
let logPath: string | null = null;

function getStream(): fs.WriteStream {
  if (logStream) return logStream;
  logPath = path.join(getIndexDir(), 'sync.log');
  logStream = fs.createWriteStream(logPath, { flags: 'a' });
  return logStream;
}

export function getLogPath(): string {
  if (!logPath) logPath = path.join(getIndexDir(), 'sync.log');
  return logPath;
}

type Level = 'info' | 'warn' | 'error' | 'debug';

function write(level: Level, msg: string): void {
  const line = `${new Date().toISOString()} [${level}] ${msg}\n`;
  try {
    getStream().write(line);
  } catch {
    // ignore log failures
  }
}

export const log = {
  info(msg: string): void {
    write('info', msg);
    console.log(msg);
  },
  warn(msg: string): void {
    write('warn', msg);
    console.log(`⚠️  ${msg}`);
  },
  error(msg: string): void {
    write('error', msg);
    console.error(`❌ ${msg}`);
  },
  debug(msg: string): void {
    write('debug', msg);
    if (process.env.EPISODIC_MEMORY_DEBUG) {
      console.error(`🔍 ${msg}`);
    }
  },
};

export function closeLog(): void {
  if (logStream) {
    logStream.end();
    logStream = null;
  }
  logPath = null;
}
