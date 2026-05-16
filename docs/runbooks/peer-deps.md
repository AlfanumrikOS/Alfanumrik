# Peer Dependencies — Don't Prune the @opentelemetry/* Set

## Incident: PR #779 → #784 (May 2026)

PR [#779](https://github.com/AlfanumrikOS/Alfanumrik/pull/779) attempted a
routine dependency cleanup and removed four `@opentelemetry/*` packages
from `dependencies`:

- `@opentelemetry/api`
- `@opentelemetry/core`
- `@opentelemetry/instrumentation`
- `@opentelemetry/sdk-trace-base`

A grep of `src/` and `supabase/functions/` showed no direct imports of any
of them, so they looked safe to remove. Local `next dev` continued working
after the prune. CI passed. The PR merged.

**Every Vercel cold deploy then broke for the next six PRs (#779–#783)**
until the hotfix landed in PR
[#784](https://github.com/AlfanumrikOS/Alfanumrik/pull/784) restoring all
four packages.

## Root cause: silent peer-dependencies

The four packages are listed as peer-dependencies of `@sentry/node-core`
(a transitive of `@sentry/nextjs`), marked `optional: true` in
`peerDependenciesMeta`. Two npm behaviors combined to hide this:

1. **npm v7+ does not auto-install peer-deps.** Unlike npm v3–v6, the
   consuming package must list peer-deps in its own `dependencies` for
   them to land in `node_modules`. Optional peers stay silently absent if
   not explicitly declared.
2. **Local `npm install` is warm-cached.** When a dependency was
   previously installed (e.g. before the prune), npm leaves its files in
   `node_modules` even after the corresponding `dependencies` entry is
   removed. Re-running `next dev` finds them and works fine. A real cold
   install (`rm -rf node_modules && npm ci`) — which is what Vercel does
   on every deploy — surfaces the missing peers as a require throw deep
   inside the Sentry boot path.

The end result: a change that looked clean locally and in CI failed every
production deploy.

## The guard (Phase E.7)

Two layers, both new in this phase:

- **`scripts/check-peer-deps.js`** — runs `npm ls` for each peer in the
  list above and fails if any are absent. Then does a sub-process
  `require('./next.config.js')` to replay Vercel's cold-boot path. Wired
  into `package.json` as `npm run check:peer-deps`.
- **`.github/workflows/peer-deps-guard.yml`** — on every PR touching
  `package.json`, `package-lock.json`, `next.config.js`, or the guard
  itself: `rm -rf node_modules && npm ci && node scripts/check-peer-deps.js`.
  The fresh install is the load-bearing part; it's what `next dev` was
  failing to do locally.

There is also a CLAUDE.md memory entry,
`feedback_npm_peer_deps_pitfall.md`, that prevents the assistant from
re-pruning these packages. The CI guard is independent — it catches a
human or future agent doing the same prune.

## If this guard fails on your PR

1. **Don't bypass it.** A failure means a peer-dep is missing or
   `next.config.js` no longer boots cold. Vercel will fail too.
2. **Look at what changed in `package.json` or `package-lock.json`.** If
   you removed an `@opentelemetry/*`, `@sentry/*`, or any package whose
   transitive declares peer-deps, restore it.
3. **If you need a new peer added to the check**, edit
   `REQUIRED_PEERS` in `scripts/check-peer-deps.js` and verify the source
   peer-dep declaration with:
   ```bash
   node -e "console.log(require('@sentry/node-core/package.json').peerDependencies)"
   ```
   Update the array and the `PEER_OF` constant.

## Why optional peers are still required for us

`@sentry/node-core`'s `peerDependenciesMeta` marks the OTel packages as
`optional`, meaning Sentry works without them in light mode. We use the
full Sentry instrumentation in `sentry.server.config.ts` and
`next.config.js` (`withSentryConfig`), which **does** pull in the OTel
code path. So for us they are functionally required — we just have to
declare them ourselves because npm won't.

## Related

- [`Production audit (Phase B.3)`](./audit-production-readiness.md)
- [`Sentry alert setup`](./sentry-alert-setup.md)
- CLAUDE.md memory: `feedback_npm_peer_deps_pitfall.md`
