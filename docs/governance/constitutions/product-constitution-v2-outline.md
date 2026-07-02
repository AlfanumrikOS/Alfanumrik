# Product Constitution (Outline - not a draft)

Status: SCOPED, deliberately not drafted in depth. Depends on the Product Manager and Curriculum
and Learning Expert roles, neither of which exists yet. Partially draftable sooner than the
Design Constitution, since existing certification-program material (report 04 and report 06 of
the Phase 4 program) already establishes a working pattern for the outcomes half of this
document - but the requirements-lifecycle half genuinely needs a Product Manager to author.

## What this document will need to cover, once the Product Manager and Curriculum and Learning
Expert roles are ratified and can co-author it

1. **Requirement lifecycle.** How a feature request becomes a scoped, prioritized piece of work -
   who can propose one, what information it must carry before architect or any builder role may
   start, and how priority conflicts between requests are resolved.
2. **Acceptance criteria.** A standard shape for what "done" means, written before implementation
   begins, testable by the testing agent without further clarification from the Product Manager.
3. **Educational quality gates.** Curriculum and Learning Expert own gate before any pedagogy-
   adjacent change (scoring, Bloom taxonomy, adaptive progression, question bank content)
   reaches certification - distinct from assessment own engineering-correctness gate.
4. **Curriculum validation.** How CBSE curriculum accuracy is checked - who has the subject-
   matter authority to confirm a question, explanation, or concept mapping is actually correct
   for the stated grade and board, and how that authority differs from assessment own mechanical
   validation (distractor count, non-empty fields, valid difficulty).

## What already exists that this document should build on, not ignore

- Report 04 (user journey certification) and report 06 (business rules certification) from the
  Phase 4 program already establish a per-role, per-outcome verification pattern - the Product
  Constitution requirement-lifecycle section should produce acceptance criteria in a shape that
  slots directly into that same verification pattern, not a new, incompatible format.
- The existing product invariants P1 through P6 already encode several educational-correctness
  rules (score formula, question quality) at the engineering level - this document governs the
  process for deciding new rules like these, not a replacement for the ones that already exist.

## Recommended first step once the roles exist

Product Manager and Curriculum and Learning Expert jointly review the Phase 4 program own
finding that coupon and referral logic exist only as database schema with no application code -
a live, real example of a requirement that was apparently scoped at some point but never
completed - as a concrete case study for what the requirement lifecycle should have caught.
