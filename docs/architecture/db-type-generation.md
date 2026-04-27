# Database Type Generation

## Why
334 migrations and 175 API routes operate on hand-written types in `src/lib/types.ts`. There is no auto-generation from the Supabase schema, so drift between the database and TypeScript is invisible until runtime. This is one of the three drift surfaces flagged in audit finding F12 as a recurring source of session instability.

The fix: generate `src/types/database.types.ts` directly from the live schema using the Supabase CLI, commit it, and verify it on every PR.

## Files
- `src/types/database.types.ts` — generated file (committed). Header marks it auto-generated.
- `scripts/gen-supabase-types.mjs` — generator + check script. Prepends header, supports `--check` for CI.
- `package.json` scripts: `supabase:gen-types`, `supabase:check-types`.
- `.github/workflows/ci.yml` — verification step in the `quality` job (advisory now).
- `src/lib/types.ts` — hand-written types, **still load-bearing**. Migration to generated types is a follow-up session; do not delete.

## How to use

### After any migration change
```bash
npm run supabase:gen-types
git add src/types/database.types.ts
git commit -m "chore(types): regenerate Supabase types after migration X"
```

### Locally verify
```bash
npm run supabase:check-types
# Exit 0: in sync. Exit 1: stale; run gen-types and commit.
```

### Authentication
The script needs Supabase CLI auth + project context. Two options:
- `supabase login` then `supabase link --project-ref <ref>` (preferred for devs).
- Set `SUPABASE_PROJECT_ID=<ref>` env var (used in CI; bypasses `--linked`).

The project ref for production is the value of the `--project-id` flag — store it as the `SUPABASE_PROJECT_ID` repo secret. The CLI access token goes in `SUPABASE_ACCESS_TOKEN`.

## CI
The `Verify Supabase types are up to date` step in `.github/workflows/ci.yml` (job: `quality`) runs `supabase:check-types` on every push and same-repo PR.

- **Skips** on PRs from forked repos (no secrets) and when secrets are missing.
- **Currently advisory** (`continue-on-error: true`). Flip to blocking by removing that line once the team has run a clean generation locally and verified CI runs are green.

## Troubleshooting
- **`supabase: command not found` in CI**: the step installs the CLI on demand; check the install URL is reachable.
- **`Cannot find project ref`**: run `supabase link --project-ref <ref>` locally, or set `SUPABASE_PROJECT_ID`.
- **Generation fails with SQL errors**: a migration may reference an undefined table or have a syntax error. Run `supabase db lint` to locate.
- **Diff appears on a clean checkout**: line endings — the script normalizes CRLF→LF for comparison; if you still see drift, ensure `.gitattributes` enforces LF for `*.ts`.
- **Many spurious diffs after CLI upgrade**: Supabase CLI sometimes reorders output between versions. Pin the CLI version in CI if this becomes noisy.

## Migration roadmap
1. **Now (this PR)**: generated file committed, CI checks advisory.
2. **Next session**: flip CI step to blocking; add a few high-value routes that import `Database` from the generated file.
3. **Follow-up**: replace ad-hoc types in `src/lib/types.ts` with `Database['public']['Tables'][...]` references, route by route. Keep `types.ts` for app-level domain types not derivable from schema.
