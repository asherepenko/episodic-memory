import fs from 'fs';
import path from 'path';

/**
 * Record types that carry no searchable conversation content. Unknown types are
 * kept: this is a drop-list, so new record kinds survive until someone decides.
 */
export const DROP_TYPES: ReadonlySet<string> = new Set([
  'attachment',
  'queue-operation',
  'api-request',
  'api-request-blob',
  'api-request-shape',
  'progress',
]);

export const TRIM_HEAD_CHARS = 2048;
// Trimmed output (head + marker) stays under this, so a second pass is a no-op.
const TRIM_TRIGGER_CHARS = TRIM_HEAD_CHARS + 256;
export const IMAGE_PLACEHOLDER = '[image omitted]';

const utf8Bytes = (s: string) => Buffer.byteLength(s, 'utf8');

function trimText(text: string): string {
  if (text.length <= TRIM_TRIGGER_CHARS) return text;
  let end = TRIM_HEAD_CHARS;
  const code = text.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end--;
  return `${text.slice(0, end)}\n[episodic-memory: trimmed, original ${utf8Bytes(text)} bytes]`;
}

type Mutable = { changed: boolean };

function trimLeaves(value: unknown, m: Mutable): unknown {
  if (typeof value === 'string') {
    const out = trimText(value);
    if (out !== value) m.changed = true;
    return out;
  }
  if (Array.isArray(value)) return value.map(v => trimLeaves(v, m));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = trimLeaves(v, m);
    return out;
  }
  return value;
}

function distillToolResultContent(content: unknown, m: Mutable): unknown {
  if (typeof content === 'string') return trimLeaves(content, m);
  if (!Array.isArray(content)) return content;
  return content.map(block => distillBlock(block, m));
}

function distillBlock(block: unknown, m: Mutable): unknown {
  if (!block || typeof block !== 'object') return block;
  const b = block as Record<string, unknown>;
  switch (b.type) {
    case 'image':
      m.changed = true;
      return { type: 'text', text: IMAGE_PLACEHOLDER };
    case 'text':
      return typeof b.text === 'string' ? { ...b, text: trimLeaves(b.text, m) } : b;
    case 'tool_result':
      return { ...b, content: distillToolResultContent(b.content, m) };
    case 'tool_use':
      return { ...b, input: trimLeaves(b.input, m) };
    default:
      return b;
  }
}

/**
 * Distill one JSONL line. Returns null to drop it, or the line itself when
 * nothing changed — unchanged lines keep their exact bytes, which keeps line
 * numbers (and so exchange ids) stable as a live conversation grows.
 */
export function distillLine(line: string): string | null {
  let record: Record<string, unknown>;
  try {
    const parsed = JSON.parse(line);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return line;
    record = parsed;
  } catch {
    return line;
  }
  if (typeof record.type === 'string' && DROP_TYPES.has(record.type)) return null;

  const m: Mutable = { changed: false };
  const out: Record<string, unknown> = { ...record };

  const message = record.message as Record<string, unknown> | undefined;
  if (message && typeof message === 'object' && Array.isArray(message.content)) {
    // Only tool and image blocks are touched; user/assistant text and thinking stay whole.
    const content = message.content.map(block => {
      const type = (block as { type?: unknown } | null)?.type;
      return type === 'text' ? block : distillBlock(block, m);
    });
    out.message = { ...message, content };
  }

  if (record.toolUseResult !== undefined) {
    const raw = typeof record.toolUseResult === 'string' ? record.toolUseResult : JSON.stringify(record.toolUseResult);
    if (raw !== undefined && raw.length > TRIM_TRIGGER_CHARS) {
      out.toolUseResult = `[episodic-memory: tool result trimmed, original ${utf8Bytes(raw)} bytes]`;
      m.changed = true;
    }
  }

  return m.changed ? JSON.stringify(out) : line;
}

/** Distill a whole JSONL conversation. Idempotent: distilling the output again changes nothing. */
export function distillTranscript(text: string): string {
  const parts = text.split('\n');
  const kept: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const line = parts[i];
    const isLast = i === parts.length - 1;
    if (line === '') {
      if (!isLast) kept.push(line);
      continue;
    }
    const out = distillLine(line);
    if (out !== null) kept.push(out);
  }
  // Re-join: a trailing newline survives as the final empty element.
  const body = kept.join('\n');
  return parts[parts.length - 1] === '' && kept.length > 0 ? body + '\n' : body;
}

export interface CopyResult {
  copied: boolean;
  /** The destination existed and the new bytes do not extend it: its line numbers moved. */
  shifted: boolean;
}

/**
 * Above this size a conversation is archived raw: distilling reads it whole into
 * one string, which V8 caps near 512 MB and which would strain the heap anyway.
 */
export const MAX_DISTILL_BYTES = 256 * 1024 * 1024;

export interface CopyOptions {
  maxDistillBytes?: number;
}

/**
 * Copy a live conversation into the archive, distilled. Copies when the
 * destination is missing or the source mtime is newer (the same rule the raw
 * copy used). Writes through a same-directory temp file and a rename.
 */
export function copyDistilled(src: string, dest: string, options: CopyOptions = {}): CopyResult {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const srcStat = fs.lstatSync(src);
  const destStat = fs.existsSync(dest) ? fs.lstatSync(dest) : undefined;
  if (destStat && destStat.mtimeMs >= srcStat.mtimeMs) return { copied: false, shifted: false };

  const tempDest = `${dest}.tmp.${process.pid}`;
  const commit = (write: () => void) => {
    try {
      write();
      fs.renameSync(tempDest, dest);
    } catch (error) {
      fs.rmSync(tempDest, { force: true });
      throw error;
    }
  };

  if (srcStat.size > (options.maxDistillBytes ?? MAX_DISTILL_BYTES)) {
    commit(() => fs.copyFileSync(src, tempDest));
    // Not worth reading the old archive back to compare: assume its lines moved.
    return { copied: true, shifted: destStat !== undefined };
  }

  const old = destStat ? fs.readFileSync(dest) : undefined;
  const next = Buffer.from(distillTranscript(fs.readFileSync(src, 'utf8')), 'utf8');
  commit(() => fs.writeFileSync(tempDest, next));
  const shifted = old !== undefined && !next.subarray(0, old.length).equals(old);
  return { copied: true, shifted };
}
