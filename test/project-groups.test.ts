import { describe, expect, it } from 'vitest';
import { groupProjects, worktreeParent } from '../src/sync/project-groups.js';

const H = '-Users-andrew-Projects-work-pray-com';

describe('worktreeParent', () => {
  it('splits at a --worktrees segment (.worktrees, __worktrees)', () => {
    expect(worktreeParent(`${H}-faas--worktrees-pr-review`, new Set())).toBe(`${H}-faas`);
    expect(worktreeParent(`${H}-client-mobile-new-ios--worktrees`, new Set())).toBe(`${H}-client-mobile-new-ios`);
    expect(worktreeParent(`${H}-client-mobile-android--worktrees-pr-review--worktrees-feature-x`, new Set())).toBe(`${H}-client-mobile-android`);
    expect(worktreeParent('-Users-andrew-dotfiles--claude-worktrees-probe', new Set())).toBe('-Users-andrew-dotfiles');
  });

  it('maps a shared worktrees dir to the known project it belongs to', () => {
    const known = new Set([`${H}`, `${H}-client-mobile-android`, `${H}-server-pray`]);
    expect(worktreeParent(`${H}-worktrees-client-mobile-android-feature-pb-36165-daily-series`, known)).toBe(`${H}-client-mobile-android`);
    expect(worktreeParent(`${H}-worktrees-server-pray-initiative-search`, known)).toBe(`${H}-server-pray`);
  });

  it('leaves ordinary projects alone', () => {
    const known = new Set([`${H}`, `${H}-client-web`]);
    expect(worktreeParent(`${H}-client-web`, known)).toBeUndefined();
    expect(worktreeParent(`${H}-worktrees-unknown-repo-x`, known)).toBeUndefined();
  });
});

describe('groupProjects', () => {
  it('folds worktrees into their parent across sources and counts them', () => {
    const groups = groupProjects([
      { project: `${H}-faas`, sourceDir: '/claude' },
      { project: `${H}-faas--worktrees-pr-review` },
      { project: `${H}-faas--worktrees-open-search` },
      { project: `${H}-client-web`, sourceDir: '/claude' },
    ]);

    expect(groups).toEqual([
      { key: `${H}-client-web`, members: [{ project: `${H}-client-web`, sourceDir: '/claude' }], worktrees: 0 },
      {
        key: `${H}-faas`,
        members: [
          { project: `${H}-faas`, sourceDir: '/claude' },
          { project: `${H}-faas--worktrees-pr-review` },
          { project: `${H}-faas--worktrees-open-search` },
        ],
        worktrees: 2,
      },
    ]);
  });

  it('creates a group for worktrees whose main checkout was never synced', () => {
    const groups = groupProjects([{ project: `${H}-faas--worktrees-pr-review` }]);
    expect(groups).toEqual([
      { key: `${H}-faas`, members: [{ project: `${H}-faas--worktrees-pr-review` }], worktrees: 1 },
    ]);
  });
});
