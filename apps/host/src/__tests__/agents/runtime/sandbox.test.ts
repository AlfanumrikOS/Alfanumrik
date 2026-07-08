import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  compileGlob,
  resolveInside,
  assertPathAllowed,
  safeReadFile,
  safeWriteFile,
  safeListFiles,
  SandboxError,
} from '../../../../agents/runtime/sandbox';

/**
 * Sandbox tests — these are P0. A bug here = the L4 agent could escape
 * its allowed_paths and breach rubric §R2. Every must-reject case is
 * pinned down explicitly.
 *
 * We use a real tmp dir as the worktree so resolveInside / realpath /
 * directory traversal behave authentically. No mocks.
 */

let root: string;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(tmpdir(), 'mesh-sandbox-test-'));
  await fs.mkdir(path.join(root, 'src', 'app', 'teacher'), { recursive: true });
  await fs.mkdir(path.join(root, 'src', 'app', 'parent'), { recursive: true });
  await fs.mkdir(path.join(root, 'supabase', 'migrations'), { recursive: true });
  await fs.writeFile(path.join(root, 'src', 'app', 'teacher', 'page.tsx'), 'teacher page');
  await fs.writeFile(path.join(root, 'src', 'app', 'parent', 'page.tsx'), 'parent page');
  await fs.writeFile(path.join(root, 'supabase', 'migrations', '20260101_foo.sql'), 'CREATE TABLE');
});

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const cfgFor = () => ({
  worktreeRoot: root,
  allowedPaths: ['src/app/teacher/**'],
  forbiddenPaths: ['supabase/migrations/**', 'src/app/parent/**'],
});

describe('compileGlob', () => {
  it('matches single segment with *', () => {
    expect(compileGlob('src/*.ts').test('src/foo.ts')).toBe(true);
    expect(compileGlob('src/*.ts').test('src/sub/foo.ts')).toBe(false);
  });
  it('matches across segments with **', () => {
    expect(compileGlob('src/**').test('src/a/b/c.ts')).toBe(true);
    expect(compileGlob('src/**').test('src/foo.ts')).toBe(true);
  });
  it('escapes regex metacharacters in literals', () => {
    expect(compileGlob('foo.bar').test('foo.bar')).toBe(true);
    expect(compileGlob('foo.bar').test('fooXbar')).toBe(false);
  });
});

describe('resolveInside', () => {
  it('resolves a clean relative path', () => {
    const r = resolveInside(cfgFor(), 'src/app/teacher/page.tsx');
    expect(r).toBe(path.resolve(root, 'src/app/teacher/page.tsx'));
  });

  it('rejects absolute paths', () => {
    expect(() => resolveInside(cfgFor(), '/etc/passwd'))
      .toThrow(SandboxError);
  });

  it('rejects ../.. traversal that escapes root', () => {
    expect(() => resolveInside(cfgFor(), '../../etc/passwd'))
      .toThrow(SandboxError);
  });

  it('allows .. that stays inside root', () => {
    // src/app/teacher/../parent stays under root, but assertPathAllowed will
    // still gate it. resolveInside only enforces the boundary.
    const r = resolveInside(cfgFor(), 'src/app/teacher/../parent/page.tsx');
    expect(r).toBe(path.resolve(root, 'src/app/parent/page.tsx'));
  });

  // `C:\\...` is absolute on Windows (path.isAbsolute returns true) and our
  // guard throws OUTSIDE_ROOT. On POSIX (CI runs Ubuntu) the same string is
  // a relative path with literal backslashes; resolveInside resolves it to
  // a path inside root that the allowed_paths/forbidden_paths layer catches
  // — but the per-layer rejection happens in assertPathAllowed, not here.
  // Scope this test to Windows where its specific claim holds.
  const onWindows = process.platform === 'win32';
  it.skipIf(!onWindows)('rejects Windows-style absolute paths (Windows only)', () => {
    expect(() => resolveInside(cfgFor(), 'C:\\Windows\\System32\\drivers\\etc\\hosts'))
      .toThrow();
  });
});

describe('assertPathAllowed', () => {
  it('allows a path inside the allowlist', () => {
    expect(() => assertPathAllowed(cfgFor(), 'src/app/teacher/page.tsx')).not.toThrow();
  });

  it('rejects a path on the forbidden list (even if also in allowlist via glob overlap)', () => {
    const cfg = {
      ...cfgFor(),
      allowedPaths: ['src/**'],
      forbiddenPaths: ['src/app/parent/**'],
    };
    expect(() => assertPathAllowed(cfg, 'src/app/parent/page.tsx'))
      .toThrowError(/forbidden/i);
  });

  it('rejects a path outside the allowlist', () => {
    expect(() => assertPathAllowed(cfgFor(), 'docs/whatever.md'))
      .toThrowError(/not in allowed_paths/);
  });

  it('rejects sneaky escape via .. that lands in forbidden territory', () => {
    expect(() => assertPathAllowed(cfgFor(), 'src/app/teacher/../parent/page.tsx'))
      .toThrowError(/forbidden|not in allowed/i);
  });

  it('rejects sneaky escape via .. into supabase/migrations', () => {
    expect(() => assertPathAllowed(cfgFor(), 'src/app/teacher/../../../supabase/migrations/x.sql'))
      .toThrow(SandboxError);
  });
});

describe('safeReadFile', () => {
  it('reads a file inside the allowlist', async () => {
    const txt = await safeReadFile(cfgFor(), 'src/app/teacher/page.tsx');
    expect(txt).toBe('teacher page');
  });

  it('throws NOT_FOUND for a missing path', async () => {
    await expect(safeReadFile(cfgFor(), 'src/app/teacher/missing.tsx'))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('refuses a forbidden path even if it exists', async () => {
    await expect(safeReadFile(cfgFor(), 'supabase/migrations/20260101_foo.sql'))
      .rejects.toThrow(SandboxError);
  });
});

describe('safeWriteFile', () => {
  it('writes inside the allowlist', async () => {
    await safeWriteFile(cfgFor(), 'src/app/teacher/new-file.tsx', 'hello');
    const txt = await fs.readFile(path.join(root, 'src/app/teacher/new-file.tsx'), 'utf8');
    expect(txt).toBe('hello');
  });

  it('creates parent directories on demand', async () => {
    await safeWriteFile(cfgFor(), 'src/app/teacher/nested/deeper/x.ts', 'x');
    const txt = await fs.readFile(path.join(root, 'src/app/teacher/nested/deeper/x.ts'), 'utf8');
    expect(txt).toBe('x');
  });

  it('refuses to write outside the allowlist', async () => {
    await expect(safeWriteFile(cfgFor(), 'docs/note.md', 'no'))
      .rejects.toThrowError(/not in allowed_paths/);
  });

  it('refuses to write into a forbidden path', async () => {
    await expect(safeWriteFile(cfgFor(), 'supabase/migrations/20260601_evil.sql', 'DROP TABLE'))
      .rejects.toThrowError(/forbidden/i);
  });

  it('refuses an absolute path', async () => {
    await expect(safeWriteFile(cfgFor(), '/tmp/exfil', 'oops'))
      .rejects.toThrow(SandboxError);
  });
});

describe('safeListFiles', () => {
  it('returns only files matching the allowlist', async () => {
    const list = await safeListFiles(cfgFor(), '.');
    // Should include teacher files. Should NOT include parent or migrations.
    expect(list.some(p => p.startsWith('src/app/teacher/'))).toBe(true);
    expect(list.every(p => !p.startsWith('src/app/parent/'))).toBe(true);
    expect(list.every(p => !p.startsWith('supabase/migrations/'))).toBe(true);
  });
});
