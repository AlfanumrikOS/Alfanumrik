# Proposal: Add a Product Organization alongside the Engineering agent system

Status: PROPOSED, not adopted. Written 2026-07-02 in response to a CEO recommendation made
during the Phase 4 certification program. This document is a design for review, not a change
already made to the live agent system - see "Why this is not wired in yet" at the end.

## The 7 proposed roles, with boundaries against existing agents

The existing 10-agent system already covers some of what these roles would do, in engineering
terms. Each proposed role below states its purpose as given, plus where it draws a line against
an existing agent so two roles never own the same decision (matching the existing conflict-
resolution principle: an owning agent word is final within its domain, and ambiguous overlap
gets resolved by the orchestrator, not left to two roles quietly disagreeing).

| Role | Purpose | Boundary against existing agents |
|---|---|---|
| Product Manager | Defines feature scope, priorities, acceptance criteria before implementation | Runs upstream of every builder agent. Architect, backend, frontend, assessment, ai-engineer, and mobile still make all technical-design decisions within the scope this role sets - PM does not design the schema or the UI, it defines what done means before those roles start |
| UX/UI Director | Owns the design system, interaction quality, accessibility | Takes over the UX audit review line item currently sitting with quality (domain ownership row 28), freeing quality to focus on code quality, type safety, and duplication. Frontend still implements; this role reviews and can request changes, the same review authority shape quality already has today |
| Business Analyst | Verifies business rules, educational workflows, subscriptions, reporting logic | The most overlap-prone role: assessment already owns scoring, XP, and business-rule correctness; backend already owns subscriptions and payments logic. Recommend scoping this role as a synthesis and coordination function - it pulls together assessment and backend own domain verdicts into one coherent cross-cutting business-workflow view, rather than re-deriving business-rule correctness independently. Assessment and backend keep final authority within their own domains |
| Curriculum and Learning Expert | Reviews educational correctness, pedagogy, adaptive learning, assessment quality | Distinct from assessment: assessment owns the engineering correctness of the scoring, Bloom taxonomy, and mastery mechanisms; this role owns whether those mechanisms reflect sound CBSE pedagogy and real teaching practice. Assessment builds the mechanism, this role validates the educational soundness - a genuinely new kind of review, not a duplicate |
| Data and Analytics Lead | Validates telemetry, dashboards, KPIs, reporting integrity | Splits off the analytics and reporting half of ops current charter, the same way backend split off from an undifferentiated server-work role historically. Ops keeps the super-admin panel, feature flags, monitoring, and docs; this role owns whether the numbers on every dashboard are actually correct and complete |
| Release Manager | Owns release planning, certification schedules, production readiness gates | Close to the function this session Release Management directive asked the orchestrator to perform ad hoc. Recommend formalizing it as a distinct role rather than continuing to fold it into the orchestrator, so release governance has a consistent owner across sessions |
| Customer Success Reviewer | Evaluates real-world usability from the perspective of students, teachers, parents, schools, and administrators | A genuinely new lens - not code quality, not visual or interaction design, but whether a real user in a given role actually succeeds at their goal. Reviews finished, working features from an outcomes perspective |

## Where each role sits in the pipeline

If the 10-phase SDLC proposed alongside this document is adopted, the mapping is: Product
Manager and Business Analyst are primary owners of Discovery and Requirements; UX/UI Director
joins Architecture and Design Review for anything user-facing; Curriculum and Learning Expert
and Business Analyst join Business Workflow Validation; Data and Analytics Lead joins
Post-Deployment Monitoring and any phase touching reporting or telemetry; Release Manager owns
Production Certification and Executive Release Approval end to end; Customer Success Reviewer
joins Business Workflow Validation and Post-Deployment Monitoring, evaluating outcomes rather
than code.

## Tool access recommendation

None of these 7 roles should have edit or write access to application source code, migrations,
or Edge Functions - that would blur the line the existing system deliberately draws between
building and reviewing or defining. Recommend read-only access to the full codebase, plus write
access scoped to each role own documentation tree (a specs folder for Product Manager, a
governance folder for Release Manager, a UX folder for UX/UI Director, and so on) - the same
shape testing and quality already have today.

## Review chain implications

Adding these roles means the review-chain matrix, currently defined for 15 change types, needs
new rows - for example a new feature or scope change should require Product Manager sign-off
before architect, backend, or frontend begin work; a pedagogy or CBSE content change should
require Curriculum and Learning Expert sign-off alongside assessment; a new dashboard or KPI
should require Data and Analytics Lead sign-off. This is a real, non-trivial edit to the
existing review-chain matrix, not just an additive list of new names.

## Why this is not wired into the live agent system yet

Two separate reasons, stated plainly rather than glossed over:

1. Tooling. Actually creating new agent definitions and editing the files that govern the live
   agent system - the domain-ownership table, the review-chain matrix, the routing table, and
   the session default-agent configuration - requires file-editing tool access this session does
   not have. The session own protective guard rails explicitly block exactly this class of edit
   when attempted through the fallback tool that is available. This is a hard constraint, not a
   judgment call.
2. Design maturity. Even with the right tooling, this is a bigger structural change than a docs
   pass - it touches every existing review chain, needs the overlap boundaries above actually
   agreed rather than just proposed, and benefits from being done as its own dedicated,
   reviewable task rather than appended to the tail of an already long certification session.
   The existing constitution already flags changes to the agent system itself as requiring
   explicit approval for exactly this reason - approval in principle is being given here, and
   this document is the design that approval would apply to, but the recommendation is a
   dedicated follow-up session to implement it carefully.

## Recommended next step

Confirm this design, or send back changes, then run a dedicated implementation task with
file-write access available that creates the 7 agent definitions, updates the domain-ownership
and review-chain tables, and updates the constitution own routing rules, with quality reviewing
the result the same way it reviews any other change to this codebase governing files.
