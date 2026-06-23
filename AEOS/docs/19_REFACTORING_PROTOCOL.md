# 19_REFACTORING_PROTOCOL.md

# Alfanumrik AI Engineering Operating System (AEOS)

**Document Version:** 1.0
**Classification:** Mandatory Refactoring Standard
**Priority:** Critical
**Applies To:** Every change whose purpose is to improve the internal structure of existing code without altering its observable behavior.

---

# Purpose

This document establishes the mandatory protocol for safe refactoring.

Its objective is to ensure that structural improvement of existing code is:

- behavior-preserving,
- protected by tests before it begins,
- incremental and reversible,
- separated from feature work,
- bounded in scope,
- verified by evidence.

Refactoring improves the long-term health of a system. Done carelessly, it is one of the most common sources of silent regressions. This protocol exists to capture the benefit while eliminating the risk.

These standards apply regardless of language, framework, repository, or runtime.

---

# Refactoring Philosophy

Refactoring is governed by one definition above all others:

Refactoring changes the structure of code without changing its observable behavior.

If observable behavior changes, the work is not a refactor. It is a feature change, a bug fix, or a redesign, and it must be treated as such with the corresponding scrutiny.

The promise a refactor makes to the rest of the system is precise: inputs that produced a given output before the change produce the same output after the change. Everything else may move, merge, split, or be renamed. That contract is the entire foundation of safe refactoring.

A refactor that quietly alters behavior is a defect disguised as cleanup. It is more dangerous than an honest change because no one was looking for a behavioral difference.

---

# Why We Refactor

Refactoring is justified when it serves a concrete engineering goal:

- reducing duplication,
- clarifying intent,
- lowering cognitive complexity,
- improving testability,
- isolating responsibilities,
- removing dead code,
- preparing the ground for an upcoming change.

Refactoring is not justified by taste alone. Restructuring code merely because a different shape is personally preferred introduces risk without delivering value. Every refactor must be able to name the concrete problem it solves.

---

# Preconditions

A refactor may not begin until its preconditions are satisfied. These are not optional.

## Tests Must Exist

The code being refactored must be covered by tests that assert its observable behavior. Those tests are the safety net. Without them, there is no mechanism to prove that behavior was preserved.

If adequate tests do not exist, they must be written first, against the current behavior, and they must pass before any structural change is made. Writing characterization tests for existing behavior is itself a legitimate and frequently necessary first step.

## Tests Must Pass First

The full relevant test suite must be green before the refactor starts. Refactoring on top of a failing suite makes it impossible to distinguish a pre-existing failure from one the refactor introduced.

## A Clean Starting Point

The working tree should be free of unrelated uncommitted changes. A refactor begins from a known, committed, verified state so that the difference it introduces is exactly the refactor and nothing else.

---

# Incremental and Atomic Refactoring

Refactoring proceeds in small, complete steps. Each step is atomic: it leaves the system in a valid, fully working state.

The mandatory rhythm:

```text
Confirm green tests
        v
Apply one small structural change
        v
Run the tests
        v
Tests green
        v
Commit the step
        v
Repeat
```

A small step that can be verified and committed is always preferable to a large step that cannot. When a refactor is broken into small atomic steps, a failure points directly at the single change that caused it, and recovery is a matter of reverting one step rather than untangling many.

Never accumulate a large body of unverified structural change. The longer a refactor runs without verification, the harder it becomes to locate the moment behavior diverged.

Each atomic step should be independently revertible. If a step cannot be cleanly reverted, it is too large.

---

# Separate Refactors From Feature Work

A single change must not both restructure code and alter behavior. This is the most important operational rule in this document.

When a refactor and a feature are mixed in one change:

- the reviewer cannot tell which diff lines are safe restructuring and which lines change behavior,
- a regression caused by the feature hides among the noise of the refactor,
- reverting the feature also reverts the refactor, and the reverse,
- the safety guarantee of behavior preservation is lost entirely.

The discipline:

- refactor first, in its own change, verified green, then build the feature on the cleaned-up structure,
- or build the feature first, then refactor in a separate follow-up change.

Never interleave the two. If a feature is easier to build after a refactor, do the refactor as a distinct, separately verified change before starting the feature.

---

# Scope Discipline

A refactor must declare its scope before it begins, and it must stay within that scope.

Scope creep is the characteristic failure mode of refactoring. A change that begins as renaming one function expands into restructuring a module, then a subsystem, until the diff is too large to review and too risky to merge.

Rules for scope:

- state what will be changed and, equally, what will not,
- resist the urge to fix unrelated problems discovered along the way,
- record unrelated issues for a future change rather than absorbing them,
- if the scope must grow, stop, re-plan, and treat the expansion as a new refactor with its own preconditions.

A tightly scoped refactor that ships is worth more than an ambitious one that becomes unmergeable.

---

# Risk Assessment

Before refactoring, assess the blast radius. Not all refactors carry equal risk, and the level of caution must match the risk.

Consider:

- how many call sites depend on the code,
- whether the code crosses a module or service boundary,
- whether the code touches a product invariant or a security boundary,
- the quality and coverage of the existing tests,
- whether the behavior is fully understood or only partially.

Higher-risk refactors demand smaller steps, stronger test coverage established first, and closer diff review. A refactor of a widely-depended-upon core path is not the same undertaking as a refactor of an isolated helper, and must not be approached with the same casualness.

Where a refactor touches a protected invariant defined by a higher-authority document, the constraints of that document govern. The refactor must preserve the invariant exactly.

---

# Verification

A refactor is verified by two independent means, and both are required.

## Tests

