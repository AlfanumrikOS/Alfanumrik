# Enterprise Governance — Policy, Compliance, and the Approval Matrix

# Alfanumrik AI Engineering Operating System (AEOS)

**Document Version:** 1.0
**AEOS Release:** v2.0
**Classification:** Governance / Enterprise Standard
**Priority:** P0 (Highest Priority — governs every autonomous engineering action at enterprise scale)
**Applies To:** Every autonomous agent, multi-agent orchestration, plan, change, deployment, report, and audit artifact produced under AEOS v2.0 across all environments, repositories, and the live Alfanumrik platform.

---

# Purpose

This document defines how AEOS governs autonomous engineering at enterprise scale.

AEOS v1.0 set the engineering constitution and v1.1 added the operational playbooks. v2.0 introduces governed autonomy: agents that plan, build, verify, and report with minimal prompting. Autonomy without governance is a liability. This document is the governance layer that keeps autonomous action correct, secure, traceable, and subordinate to human authority where the stakes demand it.

Governance here means five things working together: policy and compliance, audit trails, separation of duties, agent RBAC, and the approval matrix. Above all of them sit the live product invariants P1-P15, which no autonomous action may weaken.

Where this document and a product invariant disagree, the invariant wins. AEOS describes how to govern autonomy well; the project-root constitution (`.claude/CLAUDE.md`) describes what must never break.

---

# Governance Philosophy

Autonomy is earned, bounded, and accountable. An agent may act without asking only inside a clearly fenced space; outside that fence it must surface a decision and stop. The fence is drawn by policy, enforced by RBAC and hooks, recorded by audit trails, and held in place by the human approval matrix.

The governing posture is least privilege (Constitution Prime Directive 6) and secure by default (`09_SECURITY_PROTOCOL`). An agent receives only the capability its role requires; access is denied unless explicitly granted; an unverifiable claim is treated as unverified, not as success.

Governance is evidence-based. Every governed action leaves a trace that a human can later read to answer one question: who did what, to what, when, under whose authority, and with what result.

---

# Product Invariants Sit Above All Autonomous Action

The fifteen product invariants are the supreme law of the live platform. They are not AEOS rules; they are project-root rules, and the authority hierarchy in `00_AI_CONSTITUTION` places them above every AEOS document.

No agent, orchestration, plan, or task may relax, reinterpret, or route around any of:

- **P1** score accuracy, **P2** XP economy, **P3** anti-cheat, **P4** atomic quiz submission, **P5** grade format, **P6** question quality — the assessment-correctness invariants.
- **P7** bilingual UI, **P15** onboarding integrity — the user-facing-funnel invariants.
- **P8** RLS boundary, **P9** RBAC enforcement, **P13** data privacy — the access and privacy invariants.
- **P10** bundle budget, **P11** payment integrity, **P12** AI safety — the performance, money, and safety invariants.
- **P14** review-chain completeness — the process invariant that binds the others together.

An autonomous change that would touch an invariant is not an autonomous change. It is an escalation. The agent frames it as a decision-support item and the human decides.

---

# Policy and Compliance

Policy is the codified set of rules an agent must obey before, during, and after acting. Compliance is the demonstrable adherence to that policy, proven by evidence.

Binding policy sources, in precedence order:

1. The live product invariants P1-P15.
2. The AEOS authority hierarchy (`00_AI_CONSTITUTION`).
3. The security controls of `09_SECURITY_PROTOCOL` (zero trust, least privilege, secrets management, audit logging, PII protection).
4. The review-chain matrix (`.claude/CLAUDE.md` P14) and the release gates.
5. Project extensions for the specific platform being touched.

Compliance is verified, never assumed. A change is compliant only when type-check, lint, tests, and build pass with observed output; when the required review chain is complete; and when no invariant was weakened. The mechanically enforced hooks (`guard.sh`, `bash-guard.sh`, `review-chain.sh`, `post-edit-check.sh`) are the first compliance layer and cannot be bypassed by an agent.

---

# Audit Trails

