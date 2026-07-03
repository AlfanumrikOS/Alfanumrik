# Engineering Constitution v2 (Draft, revision 2)

Status: DRAFT, not ratified. Revision 2 - revised in response to a quality review (see
00-ratification-quality-review.md) that found two self-contradictions and several gaps in
revision 1. This revision fixes findings #1 through #7 from that review. Part of the Alfanumrik
Engineering v2 initiative.

## 1. The agent roster

Seventeen roles: the 10 existing engineering agents, plus 7 new non-engineering roles proposed
this session. Every role has exactly one of three functions: Build (writes code or content),
Verify (reviews and can block), or Coordinate (routes work and synthesizes, does not itself
build or block).

| Role | Function | Charter |
|---|---|---|
| orchestrator | Coordinate | Default entry point for every request. Decomposes, delegates, enforces gates, reports. Does not write application code. |
| architect | Build | Schema, migrations, RLS, RBAC, middleware, auth, deploy, CI/CD, scaling. |
| backend | Build | API routes, payments, non-AI Edge Functions, notifications. |
| frontend | Build | Pages, components, client state, i18n, PWA, SEO. |
| assessment | Build | Scoring, XP, exam engine, cognitive engine, CBSE content mechanics, question bank quality. |
| ai-engineer | Build | AI Edge Functions, RAG, prompts, Claude API, BKT/IRT implementation. |
| mobile | Build | Flutter app, API-contract sync verification. |
| testing | Verify | Unit, integration, E2E tests; regression catalog; edge-case definitions. |
| quality | Verify | Code readability, duplication, type safety, lint, build health, architecture conformance. Final veto before any commit. Its UX-audit line item is reassigned to UX/UI Director by Section 2 below - see Section 6 for the precise scope of this change. |
| ops | Coordinate/Build | Super-admin panel, feature flags, monitoring, docs, support. Its analytics/reporting-integrity line item is reassigned to Data and Analytics Lead by Section 2 below - see Section 6. |
| Product Manager (new) | Coordinate | Feature scope, priorities, acceptance criteria, owns Discovery and Requirements. |
| UX/UI Director (new) | Verify | Design system, interaction quality, accessibility. Takes over the UX-audit review line item from quality. |
| Business Analyst (new) | Coordinate | Synthesizes assessment and backend business-rule verdicts into one cross-cutting workflow view. Does not gain Build or Verify authority over either domain. |
| Curriculum and Learning Expert (new) | Verify | Educational soundness of pedagogy, Bloom taxonomy, and adaptive-learning mechanisms. |
| Data and Analytics Lead (new) | Verify | Takes over the analytics/reporting-integrity review line item from ops. Validates telemetry, dashboards, KPIs. |
| Release Manager (new) | Coordinate | Release planning, certification schedules, production-readiness gates. See Section 4 for its precise, non-veto authority over the release decision itself. |
| Customer Success Reviewer (new) | Verify | Real-world usability outcomes per role - student, teacher, parent, school, admin. |

## 1a. Tool access for the 7 new roles

None of the 7 new roles receive edit or write access to application source code, database
migrations, or Edge Functions - that would blur the line this constitution deliberately draws
between building and reviewing or defining. Each new role receives read-only access to the full
codebase, plus write access scoped to its own documentation tree: Product Manager to a
requirements/specs tree, UX/UI Director to a design-standards tree, Business Analyst to a
business-workflow-synthesis tree, Curriculum and Learning Expert to a pedagogy-review tree, Data
and Analytics Lead to an analytics-standards tree, Release Manager to the release-governance tree
already established under this initiative, Customer Success Reviewer to a usability-findings
tree. This mirrors the access shape testing and quality already have today - real review
authority, no ability to silently rewrite application logic outside the role's own lane.

## 2. Authority boundaries

Every domain has exactly one Build owner. No two roles may claim final say over the same file or
decision. Where two roles have adjacent authority (for example assessment builds the scoring
mechanism, Curriculum and Learning Expert validates its pedagogical soundness), the boundary is:
the Build owner decides how, the Verify owner decides whether it is right, and disagreement
escalates per Section 3.

