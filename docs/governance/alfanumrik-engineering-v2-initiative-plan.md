# Alfanumrik Engineering v2 - Initiative Plan

Status: PLANNING. Written 2026-07-02, at the point the Phase 4 certification program was
paused pending CERT-17. This initiative is a separate, parallel workstream from the paused
certification program - it does not require CERT-17 to close, and the certification program
does not require this initiative to complete.

## What this initiative is

Four documents, together forming the operating manual for the AI engineering organization:

1. Engineering Constitution v2 - agent roles, authority boundaries, escalation, veto power
2. Design Constitution - design tokens, component governance, accessibility, UX review
3. Product Constitution - requirement lifecycle, acceptance criteria, educational quality gates,
   curriculum validation
4. Release Constitution - certification process, evidence requirements, executive gates,
   rollout policy, incident response

## What already exists as source material, and what is genuinely new

This matters for sequencing, because two of these four documents can be drafted in real depth
today, and two cannot be drafted well until a prior step happens.

| Constitution | Existing source material | Verdict |
|---|---|---|
| Engineering v2 | The current constitution own 10-agent system, domain-ownership table, review-chain matrix, plus the Product Organization proposal drafted this session (7 new roles with boundaries already reasoned through) | **Draftable now, in depth** |
| Release | The entire Phase 4 certification program just completed - a working three-stage certification model, an evidence-first rule, an Executive Release Gate pattern (ERG-1), a Board decision package format, and five operational checklists (deployment, rollback, post-deployment validation, hypercare) all exercised for real this session | **Draftable now, in depth** |
| Design | Nothing from this session - the existing agent system has "frontend" implementing UI and "quality" doing a narrow UX-audit review line item, but no design-token standard, no component-governance model, no accessibility standard exists anywhere in the codebase constitution today | **Not draftable in depth yet - see dependency below** |
| Product | Partial - the certification program own report 06 (business rules) and report 04 (user journeys) establish a pattern for validating requirements against outcomes, but there is no existing requirement-lifecycle or acceptance-criteria standard to build from | **Partially draftable - see dependency below** |

## The dependency that governs sequencing

Design Constitution assumes a UX/UI Director role exists to own it. Product Constitution assumes
a Product Manager role exists to own requirement lifecycle and acceptance criteria, and a
Curriculum and Learning Expert role to own educational quality gates and curriculum validation.
None of these three roles exist yet - they are proposed, not adopted, in the Product
Organization proposal from this session.

Drafting a full Design Constitution or Product Constitution today would mean writing standards
for roles that do not exist, owned by nobody, validated by nobody who actually holds curriculum
or design expertise. That produces a document that looks complete but is not actually
load-bearing. Recommend instead: ratify Engineering Constitution v2 first (which creates the
roles), then have the newly-created Product Manager, UX/UI Director, and Curriculum and Learning
Expert roles co-author their own constitutions, with the orchestrator facilitating rather than
drafting alone. A role writing its own operating rules, reviewed by you, produces a better and
more genuinely owned document than the orchestrator guessing at design-token conventions it has
no session-grounded expertise in.

## Phased delivery plan

**Wave 1 (this session, now)**: draft Engineering Constitution v2 and Release Constitution v2 in
full depth. Both have strong, tested source material and do not depend on anything not yet
built.

**Wave 2 (a dedicated follow-up session, requires file-write tooling)**: ratify Engineering
Constitution v2 - actually create the 7 new agent role definitions, update the routing and
review-chain tables, wire the escalation and veto rules into the enforcement hooks where
mechanically enforceable. This is the same tooling gap already flagged for the Product
Organization proposal - unchanged by this initiative, just formally scoped into it now.

**Wave 3 (after Wave 2)**: the newly-ratified Product Manager, UX/UI Director, and Curriculum
and Learning Expert roles draft Product Constitution and Design Constitution, each grounded in
their now-real authority and reviewed by you and by quality for internal consistency with
Engineering Constitution v2.

**Wave 4**: a final consistency pass across all four documents - confirm no contradiction exists
between, for example, Release Constitution own executive-gate rules and Engineering Constitution
own veto-power rules, before declaring the operating manual complete.

## Ratification process for the constitutions themselves

Recommend the same evidence-first discipline the certification program just used: each
constitution draft gets an explicit review pass (quality, plus the domain agents whose authority
it defines) before you are asked to ratify it, and ratification is a single explicit act (you
saying so), not an implicit consequence of the document existing. This mirrors the Executive
Release Board pattern already built this session - a constitution in draft is not binding until
ratified, the same way a Release Candidate is not shipped until approved.

## What happens to the two prior proposals

The Product Organization proposal and the permanent SDLC proposal, both drafted this session,
are absorbed into this initiative rather than existing as a separate track - Engineering
Constitution v2 is where the Product Organization proposal own content belongs, and the
permanent SDLC proposal own two-track refinement belongs inside Engineering Constitution v2 own
escalation-and-process rules. No content is lost; it is being organized into the four-document
structure this initiative defines rather than living as two standalone proposals.