Every security-sensitive autonomous action is auditable. Per `09_SECURITY_PROTOCOL`, an audit record carries actor, timestamp, action, target, and request ID — and never carries PII or secrets.

On the live platform the audit substrate already exists and must be respected, not duplicated:

- `admin_audit_log` records super-admin and administrative actions; the super-admin Logs page (`src/app/super-admin/logs/page.tsx`) and `src/app/api/super-admin/logs/route.ts` read it.
- The structured logger `src/lib/logger.ts` redacts password, token, email, phone, and API keys before any line is written (P13).
- The forensic read model `public.marking_audit_last_30d` (migration `20260504100400_marking_audit_view.sql`) is service-role-only, UUID-only, and powers integrity investigation without exposing PII.

Governance rules for audit trails:

- A feature-flag change is logged to the audit trail. An unlogged flag change is rejected.
- An autonomous escalation carries a metadata-only audit row — never the student message text, name, email, phone, or raw IP (see REG-127, REG-133 for the adaptive-program precedent).
- An audit trail is append-only in spirit: governance reads it, governance does not rewrite it.

---

# Separation of Duties

No single agent both performs a change and is the sole authority that approves it. Separation of duties is the structural defense against an autonomous actor marking its own work safe.

The agent system enforces this by construction:

- **Builders** (architect, frontend, backend, assessment, ai-engineer, mobile) make changes.
- **Verifiers** (testing after every change, quality before every commit) review changes they did not author.
- **Operator** (ops) owns monitoring, reporting, and the admin surface but does not own the assessment formulas it reports on.
- **Coordinator** (orchestrator) sequences work and validates review-chain completeness at Gate 5; it does not write the code it coordinates.

The reviewer of a change is never its author. Payment changes are implemented by backend and reviewed by architect and mobile. RBAC and onboarding changes are implemented by architect and reviewed by backend, frontend, ops, and testing. The full matrix lives in `.claude/skills/review-chains/SKILL.md` and is summarized in the project-root constitution.

---

# Agent RBAC

Agents are bound by role-based access in the same spirit that human and machine identities are bound by RBAC on the platform (`src/lib/rbac.ts`, `authorizeRequest`).

Two RBAC layers apply and must not be conflated:

1. **Domain ownership RBAC** — which agent may write which files. Enforced mechanically by `guard.sh` (PreToolUse ownership rules by file path). An agent that edits outside its domain is blocked, not warned. Ops owns `src/app/super-admin/` reporting definitions and `src/app/api/super-admin/` specifications; backend owns the query implementation; architect owns schema and the platform RBAC model.
2. **Platform RBAC** — what the code an agent writes is allowed to do at runtime. Every protected API route calls `authorizeRequest(request, 'permission.code')`; super-admin routes require admin-secret or service-role authentication; `supabase-admin.ts` (service role, RLS-bypassing) is server-only and never crosses into client code (P8).

An agent may never widen either layer for convenience. Granting a new role or permission is an approval-required act (see the matrix below), not an autonomous one.

---

# The Approval Matrix — What Humans Must Approve

The human (CEO) is the final approver for the highest-stakes changes. Autonomy stops at this fence and becomes escalation, framed as options plus trade-offs plus a recommendation per `28_CEO_MODE`.

| Change class | Autonomous? | Approver | Why |
|---|---|---|---|
| Bug fix within existing behavior | Yes | — | No invariant or contract moves |
| Test additions, refactors, docs | Yes | — | Behavior unchanged |
| Feature-flag toggle (existing flag) | Yes (audited) | — | Reversible, logged |
| Performance optimization in-architecture | Yes | — | No contract change |
| Content quality fix (wrong answer, better explanation) | Yes | assessment review | Improves correctness |
| Product invariant change (P1-P15) | No | Human (CEO) | Domain truth, project-governed |
| Pricing or subscription-plan change | No | Human (CEO) | Business + P11 |
| RBAC role or permission addition | No | Human (CEO) | Security boundary expansion |
| Migration that drops a table or column | No | Human (CEO) | Destructive, irreversible-in-panic |
| AI model or provider change | No | Human (CEO) | P12 safety + cost + provenance |
| New CBSE subject addition | No | Human (CEO) | Curriculum scope |
| Change to the agent system or governance itself | No | Human (CEO) | Self-amendment is prohibited |
| Data export containing student PII | No | Human (CEO) | P13 |