The same test suite that was green before the refactor must be green after it, without modification to the assertions. The assertions describe behavior; if they had to change to make the suite pass, behavior changed, and the work was not a pure refactor.

Tests may be added during a refactor. Existing behavioral assertions must not be weakened, deleted, or relaxed to accommodate the restructuring. Weakening an assertion to make a refactor pass conceals exactly the regression the test exists to catch.

## Diff Review

Every refactor requires a careful reading of the diff. The reviewer confirms that each change is structural and that no line silently alters behavior. Passing tests are necessary but not sufficient: tests only catch what they assert, and the diff review is the defense against behavioral drift in untested corners.

The reviewer asks, for every changed line, whether it could change what the system does. If the answer is anything other than a confident no, the line is investigated before the refactor is accepted.

---

# When Not To Refactor

Refactoring is a tool, not a reflex. There are conditions under which the correct decision is to leave the code alone.

Do not refactor when:

- the code is not covered by tests and tests cannot be written first,
- the change is being made under time pressure alongside an urgent fix,
- the behavior of the code is not fully understood,
- the refactor cannot be separated from a feature already in progress,
- the code is scheduled for imminent removal or replacement,
- the only justification is personal stylistic preference,
- the blast radius is large and the available verification is weak.

Stable, working, well-understood code that no upcoming change will touch carries little benefit from restructuring and real risk from it. The cost of a regression in a quiet, working path frequently exceeds the value of making it marginally tidier.

Choosing not to refactor is a legitimate engineering decision. Record the reasoning so the deferral is deliberate rather than forgotten.

---

# Documentation and Communication

When a refactor changes the shape of a public interface, a shared module, or a documented pattern, the corresponding documentation must be updated in the same change.

Internal restructuring that does not alter any external contract needs no documentation change, but the intent of the refactor should be captured in the commit so that future readers understand why the structure moved.

A refactor that leaves stale documentation behind has shifted the inconsistency from the code to the docs rather than resolving it.

---

# Common Refactoring Operations

The following are the recognized, low-risk structural operations. Each preserves behavior by construction when applied carefully.

- Rename: give a symbol a name that better describes its intent, updating every reference.
- Extract: pull a coherent block into a named function, method, or module so the responsibility is isolated and reusable.
- Inline: fold a trivial indirection back into its single call site when the indirection no longer earns its keep.
- Move: relocate code to the module where it conceptually belongs.
- Consolidate: merge duplicated logic into one shared implementation.
- Split: divide a unit that has accumulated more than one responsibility.

Each operation should be applied as its own atomic step, verified by the test suite before the next operation begins. Combining several operations into a single unverified step reintroduces the very risk this protocol is designed to remove.

---

# Refactoring Generated Code

Code produced by an AI assistant is held to the identical standard. Generated structure is not exempt from the behavior-preservation contract.

When restructuring generated code:

- the same preconditions apply, tests must exist and pass first,
- the same scope discipline applies, the change does its one declared job,
- the same diff review applies, every line is read and confirmed structural.

A refactor is judged by what it does to the system, not by who or what authored the original code. There is no shortcut for generated code.

---

# Rollback Posture

Because every refactor proceeds in atomic, individually committed steps, rollback is simple by design.

If a step is found to have introduced a regression:

1. Stop.
2. Identify the single step responsible from the commit history.
3. Revert that step.
4. Confirm the suite returns to green.
5. Re-plan the step with a smaller scope or stronger tests before reattempting.

A refactor that cannot be cleanly rolled back was not broken into small enough steps. The ability to revert one step without disturbing the others is a direct consequence of the atomic discipline and is itself a sign that the refactor was conducted correctly.

---

# Refactoring Readiness Checklist

Before a refactor is considered complete, verify:

- Is the goal of this refactor a concrete engineering improvement, not mere preference?
- Did behavior-asserting tests exist and pass before the refactor began?
- Was the working tree clean and committed at the starting point?
- Was the refactor kept strictly separate from feature work and bug fixes?
- Was the change broken into small, atomic, individually verified steps?
- Did each step leave the system in a valid, working state?
- Was the scope declared in advance and held without creep?
- Was the blast radius assessed and the caution matched to the risk?
- Do the original behavioral assertions still pass without being weakened?
- Was every line of the diff reviewed to confirm it is structural, not behavioral?
- Were any touched product invariants preserved exactly?
- Was affected documentation updated in the same change?
- Is the refactor independently revertible?

If any answer is No, address it before completion.

---

# References

This document operates within the AEOS hierarchy and must be read together with:

- 04_CODING_STANDARDS - the readability, duplication, and structure goals that refactoring serves.
- 05_ARCHITECTURE_STANDARDS - the boundaries and responsibilities that refactoring must respect.
- 08_TESTING_PROTOCOL - the test coverage and evidence discipline that makes safe refactoring possible.
- 10_VERIFICATION_ENGINE - the evidence-over-confidence execution model that governs how a refactor is verified and reported.

Where this document and a higher-authority document appear to conflict, the higher-authority document prevails. The authority order is the project-root constitution, then AEOS/MASTER_SYSTEM_PROMPT.md, then AEOS/EXECUTION_ENGINE.md, then the numbered AEOS documents (00-29), then extensions, then the task.

---

# Final Directive

Refactoring is how a codebase stays healthy over years rather than decaying under accumulated change.

Never refactor without a safety net of passing tests.

Never mix restructuring with behavior change.

Never let a refactor grow beyond the scope it declared.

The measure of a good refactor is that the system behaves identically and the next engineer understands it more easily. If behavior changed, it was not a refactor, and it must be treated with the honesty that a behavior change demands.

**End of Document**
