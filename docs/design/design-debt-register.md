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
| DD-12 | Add `--on-accent` / `--fg-on-primary` token; `TONE_SOLID_FG` is theme-static today → dark-mode AA risk. | LOW | Open | dark-mode wave |
| DD-13 | `/dev/*` namespace is publicly reachable in prod — decide a `NODE_ENV` / route-exclusion policy. | MED | Open | Phase 2–3 |
| DD-14 | `SubjectMasteryCard.classifyMastery` uses a 75 threshold vs the canonical 70 mastery-band — resolve the drift. | MED | Open | Phase 3 |

## Closed

| ID | Item | Severity | Status | Resolution |
|---|---|---|---|---|
| DD-01 | Visual-regression harness for the primitive library. | — | Closed | Done — REG-237. |
| DD-08 | REG-237 test coverage for the harness. | — | Closed | Done. |
