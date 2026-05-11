/**
 * agents/runtime/sandbox.ts — path-scoped file ops for the L4 swarm.
 *
 * The L4 worker hands these helpers to Claude via tool use. Every file
 * the agent reads or writes goes through here. The single invariant
 * this module enforces:
 *
 *   No file op resolves to a path outside the worktree root, AND every
 *   target path matches at least one allowed glob and no forbidden glob.
 *
 * This is the firewall implementing rubric §R2 (blast-radius). Bugs here
 * are P0; the unit tests in src/__tests__/agents/runtime/sandbox.test.ts
 * pin down the must-reject cases (traversal, absolute-path escape,
 * forbidden-path matches that look innocent).
 *
 * Symlinks: we resolve with fs.realpath on read and on write-target
 * directory. A symlink whose target is outside the worktree → rejected.
 *
 * Note: globs are compiled in-house with a small subset of features
 * (`*`, `**`, exact). We do NOT pull in a glob library: every dep in
 * this folder must be auditable inside one file.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface SandboxConfig {
  /** Absolute path to the worktree root. Every resolved path must live under this. */
  worktreeRoot: string;
  /** Glob list (relative to worktreeRoot) — at least one must match the target. */
  allowedPaths: string[];
  /** Glob list (relative to worktreeRoot) — any match is a hard reject. */
  forbiddenPaths: string[];
}

export class SandboxError extends Error {
  constructor(message: string, public readonly code: 'OUTSIDE_ROOT' | 'NOT_ALLOWED' | 'FORBIDDEN' | 'NOT_FOUND' | 'SYMLINK_ESCAPE') {
    super(message);
    this.name = 'SandboxError';
  }
}

// ─── Glob → RegExp (small in-house compiler) ──────────────────────────

/** Compile a POSIX-style glob (subset: `*`, `**`, literals) to a RegExp. */
export function compileGlob(glob: string): RegExp {
  // Normalise to forward slashes for matching, drop leading ./
  let g = glob.replace(/\\/g, '/').replace(/^\.\//, '');
  // Anchor
  let re = '^';
  let i = 0;
  while (i < g.length) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') {
        // `**` matches any number of path segments (including zero).
        // Optional trailing slash absorbed if present.
        re += '.*';
        i += 2;
        if (g[i] === '/') i += 1;
      } else {
        // single `*` matches any chars within a segment
        re += '[^/]*';
        i += 1;
      }
    } else if (/[.+^${}()|[\]\\]/.test(c)) {
      re += '\\' + c;
      i += 1;
    } else {
      re += c;
      i += 1;
    }
  }
  re += '$';
  return new RegExp(re);
}

function matchesAny(relPath: string, globs: string[]): boolean {
  const p = relPath.replace(/\\/g, '/');
  for (const g of globs) {
    if (compileGlob(g).test(p)) return true;
  }
  return false;
}

// ─── Path resolution / validation (sync core, used by async helpers) ──

/**
 * Resolve a (possibly relative) path to a real absolute path inside the
 * worktree. Throws SandboxError on any escape. Does NOT check existence.
 *
 * Exposed so the L4 worker can validate paths it received from a tool
 * call before doing anything with them.
 */
export function resolveInside(cfg: SandboxConfig, requested: string): string {
  const root = path.resolve(cfg.worktreeRoot);
  // Reject absolute paths up-front — agent must always provide a relative
  // path. Absolute paths would let the agent name files outside the root
  // by construction.
  if (path.isAbsolute(requested)) {
    throw new SandboxError(
      `Absolute paths are not allowed (got: ${requested}). Use a path relative to the worktree root.`,
      'OUTSIDE_ROOT',
    );
  }
  const joined = path.resolve(root, requested);
  // After resolve, joined might still escape via .. — final check is the
  // relative path from root not starting with .. and not being absolute.
  const rel = path.relative(root, joined);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new SandboxError(
      `Path resolves outside the worktree root: ${requested} → ${joined}`,
      'OUTSIDE_ROOT',
    );
  }
  return joined;
}

