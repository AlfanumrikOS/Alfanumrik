/**
 * agents/runtime/env.ts — load .env.local into process.env at runtime entry.
 *
 * The mesh runtime needs ANTHROPIC_API_KEY, SUPABASE_URL, and
 * SUPABASE_SERVICE_ROLE_KEY. The project's house secret-store is Vercel
 * (production) + .env.local (developer machines). The standard workflow:
 *
 *   $ vercel env pull .env.local --environment=development
 *
 * That populates .env.local with every var Vercel knows about. From then
 * on, every `npm run mesh:tick` run sees them via process.env, courtesy
 * of this loader.
 *
 * We deliberately do NOT pull `dotenv` as a dep — it's 20 lines and the
 * surface area we need is tiny. Behaviour:
 *   - Read .env.local from repo root (if it exists).
 *   - Parse KEY=VALUE per line, # comments allowed, blank lines skipped.
 *   - VALUE can be wrapped in single or double quotes; otherwise the raw
 *     text after `=` is used (trimmed).
 *   - DOES NOT overwrite variables already set in process.env — the
 *     ambient environment wins, so CI or one-off `ANTHROPIC_API_KEY=...`
 *     prefixes still work.
 *   - Falls back to .env if .env.local doesn't exist.
 *   - Silent on missing files; explicit on parse errors (returns line
 *     numbers so the user can fix .env.local).
 */

import fs from 'node:fs';
import path from 'node:path';

export interface LoadEnvResult {
  loadedFrom: string | null;
  varsSet: number;
  parseErrors: string[];
}

/**
 * Parse the contents of a .env file into an object. Exposed so unit
 * tests can pin down the (small) parsing surface without filesystem.
 */
export function parseDotenv(text: string): { vars: Record<string, string>; errors: string[] } {
  const vars: Record<string, string> = {};
  const errors: string[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    // Strip leading `export ` (some env files use it for shell compat).
    const stripped = line.replace(/^export\s+/, '');
    const eq = stripped.indexOf('=');
    if (eq <= 0) {
      errors.push(`Line ${i + 1}: missing or misplaced '=' in ${JSON.stringify(line.slice(0, 60))}`);
      continue;
    }
    const key = stripped.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      errors.push(`Line ${i + 1}: invalid var name ${JSON.stringify(key)}`);
      continue;
    }
    let value = stripped.slice(eq + 1).trim();
    // Strip inline comments only when value is unquoted — a quoted value
    // with a # inside is literal.
    if (!/^(['"])/.test(value)) {
      const hashIdx = value.indexOf(' #');
      if (hashIdx >= 0) value = value.slice(0, hashIdx).trim();
    }
    // Unquote if wrapped.
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    vars[key] = value;
  }
  return { vars, errors };
}

export function loadDotenv(repoRoot: string): LoadEnvResult {
  const candidates = [path.join(repoRoot, '.env.local'), path.join(repoRoot, '.env')];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    const { vars, errors } = parseDotenv(text);
    let varsSet = 0;
    for (const [k, v] of Object.entries(vars)) {
      // Treat empty strings as "unset" so .env.local can fill them. Some
      // host environments (Claude Code's bash sandbox among them)
      // explicitly set sensitive vars to '' to hide their own credentials
      // from child processes; we want our .env.local value to win there.
      const cur = process.env[k];
      if (cur === undefined || cur === '') {
        process.env[k] = v;
        varsSet++;
      }
    }
    return { loadedFrom: file, varsSet, parseErrors: errors };
  }
  return { loadedFrom: null, varsSet: 0, parseErrors: [] };
}
