import { describe, it, expect, afterEach } from 'vitest';
import {
  buildCodexSummaryPrompt,
  buildCodexSummarizerCommand,
  getApiEnv,
  runCodexCommand,
  shouldSkipReentrantSync,
  isSdkErrorResult,
  isResumeFailure,
  SummarizerSdkError,
} from '../src/summarizer.js';

describe('buildCodexSummarizerCommand', () => {
  it('starts the Codex app-server so the summarizer can fork ephemerally', () => {
    const command = buildCodexSummarizerCommand({
      sessionId: '019e4c75-d5bf-7c71-9df7-77f5fb86b711',
      model: 'gpt-5.2',
      prompt: 'Summarize this conversation.',
      codexBin: 'codex'
    });

    expect(command).toEqual({
      command: 'codex',
      args: ['app-server'],
      prompt: 'Summarize this conversation.',
      sessionId: '019e4c75-d5bf-7c71-9df7-77f5fb86b711',
      model: 'gpt-5.2'
    });
  });
});

describe('runCodexCommand', () => {
  it('forks the session ephemerally and returns the completed agent message', async () => {
    const fakeAppServer = `
      const readline = require('readline');
      const rl = readline.createInterface({ input: process.stdin });
      rl.on('line', line => {
        const message = JSON.parse(line);
        if (message.method === 'initialize') {
          console.log(JSON.stringify({ id: message.id, result: { userAgent: 'fake', codexHome: '/tmp/codex', platformFamily: 'unix', platformOs: 'macos' } }));
          return;
        }
        if (message.method === 'initialized') return;
        if (message.method === 'thread/fork') {
          if (message.params.threadId !== 'session-123') throw new Error('wrong session id');
          if (message.params.ephemeral !== true) throw new Error('fork was not ephemeral');
          if (message.params.sandbox !== 'read-only') throw new Error('fork was not read-only');
          console.log(JSON.stringify({ id: message.id, result: { thread: { id: 'fork-456' } } }));
          return;
        }
        if (message.method === 'turn/start') {
          if (message.params.threadId !== 'fork-456') throw new Error('turn did not target fork');
          if (!message.params.input[0].text.includes('Summarize this conversation')) throw new Error('wrong prompt');
          console.log(JSON.stringify({ id: message.id, result: { turn: { id: 'turn-789', status: 'inProgress' } } }));
          console.log(JSON.stringify({ method: 'item/agentMessage/delta', params: { delta: '<summary>Codex fork summary.</summary>' } }));
          console.log(JSON.stringify({ method: 'turn/completed', params: { turn: { id: 'turn-789', status: 'completed' } } }));
        }
      });
    `;

    const result = await runCodexCommand({
      command: process.execPath,
      args: ['-e', fakeAppServer],
      sessionId: 'session-123',
      prompt: 'Summarize this conversation.',
      skipVersionCheck: true,
    });

    expect(result).toBe('<summary>Codex fork summary.</summary>');
  });

  it('rejects Codex versions below the production support floor before starting app-server', async () => {
    await expect(runCodexCommand({
      command: process.execPath,
      versionArgs: ['-e', "console.log('codex-cli 0.129.9')"],
      args: ['-e', 'setTimeout(() => {}, 1000)'],
      sessionId: 'session-123',
      prompt: 'Summarize this conversation.',
    })).rejects.toThrow(/requires codex-cli >= 0\.130\.0; found 0\.129\.9/);
  });

  it('reports malformed app-server fork responses clearly', async () => {
    const fakeAppServer = `
      const readline = require('readline');
      const rl = readline.createInterface({ input: process.stdin });
      rl.on('line', line => {
        const message = JSON.parse(line);
        if (message.method === 'initialize') {
          console.log(JSON.stringify({ id: message.id, result: {} }));
          return;
        }
        if (message.method === 'initialized') return;
        if (message.method === 'thread/fork') {
          console.log(JSON.stringify({ id: message.id, result: {} }));
        }
      });
    `;

    await expect(runCodexCommand({
      command: process.execPath,
      args: ['-e', fakeAppServer],
      sessionId: 'session-123',
      prompt: 'Summarize this conversation.',
      skipVersionCheck: true,
    })).rejects.toThrow(/thread\/fork returned unexpected response/);
  });
});

