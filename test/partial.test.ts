import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  partialPathFor,
  loadPartial,
  savePartial,
  clearPartial,
} from '../src/partial.js';

let tmpDir: string;
let jsonl: string;
let partialPath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'em-partial-'));
  jsonl = path.join(tmpDir, 'session-abc.jsonl');
  partialPath = partialPathFor(jsonl);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('partial', () => {
  it('partialPathFor swaps .jsonl for -summary.partial.json', () => {
    expect(partialPath).toBe(path.join(tmpDir, 'session-abc-summary.partial.json'));
  });

  it('loadPartial returns [] when file missing', () => {
    expect(loadPartial(partialPath, 5, 40)).toEqual([]);
  });

  it('saves and reloads partial state', () => {
    savePartial(partialPath, 5, ['a', 'b'], 40);
    expect(loadPartial(partialPath, 5, 40)).toEqual(['a', 'b']);
  });

  it('invalidates on totalChunks mismatch', () => {
    savePartial(partialPath, 5, ['a', 'b'], 40);
    expect(loadPartial(partialPath, 6, 40)).toEqual([]);
  });

  it('invalidates on totalExchanges mismatch (conversation grew)', () => {
    savePartial(partialPath, 5, ['a', 'b'], 40);
    expect(loadPartial(partialPath, 5, 48)).toEqual([]);
  });

  it('invalidates corrupt JSON', () => {
    fs.writeFileSync(partialPath, '{not json');
    expect(loadPartial(partialPath, 5, 40)).toEqual([]);
  });

  it('invalidates wrong schema version', () => {
    fs.writeFileSync(partialPath, JSON.stringify({
      version: 999,
      totalChunks: 5,
      chunkSummaries: ['a'],
      totalExchanges: 40,
      lastUpdated: 'x',
    }));
    expect(loadPartial(partialPath, 5, 40)).toEqual([]);
  });

  it('clearPartial removes the file', () => {
    savePartial(partialPath, 5, ['a'], 40);
    expect(fs.existsSync(partialPath)).toBe(true);
    clearPartial(partialPath);
    expect(fs.existsSync(partialPath)).toBe(false);
  });

  it('clearPartial is no-op when file missing', () => {
    expect(() => clearPartial(partialPath)).not.toThrow();
  });
});
