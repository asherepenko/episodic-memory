/**
 * Groups project dirs so a repo and its git worktrees show as one row.
 *
 * Claude names a project dir after its cwd with every non-alphanumeric char
 * turned into "-", so "/repo/.worktrees/x" and "/repo__worktrees/x" both end
 * up as "repo--worktrees-x". A shared worktrees dir ("/org/worktrees/repo-x")
 * becomes "org-worktrees-repo-x", which can only be tied back to "org-repo"
 * by matching against project names that actually exist.
 */

export interface ProjectMember {
  project: string;
  /** Source dir holding the live transcripts; absent for archive-only projects. */
  sourceDir?: string;
}

export interface ProjectGroup {
  key: string;
  members: ProjectMember[];
  /** Members that are worktrees of `key` rather than `key` itself. */
  worktrees: number;
}

const WORKTREE_SEGMENT = /^(.+?)--(?:claude-|codex-)?worktrees(?:-|$)/;

export function worktreeParent(name: string, known: ReadonlySet<string>): string | undefined {
  const direct = name.match(WORKTREE_SEGMENT);
  if (direct) return direct[1];

  if (!name.includes('-worktrees-')) return undefined;
  const collapsed = name.replace('-worktrees-', '-');
  let best: string | undefined;
  for (const candidate of known) {
    if (candidate === name || !collapsed.startsWith(candidate + '-')) continue;
    if (!best || candidate.length > best.length) best = candidate;
  }
  // Only the org dir matched ("org-worktrees-…" → "org"): too vague to fold.
  if (best && name.startsWith(best + '-worktrees-')) return undefined;
  return best;
}

export function groupProjects(members: ProjectMember[]): ProjectGroup[] {
  const known = new Set(members.map(m => m.project).filter(p => worktreeParent(p, new Set()) === undefined));
  const groups = new Map<string, ProjectGroup>();
  for (const member of members) {
    const key = worktreeParent(member.project, known) ?? member.project;
    let group = groups.get(key);
    if (!group) {
      group = { key, members: [], worktrees: 0 };
      groups.set(key, group);
    }
    group.members.push(member);
    if (member.project !== key) group.worktrees++;
  }
  return [...groups.values()].sort((a, b) => a.key.localeCompare(b.key));
}
