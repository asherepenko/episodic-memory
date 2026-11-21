import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { capMessageText, resolveMaxMessageChars, parseConversation } from '../src/parser.js';
import { DEFAULT_MAX_MESSAGE_CHARS } from '../src/constants.js';

describe('capMessageText', () => {
  it('leaves text under the cap unchanged', () => {
    expect(capMessageText('hello', 10)).toBe('hello');
    expect(capMessageText('x'.repeat(10), 10)).toBe('x'.repeat(10));
  });

  it('keeps head and tail with an omitted-count marker', () => {
    const text = 'a'.repeat(60) + 'b'.repeat(500) + 'c'.repeat(40);
    const out = capMessageText(text, 100);
    expect(out.startsWith('a'.repeat(60))).toBe(true);
    expect(out.endsWith('c'.repeat(40))).toBe(true);
    expect(out).toContain('\n[… 500 chars omitted by episodic-memory …]\n');
    expect(out).not.toContain('bb');
  });

  it('is disabled by a cap of 0', () => {
    const text = 'z'.repeat(5000);
    expect(capMessageText(text, 0)).toBe(text);
  });

  it('never splits a surrogate pair', () => {
    for (let max = 5; max < 40; max++) {
      const text = '😀'.repeat(100);
      const out = capMessageText(text, max);
      const stripped = out.replace(/\n\[… \d+ chars omitted by episodic-memory …\]\n/, '');
      expect(stripped).toBe(Array.from(stripped).join(''));
      expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(out)).toBe(false);
    }
  });
});

describe('resolveMaxMessageChars', () => {
  it('defaults, parses, disables, and rejects invalid values', () => {
    expect(resolveMaxMessageChars(undefined)).toBe(DEFAULT_MAX_MESSAGE_CHARS);
    expect(resolveMaxMessageChars('')).toBe(DEFAULT_MAX_MESSAGE_CHARS);
    expect(resolveMaxMessageChars('abc')).toBe(DEFAULT_MAX_MESSAGE_CHARS);
    expect(resolveMaxMessageChars('-5')).toBe(DEFAULT_MAX_MESSAGE_CHARS);
    expect(resolveMaxMessageChars('1.5')).toBe(DEFAULT_MAX_MESSAGE_CHARS);
    expect(resolveMaxMessageChars('500')).toBe(500);
    expect(resolveMaxMessageChars('0')).toBe(0);
  });
});

describe('parseConversation message cap', () => {
  const dirs: string[] = [];
  const saved = process.env.EPISODIC_MEMORY_MAX_MESSAGE_CHARS;
  afterEach(() => {
    if (saved === undefined) delete process.env.EPISODIC_MEMORY_MAX_MESSAGE_CHARS;
    else process.env.EPISODIC_MEMORY_MAX_MESSAGE_CHARS = saved;
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  function fixture(userText: string, assistantText: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-'));
    dirs.push(dir);
    const file = path.join(dir, 'c.jsonl');
    const lines = [
      { type: 'user', uuid: 'u1', timestamp: '2026-01-01T00:00:00Z', sessionId: 's', message: { role: 'user', content: userText } },
      { type: 'assistant', uuid: 'a1', parentUuid: 'u1', timestamp: '2026-01-01T00:00:01Z', sessionId: 's', message: { role: 'assistant', content: [{ type: 'text', text: assistantText }] } },
    ];
    fs.writeFileSync(file, lines.map(l => JSON.stringify(l)).join('\n') + '\n');
    return file;
  }

  it('bounds a giant message but keeps the exchange and line range', async () => {
    delete process.env.EPISODIC_MEMORY_MAX_MESSAGE_CHARS;
    const giant = 'HEAD-' + 'x'.repeat(2_000_000) + '-TAIL';
    const file = fixture(giant, 'ok');
    const ex = await parseConversation(file, 'p', file);
    expect(ex).toHaveLength(1);
    expect(ex[0].userMessage.length).toBeLessThan(DEFAULT_MAX_MESSAGE_CHARS + 200);
    expect(ex[0].userMessage).toContain('chars omitted by episodic-memory');
    expect(ex[0].userMessage.startsWith('HEAD-')).toBe(true);
    expect(ex[0].userMessage.endsWith('-TAIL')).toBe(true);
    expect(ex[0].assistantMessage).toBe('ok');
    expect(ex[0].lineStart).toBe(1);
    expect(ex[0].lineEnd).toBe(2);
  });

  it('honors the env override, including 0 = no cap', async () => {
    const big = 'y'.repeat(5000);
    process.env.EPISODIC_MEMORY_MAX_MESSAGE_CHARS = '1000';
    let file = fixture('q', big);
    let ex = await parseConversation(file, 'p', file);
    expect(ex[0].assistantMessage.length).toBeLessThan(1200);
    expect(ex[0].assistantMessage).toContain('omitted by episodic-memory');

    process.env.EPISODIC_MEMORY_MAX_MESSAGE_CHARS = '0';
    file = fixture('q', big);
    ex = await parseConversation(file, 'p', file);
    expect(ex[0].assistantMessage).toBe(big);
  });
});
