import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, readdirSync, type Dirent } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { findJsonlFiles, entryIsDirectory, entryIsJsonlFile } from '../src/paths.js';

// ~/.claude/projects and the archive are often symlinked into a dotfiles repo.
// A bare Dirent.isFile()/isDirectory() is false for symlinks, so the walker
// would silently skip symlinked transcripts and project dirs. These tests lock
// in that findJsonlFiles follows symlinks (and doesn't loop on cycles).
describe('findJsonlFiles with symlinks', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'em-symlink-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('finds a real .jsonl file', () => {
    writeFileSync(join(root, 'a.jsonl'), '{}');
    expect(findJsonlFiles(root)).toEqual(['a.jsonl']);
  });

  it('follows a symlinked project directory', () => {
    // Real transcripts live outside the walked tree; the project dir is a link.
    const realProject = mkdtempSync(join(tmpdir(), 'em-realproj-'));
    writeFileSync(join(realProject, 'conv.jsonl'), '{}');
    symlinkSync(realProject, join(root, 'proj'));

    const found = findJsonlFiles(root);
    expect(found).toContain(join('proj', 'conv.jsonl'));

    rmSync(realProject, { recursive: true, force: true });
  });

  it('follows a symlinked .jsonl file', () => {
    const realFile = join(mkdtempSync(join(tmpdir(), 'em-realfile-')), 'src.jsonl');
    writeFileSync(realFile, '{}');
    symlinkSync(realFile, join(root, 'linked.jsonl'));

    expect(findJsonlFiles(root)).toContain('linked.jsonl');
  });

  it('does not infinitely recurse on a symlink cycle', () => {
    const sub = join(root, 'sub');
    mkdirSync(sub);
    writeFileSync(join(sub, 'x.jsonl'), '{}');
    // sub/loop -> root  (cycle). Must terminate and still find x.jsonl once.
    symlinkSync(root, join(sub, 'loop'));

    const found = findJsonlFiles(root);
    expect(found).toContain(join('sub', 'x.jsonl'));
    // No duplicate explosion from the cycle.
    expect(found.filter(f => f.endsWith('x.jsonl')).length).toBe(1);
  });

  it('entryIsDirectory / entryIsJsonlFile resolve symlinks', () => {
    const realDir = mkdtempSync(join(tmpdir(), 'em-rd-'));
    const realFile = join(mkdtempSync(join(tmpdir(), 'em-rf-')), 'f.jsonl');
    writeFileSync(realFile, '{}');
    symlinkSync(realDir, join(root, 'dlink'));
    symlinkSync(realFile, join(root, 'flink.jsonl'));

    const byName = Object.fromEntries(
      readdirSync(root, { withFileTypes: true }).map((e: Dirent) => [e.name, e])
    );
    expect(entryIsDirectory(root, byName['dlink'])).toBe(true);
    expect(entryIsJsonlFile(root, byName['flink.jsonl'])).toBe(true);

    rmSync(realDir, { recursive: true, force: true });
  });

  it('treats a broken symlink as neither dir nor file', () => {
    symlinkSync(join(root, 'does-not-exist'), join(root, 'broken.jsonl'));
    // Must not throw; broken link contributes nothing.
    expect(findJsonlFiles(root)).toEqual([]);
  });
});