/** Check glob lists. Throws SandboxError on rejection. */
export function assertPathAllowed(cfg: SandboxConfig, requested: string): void {
  const root = path.resolve(cfg.worktreeRoot);
  const abs = resolveInside(cfg, requested);
  const rel = path.relative(root, abs).replace(/\\/g, '/');
  if (matchesAny(rel, cfg.forbiddenPaths)) {
    throw new SandboxError(
      `Path is on the forbidden list: ${rel}`,
      'FORBIDDEN',
    );
  }
  if (!matchesAny(rel, cfg.allowedPaths)) {
    throw new SandboxError(
      `Path is not in allowed_paths: ${rel}. Allowed globs: ${cfg.allowedPaths.join(', ')}`,
      'NOT_ALLOWED',
    );
  }
}

// ─── Async file ops (tool surface for the L4 agent) ───────────────────

/**
 * Compare two paths to decide if `child` is contained within `parent`. We
 * realpath BOTH sides so symlinks, case differences (Windows), and
 * intermediate junctions (Windows %TEMP%) don't cause false positives.
 */
async function isInsideReal(parent: string, child: string): Promise<boolean> {
  const realParent = await fs.realpath(parent);
  const realChild = await fs.realpath(child);
  const rel = path.relative(realParent, realChild);
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

export async function safeReadFile(cfg: SandboxConfig, requested: string): Promise<string> {
  assertPathAllowed(cfg, requested);
  const abs = resolveInside(cfg, requested);
  // Symlink check: realpath BOTH the file and the root so case/junction
  // differences (Windows %TEMP%) don't trip a false escape.
  try {
    if (!(await isInsideReal(cfg.worktreeRoot, abs))) {
      const real = await fs.realpath(abs);
      throw new SandboxError(`Symlink escapes worktree: ${requested} → ${real}`, 'SYMLINK_ESCAPE');
    }
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new SandboxError(`File not found: ${requested}`, 'NOT_FOUND');
    }
    if (err instanceof SandboxError) throw err;
    throw err;
  }
  return await fs.readFile(abs, 'utf8');
}

export async function safeWriteFile(
  cfg: SandboxConfig,
  requested: string,
  content: string,
): Promise<void> {
  assertPathAllowed(cfg, requested);
  const abs = resolveInside(cfg, requested);
  // Validate the parent directory's realpath against the realpath of the
  // worktree root — a symlinked dir could otherwise route writes outside.
  const parent = path.dirname(abs);
  try {
    if (!(await isInsideReal(cfg.worktreeRoot, parent))) {
      const realParent = await fs.realpath(parent);
      throw new SandboxError(
        `Parent directory escapes worktree via symlink: ${requested} → ${realParent}`,
        'SYMLINK_ESCAPE',
      );
    }
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      if (err instanceof SandboxError) throw err;
      throw err;
    }
    // Parent doesn't exist yet — we'll create it.
  }
  await fs.mkdir(parent, { recursive: true });
  await fs.writeFile(abs, content, 'utf8');
}

export async function safeListFiles(
  cfg: SandboxConfig,
  requestedDir: string,
): Promise<string[]> {
  // Listing is allowed for any path under the worktree, but the entries
  // returned are filtered down to those that are themselves under at
  // least one allowed_paths glob. This means the agent can probe the
  // tree but cannot see the existence of files outside its scope.
  const abs = resolveInside(cfg, requestedDir);
  const root = path.resolve(cfg.worktreeRoot);
  const entries: string[] = [];
  async function walk(dir: string): Promise<void> {
    let dirents: import('node:fs').Dirent[];
    try {
      dirents = await fs.readdir(dir, { withFileTypes: true });
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }
    for (const e of dirents) {
      const full = path.join(dir, e.name);
      const rel = path.relative(root, full).replace(/\\/g, '/');
      // Skip nested .git and node_modules — never useful for an agent.
      if (e.name === '.git' || e.name === 'node_modules' || e.name === '.next') continue;
      if (e.isDirectory()) {
        await walk(full);
      } else if (e.isFile()) {
        if (matchesAny(rel, cfg.forbiddenPaths)) continue;
        if (!matchesAny(rel, cfg.allowedPaths)) continue;
        entries.push(rel);
      }
    }
  }
  await walk(abs);
  entries.sort();
  return entries;
}
