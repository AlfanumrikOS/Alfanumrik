# Cross-Cutting Invariants — ROOT-CAUSE (Cycle 8, FINAL)

Owner: Quality. These invariants span the whole app, so the failures cluster into a few systemic themes
rather than per-route defects. Four themes explain all seven gaps (XC-1..XC-7).

---

## RC-1 — Bilingual obligation has no single chokepoint; it lives on hundreds of independent edges

Maps to: XC-1, XC-2, XC-7 (P7).

P7 is implemented as a convention (inline `isHi` ternaries + a few keyed tables) rather than a mechanism.
There is no i18n key catalog, no missing-translation lint, and no server/client parity contract that CI can
enforce. Consequences:

- The CLIENT is bilingual because of high author discipline, not because the architecture forces it — which
  works until a producer is on the SERVER, where the same author reflex (write the English string inline)
  silently ships English-only text (XC-1). The client then masks the gap by falling back to English
  (`notifications/page.tsx:196-198`), so nothing visibly breaks and the gap is invisible to English-mode
  reviewers and to CI.
- Even within a single producer, the house shape was adopted partially: `body_hi` was added but `title_hi`
  was not (XC-2). Without a typed contract that REQUIRES both, partial adoption is the path of least
  resistance.
- The good pattern already exists in two places — `today/copy.ts` (keyed resolver) and `synthesis-summary.ts`
  (a `language` param) — but neither was generalized into the house standard, so each new surface re-invents
  P7 (XC-7).

Underlying cause: P7 was specified as a behavior ("support Hindi/English") but never given an enforcing
primitive. Discipline scales sub-linearly with surface count; the server surfaces are simply the edges where
discipline first runs out.

---

## RC-2 — The API route layer chose the admin (RLS-bypassing) client as its default

Maps to: XC-3 (P8).

87% of routes (316/362) read through the elevated admin client, making app code — not RLS — the operative
data boundary across almost the entire API surface. This is a deliberate early decision (the admin client is
simpler for cross-cutting/aggregate reads and avoids per-request RLS cost) that hardened into the default
posture. RLS (440+ policies) is real but mostly protects the minority client/scoped-server path.

The systemic risk is not any single route — most have correct `authorizeRequest` / `canAccessStudent` checks
today. The risk is structural: defense-in-depth is absent at the dominant path, so the blast radius of ANY
future app-code mistake is "full cross-tenant read," and the probability of at least one such mistake rises
with every new route. Cycles 5 and 7 already found two instances (teacher-students, parent child-data); this
cycle shows they are not exceptions but the norm.

Underlying cause: "use the admin client" became the path of least resistance for route authors, and no
guardrail (lint/CI) ever flagged a new admin-client import on a PII route, so the ratio drifted to 87% without
a decision ever being made to make it the default.

---

## RC-3 — Guardrails that should ratchet DOWN are instead ratcheted UP (cap creep)

Maps to: XC-4 (P10).

`CAP_SHARED_KB` has been raised five times (270 to 284) and Shared JS now sits 4.3 kB under the cap with the
middleware 3.8 kB under its own. Each individual raise is well-documented and defensible (framework drift,
honest re-measurement), but the cumulative effect is that the budget meant to PROTECT the user keeps moving to
accommodate the code, rather than the code being reduced to fit the budget. The one durable lever (split
@supabase/* out of first paint, ~57 kB) is identified but unspent, and the cheap lever (PostHog lazy-load) is
already used — so the next drift has nowhere to go but a 6th raise.

Underlying cause: the budget is enforced as a single mutable number with no friction on raising it. There is
no pin/regression that forces a raise to be a consciously-reviewed event, and no scheduled commitment to the
durable reduction, so the easy response (bump the cap) always wins over the hard one (split the bundle).

---

## RC-4 — Cross-repo constants are duplicated by hand with comments instead of contracts

Maps to: XC-5, XC-6 (mobile).

Web and mobile are separate repos in different languages, so shared truths (Performance Score config, plan
prices) are physically copied into Dart and kept in sync by a code comment ("MUST stay in sync") plus the
P14 mobile review-chain reminder. There is no shared artifact and no test linking the two, so the ONLY thing
preventing drift is a human remembering to mirror a web edit into Dart. The quiz XP/score path avoided this
trap entirely by making the server authoritative (the device holds no constant) — which is exactly the
pattern the score-config and price duplications did NOT follow.

Underlying cause: for values that genuinely must exist client-side (offline score display, price display),
the team duplicated literals rather than (a) serving them from an API, or (b) adding a mechanical drift check.
A comment is documentation, not enforcement; it has no failure mode when ignored.

---

## Cross-theme synthesis

Three of the four themes are the SAME failure in different clothing: an invariant was expressed as a rule or a
comment but never given a mechanical enforcer, so compliance depends on per-edit human discipline that
degrades as surface area grows (RC-1 P7 edges, RC-2 route-client default, RC-4 cross-repo mirror). RC-3 is the
inverse and more insidious: a mechanical enforcer EXISTS for P10, but because it is a single freely-editable
number, the enforcer itself is quietly relaxed instead of the underlying cost being paid.

The highest-leverage cross-cutting fix is therefore to convert "rules/comments" into "tests/contracts" at the
specific edges where discipline has already started to fail — which is precisely what the AUTO-FIX-SAFE items
(XC-5/XC-6 drift tests, XC-4 cap pin, XC-1/XC-2 server Hindi twins) do, while the LARGER-PROGRAM items (XC-3
RLS defense-in-depth, XC-7 i18n primitive) address the structural defaults that produced the gaps.
