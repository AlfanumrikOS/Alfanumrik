# Design Debt Register

Living ledger of known design-system debt for the premium UI/UX rebuild. It is
**maintained every phase** per execution-discipline: each phase reviews open
entries, closes what it fixed, and adds any new debt it knowingly incurs. An
item ships as debt only when it is captured here with an owner phase — never
silently.

Severity: HIGH (blocks consistency / a11y / correctness at scale) · MED
(noticeable, scoped) · LOW (cosmetic / trivial). Status: Open · Closed.

## Open

| ID | Item | Severity | Status | Scheduled phase |
|---|---|---|---|---|
| DD-02 | Tier-1 `--color-*` raw palette is spec'd in the design system but not yet emitted in code (globals.css still exposes only the flat legacy aliases). | HIGH | Open | Phase 2 |
| DD-03 | ~8,884 inline hex literals bypass the token layer across parent / teacher / super-admin surfaces. | HIGH | Open | Phases 10–12 |
| DD-04 | Four design dialects coexist (cosmic / admin-ui / landing / wonder-blocks); consolidate to one canonical system. | HIGH | Open | Phases 3–13 |
| DD-05 | 12px type floor is enforced via a CSS `!important` guard; add an ESLint rule to reject sub-12px `text-[Npx]` at source instead. | MED | Open | Phase 2 |
| DD-06 | Two navigation shells exist and the desktop double-sidebar can overlap. | HIGH | Open | Phase 3 |
| DD-07 | Doc contrast comment drift: 5.6 vs 5.8 for the same pair. | LOW | Open | (trivial) |
| DD-09 | Landing page V1/V2 fork — delete V1 after the cutover. | MED | Open | Phase 13 |
| DD-10 | Audit `<img>` / media inside `rounded-*` cards for missing `overflow-hidden` (corner bleed). | MED | Open | Phase 3 |
| DD-11 | Converge ~134 Wonder Blocks consumers onto the canonical primitives; retire the legacy single-file set. | HIGH | Open | Phases 3–13 |
| DD-12 | `--on-accent` **+ paired on-surface tokens ADDED this phase** (`--on-accent`, `--surface-inverse`/`--on-surface-inverse`(-muted), `--surface-accent`/`--on-surface-accent` in `:root`, cosmic, inert-dark; AA-verified — design-system.md §8.1). Remaining: `TONE_SOLID_FG` still uses the `white` keyword → repoint to `var(--on-accent)`; consumer migration pending. | LOW | Open | dark-mode wave |
| DD-13 | `/dev/*` namespace is publicly reachable in prod — decide a `NODE_ENV` / route-exclusion policy. | MED | Open | Phase 2–3 |
| DD-18 | Dashboard authed browser QA (D1 double-sidebar, DD-16 contrast, overflow, single-CTA discipline) unverified in the placeholder-Supabase env — needs a real student session / preview deploy to confirm the Phase 3a/3b glance panels + disclosure render correctly end-to-end. | MED | Open | Preview / QA |
| DD-16 | Hardcoded light-text sites (`text-white` + inline `color:#fff`) decoupled from their backgrounds → unreadable text when the fill is light or a decorative/scoped bg fails to paint, across all roles. **Paired on-surface token layer exists** (§8.1). **Tranche 1 landed 2026-08-09: 159 confirmed sub-AA sites fixed** across the student, parent, teacher and school-admin portals plus the shared `packages/ui` components they render — standardised on `--accent-warm-strong` + `--on-accent` (5.09:1) for warm solids, `--surface-accent` + `--on-surface-accent` (4.72:1) for warm gradients, and `--text-1` ink on light fills that have no darker token (gold 9.14:1, green 5.62:1, teal 5.03:1, WhatsApp green 9.34:1). Net −84 hardcoded `#fff` foregrounds, −41 `#E8581C` fills; no new hex added. **Also fixed the inventory generator, which had been throwing ENOENT since the monorepo migration** (it scanned a repo-root `src/` that no longer exists), so the checked-in report had been frozen at pre-migration numbers — the doc now also carries a contrast-computed "Section 2 — CONFIRMED sub-AA" ground-truth set. **Remaining:** marketing/landing, `packages/ui/src/simulations/*` (canvas-drawn backgrounds, needs visual QA), super-admin, `packages/lib/src/email-templates.ts`, and runtime DB-supplied subject fills (`s.color` on `/library` + `/memory`) which need a curated palette or a luminance-picked foreground helper. Still to do: the lint rule rejecting raw `text-white`/`color:#fff` + visual-regression coverage. | HIGH | Open (tranche 1 done) | Page phases |

## Closed

| ID | Item | Severity | Status | Resolution |
|---|---|---|---|---|
| DD-01 | Visual-regression harness for the primitive library. | — | Closed | Done — REG-237. |
| DD-08 | REG-237 test coverage for the harness. | — | Closed | Done. |
| DD-14 | `SubjectMasteryCard.classifyMastery` uses a 75 threshold vs the canonical 70 mastery-band. | MED | Closed | Phase 3b (C3) — reconciled 75→70 to match the canonical `bandForValue` >=70 high cutoff. Presentation only, no scoring change. |
