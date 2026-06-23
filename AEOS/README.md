# Alfanumrik Engineering Operating System (AEOS)

> **Version:** 2.0.0 - **Status:** v2.0 governed-autonomy layer complete (pending release commit) - **Last reconciled:** 2026-06-23
> Numbers and inventory below are point-in-time and updated per release.

AEOS is a **versioned internal product** - the engineering constitution that governs every engineering activity performed by Claude Code and future AI agents working on Alfanumrik.

Its purpose is to make an AI engineer behave like a disciplined **Principal Engineer**: reasoning before coding, verifying with evidence, respecting architecture, and continuously improving the platform - with minimal additional prompting.

AEOS is designed to be **platform-agnostic at the core**. Technology-specific guidance (AWS, Supabase, Vercel, Anthropic, Razorpay, etc.) lives in `docs/extensions/` so the core operating system remains reusable for future projects.

## Repository Structure

```
AEOS/
  VERSION                 # Semantic version (single source of truth)
  CHANGELOG.md            # Dated release history
  ROADMAP.md              # v1.0 / v1.1 / v2.0 scope + acceptance criteria
  README.md               # This file - product overview + document index
  CLAUDE.md               # Authority entry-point (how a session loads AEOS)
  MASTER_SYSTEM_PROMPT.md # Authority #2
  EXECUTION_ENGINE.md     # Authority #3 - canonical execution loop
  docs/
    00_AI_CONSTITUTION.md ... 29_CONTINUOUS_IMPROVEMENT.md   # platform-agnostic core
    extensions/           # platform/vendor binding modules
  playbooks/              # operational intelligence - AI workflows + prompt/eval/MCP (v1.1)
  runbooks/               # operational intelligence - AWS/GitHub/Supabase ops, SRE, DR (v1.1)
  guides/                 # operational intelligence - optimization + performance tuning (v1.1)
  checklists/             # operational intelligence - consolidated operational checklists (v1.1)
  autonomy/               # governed autonomy - multi-agent orchestration, planning, verification (v2.0)
  memory/                 # governed autonomy - engineering memory + knowledge graph (v2.0)
  enterprise/             # governed autonomy - enterprise governance + executive reporting (v2.0)
```

## Authority Hierarchy

Claude Code interprets governance in this order (higher overrides lower):

1. Project-root constitution (the repository CLAUDE.md / .claude product invariants P1-P15)
2. AEOS/MASTER_SYSTEM_PROMPT.md
3. AEOS/EXECUTION_ENGINE.md
4. AEOS documentation (AEOS/docs/00-29)
5. Project-specific extensions (AEOS/docs/extensions/)
6. The current engineering task

AEOS never overrides the live Alfanumrik product invariants (P1-P15). Where AEOS guidance and a product invariant disagree, the invariant wins; the discrepancy is logged for reconciliation.

## Document Index

| # | Document | Domain | Status |
|---|---|---|---|
| 00 | AI_CONSTITUTION | Supreme governance | DONE |
| 01 | ROLE_DEFINITION | Engineer role and conduct | DONE |
| 02 | PROJECT_CONTEXT | Product/platform context | DONE |
| 03 | REPOSITORY_RULES | Repo governance | DONE |
| 04 | CODING_STANDARDS | Code quality | DONE |
| 05 | ARCHITECTURE_STANDARDS | Architecture governance | DONE |
| 06 | API_ENGINEERING | API standards | DONE |
| 07 | DATABASE_ENGINEERING | Data/schema standards | DONE |
| 08 | TESTING_PROTOCOL | QA and testing | DONE |
| 09 | SECURITY_PROTOCOL | Security | DONE |
| 10 | VERIFICATION_ENGINE | Evidence-based execution | DONE |
| 11 | GIT_WORKFLOW | Source control | DONE |
| 12 | AWS_INFRASTRUCTURE | Cloud (extension-bound) | DONE |
| 13 | FRONTEND_ENGINEERING | Frontend | DONE |
| 14 | BACKEND_ENGINEERING | Backend | DONE |
| 15 | DOCUMENTATION | Docs engineering | DONE |
| 16 | MCP_CONFIGURATION | MCP operations | DONE |
| 17 | PLAYWRIGHT_AUTOMATION | E2E/browser verification | DONE |
| 18 | PERFORMANCE_ENGINEERING | Performance | DONE |
| 19 | REFACTORING_PROTOCOL | Refactoring | DONE |
| 20 | DEPLOYMENT_PIPELINE | Deployment | DONE |
| 21 | RELEASE_MANAGEMENT | Release engineering | DONE |
| 22 | DEBUGGING_PROTOCOL | Debugging | DONE |
| 23 | ROOT_CAUSE_ANALYSIS | RCA | DONE |
| 24 | MEMORY_AND_CONTEXT | Engineering memory/context | DONE |
| 25 | ARCHITECTURE_DECISIONS | ADR practice | DONE |
| 26 | FEATURE_DEVELOPMENT | Feature lifecycle | DONE |
| 27 | QA_SIGNOFF | QA gate and sign-off | DONE |
| 28 | CEO_MODE | Executive reporting | DONE |
| 29 | CONTINUOUS_IMPROVEMENT | Kaizen / evolution | DONE |

## Extension Modules

The AEOS core is platform-agnostic. Vendor- and platform-specific bindings live in `docs/extensions/` so the core operating system stays reusable across projects. The reconciliation principle: the AEOS core defines *how to engineer well* regardless of vendor, and each extension binds that core to one concrete platform. For the live Alfanumrik web app, the binding reality is Vercel (bom1/Mumbai) for hosting plus Supabase for database, auth, and Edge Functions; payments run on Razorpay; AI runs on Anthropic Claude (invoked via Supabase Edge Functions). A full AWS ECS/CloudFront migration path is documented but currently dormant (gated off, Route 53 weight 0).

