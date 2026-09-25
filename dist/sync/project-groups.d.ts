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
export declare function worktreeParent(name: string, known: ReadonlySet<string>): string | undefined;
export declare function groupProjects(members: ProjectMember[]): ProjectGroup[];
