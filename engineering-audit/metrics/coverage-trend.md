# Coverage Trend

Point-in-time snapshots of platform-health metrics, taken at the end of each audit
cycle's REGRESSION phase. Append a row; never edit historical rows (append-only).

Sources: `.claude/CLAUDE.md`, `.claude/regression-catalog.md`, `vitest.config.ts`,
`scripts/check-bundle-size.mjs`, CI. Mark "to verify" where a number was not freshly
measured in-session.

| Date | Test count | Coverage % | Regression catalog entries | Shared JS kB | Largest page kB | CI status |
|---|---|---|---|---|---|---|
| 2026-06-28 | 2,511 (84 files) | ~37% global (threshold 35%, to verify) | 142 (target 35 — exceeded) | CAP_SHARED_KB cap 280; single-chunk metric ~168.5 (to verify current) | /foxy ~254 (to verify) | to verify (assume green on main) |
| 2026-06-28 (Cycle 1 — auth-onboarding REGRESSION) | +27 new assertions this cycle (10 Deno always-200 + 7 AO-4 vitest + 3-role E2E `test.fixme`-gated + fs-guard); targeted run 940/940 + Deno 10/10 | not re-measured globally this cycle | 144 with REG-177 (P15 `send_auth_email_always_200`) once filed; cap target 35 — exceeded | build PASS — shared **279.7 / 284 kB** (CAP_SHARED_KB) | /foxy still largest, 0 pages > 260 kB | local green; middleware 116.2/120 kB; CI Deno-lane wiring of always-200 suite in flight |

## Notes on the seed row (2026-06-28)
- **Test count** 2,511 / 84 files: from `.claude/CLAUDE.md` testing cell. `CLAUDE.md`
  (root) also cites 175 across 7 files in the release-gates skill — that figure is
  stale; the constitution's 2,511 is the reconciled number. **Verify with `npm test`.**
- **Coverage %**: global threshold is 35% statements (authoritative: `vitest.config.ts`);
  real coverage noted as ~37% in CLAUDE.md TODO. Run `npm run test:coverage` to confirm.
- **Regression catalog**: 142 entries (latest REG-175), target 35 exceeded. Authoritative
  source is `.claude/regression-catalog.md`.
- **Bundle**: two caps exist — `SHARED_JS_LIMIT_KB` (single largest shared chunk, ~160 kB
  baseline / ~168.5 kB observed) and `CAP_SHARED_KB` (first-load total, raised to 280 on
  2026-06-12). Run `npm run build` for current.
- **Largest page**: /foxy historically ~254 kB (P10 page budget 260 kB). Verify per build.

## Notes on the Cycle-1 row (2026-06-28 — auth-onboarding REGRESSION)
- **+27 new assertions:** 10 Deno always-200 (`send-auth-email/__tests__/always-200.test.ts`) + 7 AO-4
  vitest (`bootstrap-rpc-logical-failure.test.ts`) + the 3-role E2E (`auth-onboarding-3role.spec.ts`,
  honestly `test.fixme`-gated until ops seeds per-role staging fixtures) + the fs-guard that replaced the
  `expect(true).toBe(true)` placeholder.
- **Catalog:** REG-177 (`send_auth_email_always_200`, P15) being filed by a separate testing task → 144
  once landed. Authoritative source remains `.claude/regression-catalog.md`.
- **Build/bundle:** independently re-verified this cycle — shared 279.7 / 284 kB, middleware 116.2 / 120
  kB, 0 pages over the 260 kB page budget. Global coverage % was not re-measured this cycle (targeted
  auth/onboarding/identity run only: 940/940 + Deno 10/10).

## How to add a row
At the end of each cycle's REGRESSION phase, run `npm test`, `npm run test:coverage`,
and `npm run build`; read the catalog count; append one row with measured values and
drop the "to verify" qualifiers you confirmed.