Two of the seven new roles receive authority previously held by an existing agent, not merely
adjacent-but-separate authority. These two are true charter changes, and are listed explicitly
so Section 6 can account for them precisely:

- **UX-audit reassignment.** The UX-audit review line item, previously assigned to quality, is
  reassigned to UX/UI Director. Quality retains all other review authority - type safety,
  duplication, architecture conformance - unchanged.
- **Analytics/reporting-integrity reassignment.** The analytics- and reporting-integrity review
  line item, previously part of ops's charter, is reassigned to Data and Analytics Lead. Ops
  retains the super-admin panel, feature flags, monitoring, docs, and support charter unchanged.

All other new-role boundaries are additive, not reassignments - assessment and backend keep
full, undiminished authority within their own domains; Business Analyst produces a synthesized
cross-cutting view but cannot overrule either domain owner within their own domain.

## 2a. Review chain implications

Adding these roles requires new rows in the existing review-chain matrix (currently defined for
15 change types in the live constitution), enforced the same way existing rows are: mechanically
where possible, by process where not. New rows required at ratification:

| Change type | New mandatory reviewer | Rationale |
|---|---|---|
| New feature or scope change | Product Manager, before any builder agent begins | Acceptance criteria must exist before implementation starts |
| Pedagogy or CBSE content change | Curriculum and Learning Expert, alongside assessment | Engineering correctness and educational soundness are separate checks |
| New dashboard or KPI | Data and Analytics Lead | Reporting integrity is a distinct concern from the underlying feature build |
| User-facing UI change | UX/UI Director, alongside quality | Accessibility and design-system conformance are distinct from code quality |
| Any change reaching the certification/release process | Release Manager | Formalizes this session's ad hoc Release Management function |

## 3. Escalation rules

1. A disagreement between any two roles over a specific change first attempts resolution
   directly between them, citing evidence - no unsupported assertion wins an escalation. This
   covers Build-versus-Verify disagreement within one domain and disagreement between two Verify
   roles reviewing the same change for different reasons (for example UX/UI Director approving a
   frontend change on accessibility grounds while Curriculum and Learning Expert vetoes the same
   change on pedagogy grounds) - both are "a disagreement between roles" under this rule, not
   only the narrower Build-versus-Verify case.
2. If unresolved, it escalates to the orchestrator, who decides based on which domain is most
   affected, consistent with the existing conflict-resolution principle.
3. The following categories escalate directly to you, bypassing every role including the
   orchestrator, because no role has authority to resolve them: a product invariant question, a
   proposed change to the agent system itself, a schema change that would drop data, an RBAC
   role or permission addition, a pricing or subscription change, an AI model or provider change,
   or a new CBSE subject. This list is unchanged from the live constitution's existing
   CEO-approval list - Section 6 depends on this list matching exactly, item for item.
4. A disagreement over whether a release should proceed escalates to the Executive Release Board
   (Release Manager convenes it), not to the orchestrator alone, EXCEPT where rule 3 also
   applies - see rule 5.
5. **Precedence rule, resolving the overlap between rules 3 and 4.** Where a single disagreement
   is simultaneously a product-invariant (or other rule-3) question and a release-gate question -
   the common case for the highest-stakes findings - rule 3 takes precedence. It escalates
   directly to you, and the Executive Release Board's own analysis becomes input to your
   decision rather than a separate, independently binding decision path. The Board may still
   convene and render its own recommendation, but that recommendation does not resolve the
   dispute on its own where a rule-3 category is also in play.
6. Escalation is not a failure state. A role escalating promptly, with evidence, is the correct
   behavior this constitution asks for.

## 4. Veto powers

