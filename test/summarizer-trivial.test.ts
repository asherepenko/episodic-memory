import { describe, it, expect } from 'vitest';
import { detectTrivial } from '../src/summarizer.js';
import type { ConversationExchange } from '../src/types.js';

function ex(user: string, assistant: string): ConversationExchange {
  return {
    id: 'x',
    project: 'p',
    timestamp: new Date().toISOString(),
    archivePath: '/x.jsonl',
    lineStart: 1,
    lineEnd: 2,
    userMessage: user,
    assistantMessage: assistant,
  };
}

describe('detectTrivial', () => {
  it('returns trivial for empty exchanges', () => {
    expect(detectTrivial([])).toMatch(/Trivial/);
  });

  it('flags slash-command-only conversations', () => {
    const exchanges = [ex('/clear', 'Cleared.'), ex('/exit', 'Bye.')];
    expect(detectTrivial(exchanges)).toMatch(/slash-commands|acknowledgements/i);
  });

  it('flags ack-only conversations', () => {
    const exchanges = [ex('ok', 'Done.'), ex('thanks', 'You bet.')];
    expect(detectTrivial(exchanges)).toMatch(/slash-commands|acknowledgements/i);
  });

  it('flags conversations under 500 chars on both sides', () => {
    const exchanges = [ex('Add a button', 'Added.')];
    expect(detectTrivial(exchanges)).toMatch(/minimal/i);
  });

  it('flags conversations with no assistant output', () => {
    const longUser = 'Tell me about everything in great detail. '.repeat(30);
    const exchanges = [ex(longUser, '')];
    expect(detectTrivial(exchanges)).toMatch(/no assistant output|minimal/i);
  });

  it('returns null for substantive conversations', () => {
    const longUser = 'Implement a JWT authentication system with refresh tokens. '.repeat(20);
    const longAssistant = 'I will build an auth context that handles login, logout, refresh, and protected routes. '.repeat(20);
    const exchanges = [ex(longUser, longAssistant)];
    expect(detectTrivial(exchanges)).toBeNull();
  });
});