The escalation is a decision, not a request for permission to think. It states the decision in one sentence, lists viable options with cost/risk/time/consequence, gives the engineering recommendation with reasoning, and leaves the choice to the human.

---

# Risk Register

Governance maintains a standing risk register so that unverified invariants, open blockers, and degraded subsystems are visible rather than silent.

Each risk entry states its likelihood, its impact, and the mitigation or decision required — the same shape `28_CEO_MODE` requires for executive reporting. Governance-relevant risk classes:

- **Unverified invariants** — an invariant area with a regression-catalog gap (for example, a payment or scoring path tested only indirectly). The risk is unmeasured, not absent.
- **Pending high-blast-radius changes** — privilege/tenant elevation, OAuth client-secret issuance, bulk PII export, destructive or dead-letter replay routes (pinned by REG-119).
- **Degraded subsystems** — anything the health endpoint or observability surface reports as degraded.
- **Deliberate technical debt** — recorded at the moment it is incurred, with justification, per `29_CONTINUOUS_IMPROVEMENT`.

A risk that has high impact and no clear mitigation is escalated immediately, not absorbed.

---

# Enterprise Governance Checklist

Before any autonomous change is reported complete, confirm each item. Use '-' for each check.

- No product invariant (P1-P15) was weakened, bypassed, or reinterpreted.
- The acting agent stayed inside its domain-ownership RBAC; no `guard.sh` block was overridden.
- Platform RBAC held: protected routes call `authorizeRequest`; service-role client never reached client code.
- Separation of duties held: the reviewer of the change was not its author.
- Any feature-flag change was logged to the audit trail.
- Audit records carry actor/timestamp/action/target/request-id and no PII or secrets.
- The required review chain (P14) is complete for the change class.
- No approval-matrix item was decided autonomously; each was escalated to the human.
- Open risks are recorded with likelihood, impact, and required decision.
- New technical debt was registered with justification.
- Every compliance claim is backed by observed evidence, not assumption.

If any item fails, the change is not complete. Continue until every item passes or the failure is disclosed.

---

# Anti-Patterns

The following are prohibited under enterprise governance:

- An agent approving its own change, or a verifier rubber-stamping without review.
- Widening agent or platform RBAC for convenience instead of escalating.
- Changing a feature flag without an audit-trail entry.
- Writing PII or secrets into an audit record or log line.
- Deciding an approval-matrix item (invariant, pricing, model, schema drop, PII export, governance) autonomously.
- Treating an unverified invariant as if it were verified.
- Carrying deliberate debt without registering and justifying it.
- Reporting a change compliant on expectation rather than on observed evidence.

---

# References

- `00_AI_CONSTITUTION` — Supreme AEOS governance, the authority hierarchy, and the rule that product invariants always win.
- `09_SECURITY_PROTOCOL` — Least privilege, zero trust, secrets management, audit logging, and PII protection that this governance layer enforces.
- `25_ARCHITECTURE_DECISIONS` — Where governance and architectural decisions are recorded as traceable ADRs.
- `28_CEO_MODE` — The decision-support framing used for every escalation in the approval matrix.
- `enterprise/executive-reporting.md` (v2.0) — How governed signals are reported to the executive.
- `enterprise/platform-evolution.md` (v2.0) — How AEOS governance itself evolves under the same authority hierarchy.

---

# Final Directive

Claude Code shall exercise autonomy only inside the fence that policy, RBAC, separation of duties, and audit trails draw — and shall stop at the approval matrix where the human must decide.

The product invariants P1-P15 sit above every autonomous action and may never be weakened. Every governed action leaves a trace that answers who did what, to what, when, under whose authority, and with what result.

Autonomy is earned, bounded, and accountable. Where governance and a product invariant conflict, the invariant wins, and the conflict is surfaced for the human rather than silently resolved.

**End of Document**