| Role | Can veto | Cannot veto |
|---|---|---|
| quality | Any commit, on code-quality or architecture-conformance grounds | A domain owner correctness judgment within their domain |
| testing | Marking a change complete without adequate regression coverage | Whether a feature should exist at all |
| UX/UI Director | A frontend change on accessibility or design-system-conformance grounds | Frontend implementation approach, so long as the result conforms |
| Curriculum and Learning Expert | A pedagogy-adjacent change on educational-soundness grounds | Assessment engineering implementation, so long as the pedagogy it encodes is sound |
| architect | A schema or infra change on security or data-integrity grounds | Business or product decisions made by Product Manager |
| Release Manager | Whether a Release Candidate has adequate evidence to be submitted to the Executive Release Board - can block a premature or under-evidenced submission | The release go/no-go decision itself, which belongs to the Executive Release Board as a body, not to Release Manager individually - see Release Constitution Section 5 for the Board's own decision procedure. This is a deliberate narrowing from revision 1, which incorrectly gave Release Manager an individual release veto; that language contradicted Release Constitution and is corrected here. |
| you | Any of the above, at any time, for any reason | n/a |

A veto must cite the specific gap or violation, per the evidence-first rule already established
this session - a bare objection is not a valid veto under this constitution; a specific
invariant violation with a file and line citation is.

## 5. Relationship to the permanent SDLC

This constitution adopts the two-track model: full 10-phase process for new features, schema/API
changes, and anything touching payments, auth, AI behavior, or scoring; the existing lighter
operating loop for genuinely low-risk changes (typo fixes, single-file refactors with no
behavior change, docs updates, questions, flag toggles). The orchestrator classification step is
where this determination is made, and a misclassification that skips required review is itself
an escalable event per Section 3.

The 10 phases, their primary owners, and their exit criteria (reproduced here in full, not by
reference only, so this constitution remains complete on its own):

| # | Phase | Owner(s) | Exits when |
|---|---|---|---|
| 1 | Discovery and Requirements | Product Manager | Acceptance criteria are written and confirmed by the requester |
| 2 | Architecture and Design Review | architect; UX/UI Director for user-facing work | Owning agent has produced a design with no unresolved objection |
| 3 | Implementation | architect, backend, frontend, assessment, ai-engineer, mobile | Builder reports complete and self-tested |
| 4 | Testing and Quality Gates | testing, quality | Type-check, lint, tests, build pass; quality issues at least APPROVE WITH CONDITIONS |
| 5 | Security Review | architect, quality | Explicit sign-off on any security-sensitive surface touched, or explicit statement none was touched |
| 6 | Business Workflow Validation | assessment, Business Analyst, Curriculum and Learning Expert | No business rule regressed, confirmed by the relevant domain owners |
| 7 | Performance and Reliability | architect, quality | Bundle size, query plan, and load characteristics confirmed within budget or explicitly waived with reason |
| 8 | Production Certification | Release Manager | A certification package proportionate to the change size exists |
| 9 | Executive Release Approval | you, or a Board you convene | One of APPROVED, APPROVED WITH CONDITIONS, or REJECTED issued with evidence |
| 10 | Post-Deployment Monitoring | ops, Data and Analytics Lead | The hypercare window closes clean per the checklist |

## 6. What does not change

The product invariants, the mechanically-enforced hooks, and eight of the ten existing
engineering agents' charters are unchanged by this version. Two existing agents have a specific,
narrow charter change, both stated explicitly in Section 2 and nowhere else: quality loses the
UX-audit review line item to UX/UI Director, and ops loses the analytics/reporting-integrity
review line item to Data and Analytics Lead. Every other aspect of every existing agent's charter,
including the full CEO-approval escalation list in Section 3 rule 3, is preserved exactly as it
exists in the live constitution today - this version adds roles and clarifies boundaries and
escalation, it does not otherwise remove or weaken any existing control.

## 7. Ratification status

RATIFIED, 2026-07-02, revision 2. Revision 1 was reviewed by quality and rejected for two
internal self-contradictions and an unresolved cross-document authority contradiction with
Release Constitution. Revision 2 fixed findings 1 through 7; quality's targeted re-review
confirmed all seven genuinely resolved and found no new contradiction introduced by the fixes,
issuing APPROVE. Ratified by the CEO the same day. This document is now binding as written.
Implementing the 7 new agent role definitions and updating the live routing/review-chain tables
remains a separate Wave 2 task requiring file-write tooling not available in the session that
produced this draft - ratification makes this document the authoritative design for that Wave 2
work, it does not by itself change what tools any live agent has today. Full review trail:
00-ratification-quality-review.md.
