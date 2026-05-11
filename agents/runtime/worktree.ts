/**
 * agents/runtime/worktree.ts — git worktree lifecycle for the L4 swarm.
 *
 * Each L4 execution gets its own worktree so concurrent agents don't
 * clobber each other and the host checkout stays clean. Worktrees live
 * under `.mesh-worktrees/<short-task-id>/` and are pruned on completion.
 *
 * This module is thin on purpose — it shells out to `git worktree` and
 * `git diff` rather than reimplement them. The L4 worker is the only
 * caller; tests for this module exercise the pure helpers (branch name
 * shaping, dirty-check parsing) without invoking real git.
 *
 * Safety notes:
 *   - Worktrees are created from a named baseline (default: 'main') so
 *     an agent never accidentally builds on top of another in-flight
 *     branch.
 *   - We `git push` ONLY if explicitly asked. Phase β default is local-
 *     only; a human reviews the branch before pushing.
 *   - On error, the worktree is pruned. The branch is also deleted if
 *     it has no commits (the only useful state when nothing got built).
 */

import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface WorktreeHandle {
  /** Absolute path to the worktree root. Pass this to the sandbox. */
  root: string;
  /** Git branch the worktree is checked out on. */
  branch: string;
  /** Baseline ref the branch was created from. */
  baseline: string;
  /** Repo root where `git worktree add` was executed. */
  repoRoot: string;
}

export interface OpenWorktreeOptions {
  /** Repo root containing the canonical .git directory. */
  repoRoot: string;
  /** UUID of the task (only the first 8 chars used in branch/dir names). */
  taskId: string;
  /** UUID of the cycle (only the first 8 chars used). */
  cycleId: string;
  /** agent_role from the TaskAssignment, e.g. 'code_agent'. */
  agentRole: string;
  /** Branch/tag/SHA to base the new branch on. Defaults to 'main'. */
  baseline?: string;
}

// ─── Pure helpers (unit-testable) ─────────────────────────────────────

/** Format the canonical mesh branch name. Matches the L2 prompt's example. */
export function meshBranchName(opts: { cycleId: string; agentRole: string; taskId: string }): string {
  const cyc = opts.cycleId.slice(0, 8);
  const tsk = opts.taskId.slice(0, 8);
  // Branch names: hyphens only, no slashes inside ids.
  const role = opts.agentRole.replace(/[^a-z0-9_]/g, '_');
  return `auto/${cyc}/${role}/${tsk}`;
}

/** Format the worktree directory name (always under .mesh-worktrees/). */
export function meshWorktreeDir(repoRoot: string, taskId: string): string {
  return path.join(repoRoot, '.mesh-worktrees', taskId.slice(0, 8));
}

/**
 * Parse `git status --porcelain=v1` output into a count of changed files.
 * Exposed so the L4 worker can sanity-check "agent claims succeeded but
 * produced no diff" — a frequent stub-vs-real divergence.
 */
export function countPorcelain(output: string): number {
  return output
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0).length;
}

// ─── Git shell-out (impure) ──────────────────────────────────────────

function git(repoRoot: string, args: string[]): SpawnSyncReturns<string> {
  // Git is a native binary on every platform — no need to shell out.
  // shell:false keeps args verbatim, so worktree paths containing spaces
  // (e.g. "C:\Users\Bharangpur Primary\...") don't get word-split by cmd.exe.
  return spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    env: process.env,
    shell: false,
  });
}

function assertGitOk(res: SpawnSyncReturns<string>, what: string): void {
  if (res.status !== 0) {
    throw new Error(
      `git ${what} failed (exit=${res.status}): ${(res.stderr || res.stdout || '').trim().slice(0, 500)}`,
    );
  }
}

