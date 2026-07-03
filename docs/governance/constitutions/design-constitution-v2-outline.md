# Design Constitution (Outline - not a draft)

Status: SCOPED, deliberately not drafted in depth. See the initiative plan for why: this
document assumes a UX/UI Director role that does not exist yet, and drafting design-token or
accessibility standards without that role own expertise would produce a document that looks
complete but is not genuinely owned or grounded.

## What this document will need to cover, once the UX/UI Director role is ratified and can
co-author it

1. **Design tokens.** A single source of truth for color, spacing, typography, and motion
   values, replacing whatever ad hoc conventions exist today in the codebase Tailwind config and
   component styles. Needs an audit of current usage before standardizing, not a fresh invention.
2. **Component governance.** When a new component may be created versus when an existing one
   must be extended, a review gate for new components entering the shared library, and a
   deprecation policy for components superseded by newer patterns.
3. **Accessibility standards.** A concrete, testable bar (recommend WCAG 2.1 AA as the starting
   reference point, subject to the UX/UI Director own judgment) plus how conformance is checked -
   automated tooling, manual review, or both - and where in the pipeline that check happens.
4. **UX review process.** What frontend must submit for review, what the UX/UI Director checks,
   and how this integrates with the veto power already defined in Engineering Constitution v2
   Section 4.

## What already exists that this document should build on, not ignore

- The bilingual requirement (P7) and its existing enforcement pattern.
- The bundle-budget constraint (P10), which already shapes what kinds of design decisions are
  affordable on the platform target profile (Indian 4G).
- The existing Tailwind brand tokens already defined in the codebase configuration - a starting
  inventory, not a blank page.

## Recommended first step once the UX/UI Director role exists

An audit of current design-token usage and accessibility conformance across the highest-traffic
surfaces (dashboard, quiz, Foxy), producing a gap list before writing any new standard - the
same evidence-first discipline the Release Constitution formalizes, applied to design.
