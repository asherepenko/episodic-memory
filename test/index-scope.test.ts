import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { scanIndexScope } from '../src/indexer.js';

describe('scanIndexScope', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'em-index-scope-'));
    const mk = (rel: string) => { mkdirSync(join(root, rel), { recursive: true }); };
    const jsonl = (rel: string) => writeFileSync(join(root, rel), '{}\n', 'utf-8');

    mk('proj-a'); jsonl('proj-a/s1.jsonl'); jsonl('proj-a/s2.jsonl');
    mk('proj-b'); jsonl('proj-b/s1.jsonl');
    mk('excluded'); jsonl('excluded/s1.jsonl');
    mk('empty');                       // a project dir with no jsonl
    writeFileSync(join(root, 'loose.txt'), 'x', 'utf-8'); // non-dir, ignored
  });

  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it('counts projects and conversations, skipping excluded and empty', () => {
    const scope = scanIndexScope([root], new Set(['excluded']));
    expect(scope.projects).toBe(2);        // proj-a, proj-b (empty + excluded omitted)
    expect(scope.conversations).toBe(3);   // 2 + 1
  });

  it('honors limitToProject', () => {
    const scope = scanIndexScope([root], new Set(), 'proj-a');
    expect(scope.projects).toBe(1);
    expect(scope.conversations).toBe(2);
  });

  it('returns zero for a missing source dir', () => {
    const scope = scanIndexScope([join(root, 'does-not-exist')], new Set());
    expect(scope).toEqual({ projects: 0, conversations: 0 });
  });
});