export async function openWorktree(opts: OpenWorktreeOptions): Promise<WorktreeHandle> {
  const baseline = opts.baseline ?? 'main';
  const branch = meshBranchName({
    cycleId: opts.cycleId,
    agentRole: opts.agentRole,
    taskId: opts.taskId,
  });
  const root = meshWorktreeDir(opts.repoRoot, opts.taskId);

  // Ensure the parent directory exists. `git worktree add` creates the
  // worktree root itself but expects the parent to be present.
  await fs.mkdir(path.dirname(root), { recursive: true });

  // Refuse to clobber an existing worktree dir — that almost certainly
  // means a previous cycle for this task crashed and needs manual GC.
  try {
    await fs.access(root);
    throw new Error(
      `Worktree directory already exists: ${root}. Run \`git worktree remove --force ${root}\` and \`git branch -D ${branch}\` if you're sure.`,
    );
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  assertGitOk(git(opts.repoRoot, ['worktree', 'add', '-b', branch, root, baseline]), 'worktree add');

  // Symlink node_modules so the L5 evaluators (npm test / tsc / eslint /
  // tsx scripts) work inside the worktree without a full `npm ci`. On
  // Windows this becomes a directory junction (no admin needed); on
  // POSIX it's a regular symlink. The 'junction' type arg is ignored on
  // non-Windows per Node docs.
  const hostModules = path.join(opts.repoRoot, 'node_modules');
  const wtModules = path.join(root, 'node_modules');
  if (await pathExists(hostModules) && !(await pathExists(wtModules))) {
    try {
      await fs.symlink(hostModules, wtModules, 'junction');
    } catch (err: unknown) {
      // Non-fatal: evaluators that need node_modules will fail loudly
      // and the critic will catch them as evaluation skipped/fail.
      process.stderr.write(
        `[worktree] WARNING: could not symlink node_modules into worktree: ${(err as Error).message}\n`,
      );
    }
  }

  return { root, branch, baseline, repoRoot: opts.repoRoot };
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export interface CommitResult {
  committed: boolean;
  filesChanged: number;
  sha: string | null;
}

/** Stage everything under the worktree, commit with the given message. */
export function commitAll(h: WorktreeHandle, message: string, author: string): CommitResult {
  // Check dirty state first. Empty diff → don't commit (avoids empty
  // commits cluttering the branch).
  const status = git(h.root, ['status', '--porcelain=v1']);
  assertGitOk(status, 'status');
  const filesChanged = countPorcelain(status.stdout);
  if (filesChanged === 0) return { committed: false, filesChanged: 0, sha: null };

  assertGitOk(git(h.root, ['add', '-A']), 'add');
  const commit = git(h.root, ['commit', '-m', message, '--author', author]);
  assertGitOk(commit, 'commit');
  const rev = git(h.root, ['rev-parse', 'HEAD']);
  assertGitOk(rev, 'rev-parse');
  return { committed: true, filesChanged, sha: rev.stdout.trim() };
}

/** Get the unified diff against the baseline ref. Used by the L6 critic. */
export function diffAgainstBaseline(h: WorktreeHandle): string {
  const res = git(h.root, ['diff', '--no-color', `${h.baseline}...HEAD`]);
  assertGitOk(res, 'diff');
  return res.stdout;
}

export interface CloseWorktreeOptions {
  /** If true AND the branch has no commits, delete the branch entirely. */
  pruneEmptyBranch?: boolean;
}

export async function closeWorktree(h: WorktreeHandle, opts: CloseWorktreeOptions = {}): Promise<void> {
  // Determine commit count on the branch vs baseline to decide cleanup.
  const ahead = git(h.repoRoot, ['rev-list', '--count', `${h.baseline}..${h.branch}`]);
  const commits = ahead.status === 0 ? parseInt(ahead.stdout.trim() || '0', 10) : 0;

  // Remove the worktree (force so dirty state doesn't block cleanup).
  // We always remove; the branch is preserved on the host repo for review.
  git(h.repoRoot, ['worktree', 'remove', '--force', h.root]);

  if (opts.pruneEmptyBranch && commits === 0) {
    git(h.repoRoot, ['branch', '-D', h.branch]);
  }
}
