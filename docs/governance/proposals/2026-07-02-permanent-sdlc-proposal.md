# Proposal: Permanent 10-Phase Software Delivery Lifecycle

Status: PROPOSED, not adopted. Written 2026-07-02 in response to a CEO request made during the
Phase 4 certification program.

## The 10 phases, mapped to owners

| # | Phase | Primary owner(s) | Existing equivalent |
|---|---|---|---|
| 1 | Discovery and Requirements | Product Manager (proposed), orchestrator today | Loosely covered today by the orchestrator UNDERSTAND and CLASSIFY steps, without a dedicated requirements owner |
| 2 | Architecture and Design Review | architect, UX/UI Director (proposed) for user-facing work | Already exists for schema and infra; UX design review does not yet have a dedicated owner |
| 3 | Implementation | architect, backend, frontend, assessment, ai-engineer, mobile | Already exists, unchanged |
| 4 | Testing and Quality Gates | testing, quality | Already exists, unchanged |
| 5 | Security Review | architect (security-adjacent), quality | Already exists as part of the review-chain matrix for security-sensitive files, not yet a universal phase |
| 6 | Business Workflow Validation | assessment, Business Analyst and Curriculum and Learning Expert (proposed) | Partially exists via assessment quiz-UI and scoring review; the proposed roles would broaden this to subscriptions, reporting, and pedagogy |
| 7 | Performance and Reliability | architect (infra), quality (code-level) | Already exists as a domain ownership row, not yet a mandatory phase gate on every change |
| 8 | Production Certification | Release Manager (proposed), orchestrator today | This is exactly what the Phase 4 program this session performed - currently ad hoc, not a standing phase |
| 9 | Executive Release Approval | user, Executive Release Board (as convened this session) | Exists today only when explicitly invoked, as it was this session |
| 10 | Post-Deployment Monitoring | ops, Data and Analytics Lead (proposed) | Partially exists via the hypercare checklist drafted this session; not yet a standing phase |

## A necessary refinement before this can be adopted as literally as requested

The request states every request automatically passes through these phases. Taken completely
literally, this would mean a one-line typo fix or a documentation clarification question would
require Executive Release Approval before it could be answered - which contradicts the existing
constitution own distinction between autonomous, no-approval-needed changes (bug fixes, tests,
refactors, docs, flag toggles) and changes that genuinely need this level of process. Recommend
a two-track model instead:

- Full 10-phase SDLC for: new features, schema or API changes, anything touching payments,
  authentication, AI behavior, or scoring, and anything the orchestrator classifies as
  medium-or-higher risk under the existing risk classification already in use.
- A fast path (the existing lighter UNDERSTAND, CLASSIFY, DELEGATE, GATE, EXECUTE, REPORT loop)
  for genuinely low-risk changes: typo fixes, single-file refactors with no behavior change,
  documentation updates, answering a question about the codebase, feature-flag toggles.

This preserves the intent (rigor scales with risk and impact) without grinding trivial work to a
halt, and it does not weaken the certification program just completed - that program was always
going to be full-SDLC-scale work under either model.

## Gate criteria per phase, so this is enforceable rather than aspirational

Each phase needs an explicit entry and exit condition, or a mandatory phase becomes a checkbox
nobody actually verifies. Proposed:

1. Discovery and Requirements: exits when acceptance criteria are written down and the requesting
   party (you, or whoever raised the request) has confirmed them.
2. Architecture and Design Review: exits when the owning technical agent has produced a design
   and no unresolved objection exists from a reviewing agent.
3. Implementation: exits when the builder agent reports the change complete and self-tested.
4. Testing and Quality Gates: exits when type-check, lint, the relevant test suite, and build all
   pass, and quality has issued a verdict of at least APPROVE WITH CONDITIONS.
5. Security Review: exits when architect or quality has explicitly signed off on any
   security-sensitive surface touched, or explicitly stated none was touched.
6. Business Workflow Validation: exits when assessment (and the proposed Business Analyst and
   Curriculum and Learning Expert roles, once adopted) confirm no business rule regressed.
7. Performance and Reliability: exits when bundle size, query-plan, and any relevant load
   characteristics are confirmed within budget, or explicitly waived with a documented reason.
8. Production Certification: exits when a certification package equivalent in rigor to this
   session own Phase 4 program exists for the change in question - scaled to the size of the
   change, not always this exhaustive.
9. Executive Release Approval: exits when you, or a Board you convene, issue one of APPROVED,
   APPROVED WITH CONDITIONS, or REJECTED, with evidence.
10. Post-Deployment Monitoring: exits when the hypercare window closes clean, per the checklist
    already drafted this session.

## Why this is a proposal and not already the standing process

Same two reasons as the Product Organization proposal: adopting this permanently means editing
the constitution own autonomous-operating-loop section and its Rejection Conditions and
Autonomous Decisions lists, which is itself a change to the agent system requiring your explicit
approval and, ideally, file-write access this session does not have. Recommend confirming the
two-track refinement above, then implementing both proposals together in one dedicated follow-up
task, since they are designed to interlock (the Product Organization roles are the phase owners
this SDLC assumes).
