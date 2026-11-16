import { describe, it, expect } from 'vitest';
import { distillTranscript, DROP_TYPES, TRIM_HEAD_CHARS } from '../src/archive-distill.js';

const jl = (...records: unknown[]) => records.map(r => JSON.stringify(r)).join('\n') + '\n';
const lines = (text: string) => text.split('\n').filter(Boolean).map(l => JSON.parse(l));
const big = (n: number, ch = 'x') => ch.repeat(n);

describe('distillTranscript', () => {
  it('drops noise records and keeps thinking', () => {
    const out = distillTranscript(jl(
      { type: 'attachment', data: 'x' },
      { type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'deep' }] } },
    ));
    expect(out).not.toContain('attachment');
    expect(out).toContain('deep');
  });

  it('drops every type in the drop list and keeps conversation records byte-identical', () => {
    const noise = [...DROP_TYPES].map(type => ({ type, payload: big(5000) }));
    const keep = [
      { type: 'user', uuid: 'u1', parentUuid: null, message: { role: 'user', content: 'hi' } },
      { type: 'assistant', uuid: 'a1', parentUuid: 'u1', message: { content: [{ type: 'thinking', thinking: big(9000, 't') }, { type: 'text', text: 'ok' }] } },
      { type: 'system', content: 'sys' },
      { type: 'summary', summary: 'sum' },
    ];
    const input = jl(noise[0], keep[0], ...noise.slice(1), keep[1], keep[2], keep[3]);
    expect(distillTranscript(input)).toBe(jl(...keep));
    expect([...DROP_TYPES].sort()).toEqual(['api-request', 'api-request-blob', 'api-request-shape', 'attachment', 'progress', 'queue-operation']);
  });

  it('trims a large string tool_result, keeping tool_use_id and an original-size marker', () => {
    const body = big(10000);
    const [rec] = lines(distillTranscript(jl({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: body }] } })));
    const block = rec.message.content[0];
    expect(block.tool_use_id).toBe('toolu_1');
    expect(block.content.startsWith(big(TRIM_HEAD_CHARS))).toBe(true);
    expect(block.content).toContain('[episodic-memory: trimmed, original 10000 bytes]');
    expect(block.content.length).toBeLessThan(TRIM_HEAD_CHARS + 100);
  });

  it('trims text blocks inside an array tool_result and replaces images with a placeholder', () => {
    const [rec] = lines(distillTranscript(jl({ type: 'user', message: { content: [
      { type: 'tool_result', tool_use_id: 't2', content: [{ type: 'text', text: big(6000) }, { type: 'image', source: { data: big(50000) } }] },
      { type: 'image', source: { type: 'base64', data: big(80000) } },
    ] } })));
    const [result, image] = rec.message.content;
    expect(result.content[0].text).toContain('original 6000 bytes');
    expect(result.content[1]).toEqual({ type: 'text', text: '[image omitted]' });
    expect(image).toEqual({ type: 'text', text: '[image omitted]' });
  });

  it('trims large string leaves of tool_use input but keeps it an object with its id', () => {
    const [rec] = lines(distillTranscript(jl({ type: 'assistant', message: { content: [
      { type: 'tool_use', id: 'toolu_9', name: 'Write', input: { file_path: '/a.ts', content: big(20000) } },
    ] } })));
    const block = rec.message.content[0];
    expect(block.id).toBe('toolu_9');
    expect(block.input.file_path).toBe('/a.ts');
    expect(block.input.content).toContain('original 20000 bytes');
  });

  it('replaces a large toolUseResult with a short marker string', () => {
    const [rec] = lines(distillTranscript(jl({ type: 'user', toolUseResult: { stdout: big(9000) }, message: { content: 'x' } })));
    expect(typeof rec.toolUseResult).toBe('string');
    expect(rec.toolUseResult).toMatch(/^\[episodic-memory: tool result trimmed, original \d+ bytes\]$/);
  });

  it('leaves small tool bodies untouched', () => {
    const input = jl({ type: 'user', toolUseResult: 'ok', message: { content: [{ type: 'tool_result', tool_use_id: 't', content: 'small' }] } });
    expect(distillTranscript(input)).toBe(input);
  });

  it('passes unknown types, Codex records, bad JSON and a partial trailing line through byte-identical', () => {
    const input = [
      '{"type":"mystery","b":1}',
      '{"timestamp":"t","type":"response_item","payload":{"type":"message","content":[{"type":"input_text","text":"hi"}]}}',
      'not json at all',
      '{"type":"user","message":{"con',
    ].join('\n');
    expect(distillTranscript(input)).toBe(input);
  });

  it('is idempotent, including multibyte text cut near a surrogate pair', () => {
    const emoji = '😀'.repeat(4000);
    const input = jl(
      { type: 'progress', x: 1 },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't', content: 'a' + emoji }] } },
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'u', name: 'X', input: { s: 'é'.repeat(9000) } }] } },
    );
    const once = distillTranscript(input);
    expect(distillTranscript(once)).toBe(once);
    const [rec] = lines(once);
    expect(rec.message.content[0].content).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });
});