describe('buildCodexSummaryPrompt', () => {
  it('instructs Codex to summarize from forked session context without inspecting files', () => {
    const prompt = buildCodexSummaryPrompt();

    expect(prompt).toContain('ephemeral Codex fork');
    expect(prompt).toContain('reasoning');
    expect(prompt).toContain('Do not inspect files');
    expect(prompt).toContain('<summary>');
  });
});

describe('getApiEnv', () => {
  afterEach(() => {
    delete process.env.EPISODIC_MEMORY_API_BASE_URL;
    delete process.env.EPISODIC_MEMORY_API_TOKEN;
    delete process.env.EPISODIC_MEMORY_API_TIMEOUT_MS;
  });

  it('always sets EPISODIC_MEMORY_SUMMARIZER_GUARD so the SDK subprocess can detect reentrancy (#87)', () => {
    const env = getApiEnv()!;
    expect(env.EPISODIC_MEMORY_SUMMARIZER_GUARD).toBe('1');
  });

  it('routes ANTHROPIC_BASE_URL through to the SDK env when EPISODIC_MEMORY_API_BASE_URL is set', () => {
    process.env.EPISODIC_MEMORY_API_BASE_URL = 'https://example.invalid';
    const env = getApiEnv()!;
    expect(env.ANTHROPIC_BASE_URL).toBe('https://example.invalid');
  });

  it('routes auth token and timeout through to the SDK env', () => {
    process.env.EPISODIC_MEMORY_API_TOKEN = 'tok-test';
    process.env.EPISODIC_MEMORY_API_TIMEOUT_MS = '12345';
    const env = getApiEnv()!;
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('tok-test');
    expect(env.API_TIMEOUT_MS).toBe('12345');
  });
});

describe('shouldSkipReentrantSync', () => {
  afterEach(() => {
    delete process.env.EPISODIC_MEMORY_SUMMARIZER_GUARD;
  });

  it('returns true when EPISODIC_MEMORY_SUMMARIZER_GUARD is set to "1"', () => {
    process.env.EPISODIC_MEMORY_SUMMARIZER_GUARD = '1';
    expect(shouldSkipReentrantSync()).toBe(true);
  });

  it('returns false when the guard env is unset', () => {
    delete process.env.EPISODIC_MEMORY_SUMMARIZER_GUARD;
    expect(shouldSkipReentrantSync()).toBe(false);
  });

  it('returns false when the guard env is set to anything other than "1"', () => {
    process.env.EPISODIC_MEMORY_SUMMARIZER_GUARD = '0';
    expect(shouldSkipReentrantSync()).toBe(false);
    process.env.EPISODIC_MEMORY_SUMMARIZER_GUARD = 'true';
    expect(shouldSkipReentrantSync()).toBe(false);
  });
});

describe('isSdkErrorResult (#regression: 1.4.6 "SDK error: success")', () => {
  it('does NOT flag a success result even when is_error is true', () => {
    // SDK 0.3.142: a subtype:'success' result can carry is_error:true on an
    // otherwise completed turn; its result text is usable and must be kept.
    expect(isSdkErrorResult({ type: 'result', subtype: 'success', is_error: true, result: 'ok' })).toBe(false);
    expect(isSdkErrorResult({ type: 'result', subtype: 'success', is_error: false, result: 'ok' })).toBe(false);
  });

  it('flags real error subtypes', () => {
    expect(isSdkErrorResult({ type: 'result', subtype: 'error_during_execution', is_error: true })).toBe(true);
    expect(isSdkErrorResult({ type: 'result', subtype: 'error_max_turns', is_error: true })).toBe(true);
  });

  it('ignores non-result/partial messages with no subtype', () => {
    expect(isSdkErrorResult({ type: 'assistant' })).toBe(false);
    expect(isSdkErrorResult(null)).toBe(false);
    expect(isSdkErrorResult(undefined)).toBe(false);
  });
});

describe('isResumeFailure', () => {
  it('is true only for error_during_execution SummarizerSdkError', () => {
    expect(isResumeFailure(new SummarizerSdkError('error_during_execution', 's1'))).toBe(true);
    expect(isResumeFailure(new SummarizerSdkError('error_max_turns', 's1'))).toBe(false);
    expect(isResumeFailure(new Error('error_during_execution'))).toBe(false);
  });
});