- `docs/extensions/anthropic.md` - Anthropic Claude API usage, model selection, and AI-safety binding for Foxy/NCERT/quiz Edge Functions.
- `docs/extensions/aws.md` - AWS account, IAM, and infrastructure binding (the dormant migration target).
- `docs/extensions/cloudfront.md` - CloudFront CDN/edge configuration for the dormant AWS path.
- `docs/extensions/ecs.md` - ECS/Fargate container orchestration for the dormant AWS migration path.
- `docs/extensions/github-actions.md` - GitHub Actions CI/CD pipeline binding (workflows, gates, secrets).
- `docs/extensions/razorpay.md` - Razorpay payment integration, webhook verification, and subscription binding.
- `docs/extensions/supabase.md` - Supabase Postgres, RLS, RPC, Auth, and Edge Function binding (live backend).
- `docs/extensions/vercel.md` - Vercel hosting, build, and deployment binding (live web host, bom1/Mumbai).

## Operational Layer (v1.1)

The v1.1 release adds an operational layer of 12 documents across four new top-level folders (`playbooks/`, `runbooks/`, `guides/`, `checklists/`). Where v1.0 establishes the *standards and principles* (how to engineer well), v1.1 provides the *operational how-to* (how to run, operate, optimize, and recover the platform day to day). The two layers are complementary: v1.0 is the constitution, v1.1 is the operating manual.

### Playbooks (`playbooks/`)

- `playbooks/ai-workflows.md` - end-to-end AI workflow playbooks for building and shipping AI features.
- `playbooks/prompt-engineering.md` - prompt design, iteration, and template conventions.
- `playbooks/ai-evaluation.md` - AI evaluation methodology, quality metrics, and repeatable harness.
- `playbooks/mcp-playbooks.md` - MCP server operations and integration playbooks.

### Runbooks (`runbooks/`)

- `runbooks/aws-operations.md` - AWS operational procedures for the cloud platform.
- `runbooks/github-operations.md` - GitHub operations (repos, CI/CD, workflow management).
- `runbooks/sre.md` - site reliability engineering procedures and on-call practice.
- `runbooks/disaster-recovery.md` - disaster recovery procedures with explicit, testable recovery steps and objectives.
- `runbooks/supabase-operations.md` - Supabase operational procedures (database, RLS, Edge Functions).

### Guides (`guides/`)

- `guides/optimization.md` - systematic optimization guidance across the stack.
- `guides/performance-tuning.md` - performance tuning techniques and measurement practice.

### Checklists (`checklists/`)

- `checklists/operational-checklists.md` - consolidated operational checklists for routine and incident workflows.

## Autonomy Layer (v2.0)

The v2.0 release ("Governed Autonomous Engineering") adds an autonomy layer of 11 documents across three new top-level folders (`autonomy/`, `memory/`, `enterprise/`). It enables governed, multi-agent autonomous engineering with memory, planning, verification, architecture review, and enterprise oversight. These docs are documentation-level bridges to the real agent substrate already living in the repository: the root `agents/` L1-L8 mesh and the `.claude/` agent, skill, and hook system. v1.0 = standards, v1.1 = operations, v2.0 = governed multi-agent autonomy (bridging the repo's real `agents/` L1-L8 mesh and `.claude` agent system), with product invariants P1-P15 always supreme. Where any autonomy guidance and a product invariant or human-approval gate disagree, the invariant and the gate win.

### Autonomy (`autonomy/`)

- `autonomy/multi-agent-orchestration.md` - multi-agent orchestration model: agent roles, ownership boundaries, and handoff protocols.
- `autonomy/specialized-agents.md` - catalog of specialized agents and their domains, mapped to the real `agents/` L1-L8 mesh and `.claude` agents.
- `autonomy/agent-governance.md` - guardrails, approval gates, and audit/traceability for autonomous agent actions.
- `autonomy/autonomous-planning.md` - autonomous planning protocol with explicit acceptance gates before work proceeds.
- `autonomy/autonomous-verification.md` - autonomous, evidence-based verification gates that must pass before work is considered done.
- `autonomy/autonomous-architecture-review.md` - autonomous architecture review with explicit acceptance criteria.

### Memory (`memory/`)

- `memory/engineering-memory.md` - engineering memory schema with defined read/write/retention rules.
- `memory/knowledge-graph.md` - knowledge-graph schema and read/write/retention rules connecting engineering knowledge.

### Enterprise (`enterprise/`)

- `enterprise/enterprise-governance.md` - enterprise governance exposing measurable engineering and operational signals.
- `enterprise/executive-reporting.md` - executive reporting surfaces for engineering and operational oversight.
- `enterprise/platform-evolution.md` - platform-evolution guidance for continuous, governed change over time.

## Document Standard

Every AEOS document must include, in order:

1. Title (`# NN_NAME.md` then the AEOS banner heading)
2. Metadata block - Document Version, Classification, Priority, Applies To
3. Purpose
4. Scope
5. Engineering rules / standards (the body)
6. Verification checklist (a "Definition of ... Readiness" or "Review Checklist" section)
7. References - links to related AEOS documents
8. Final Directive, then the literal line: **End of Document**

Rules: production-quality, internally consistent, cross-referenced, technically accurate, no placeholder content, consistent terminology, platform-agnostic core (vendor specifics belong in extensions), ASCII-only characters.

## Versioning Policy

Semantic Versioning. Every release updates `VERSION`, `CHANGELOG.md`, and `ROADMAP.md` (plus migration notes when applicable). Releases are marked with git tags (`aeos-vMAJOR.MINOR.PATCH`). Backward compatibility is preserved whenever practical.

See `ROADMAP.md` for v1.0 -> v1.1 -> v2.0 scope.
