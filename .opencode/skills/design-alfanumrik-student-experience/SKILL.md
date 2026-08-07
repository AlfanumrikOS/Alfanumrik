---
name: design-alfanumrik-student-experience
description: Design, implement, audit, or repair Alfanumrik's student-facing frontend, dashboard, UI system, user experience, and information architecture. Use for Student Dashboard, Today, Learn, Practice, Progress, More, Foxy tutor surfaces, adaptive learning journeys, responsive navigation, mobile or desktop layouts, Next.js components, design specifications, wireframes, usability reviews, accessibility reviews, frontend refactors, and production-readiness work for the Alfanumrik Adaptive Learning OS.
compatibility: opencode
---

# Design Alfanumrik Student Experience

Create a calm, adaptive, evidence-led learning workspace that tells a student what to do next, helps them act, and makes improvement understandable. Treat the dashboard as a learning control surface, not a collection of cards or an ERP home page.

## Load the right references

- Read [references/experience-contract.md](references/experience-contract.md) for any UI, UX, interaction, visual-system, or Foxy task.
- Read [references/information-architecture.md](references/information-architecture.md) for navigation, routes, page hierarchy, screen maps, or journey design.
- Read [references/implementation-and-quality.md](references/implementation-and-quality.md) before writing or changing frontend code, auditing a repository, or declaring work complete.

Inspect the actual repository, product brief, routes, types, data contracts, screenshots, and design tokens when available. Treat newer user-provided decisions and functioning code as authoritative. Do not invent endpoints, metrics, or completed capabilities.

## Choose the operating mode

Use the smallest mode that satisfies the request:

1. **Design**: Produce the IA, screen anatomy, responsive behavior, component model, states, interactions, and acceptance criteria.
2. **Implement**: Inspect the codebase, make a thin vertical slice functional, validate it, and provide evidence.
3. **Audit**: Trace routes, data, actions, responsive behavior, accessibility, and adaptive logic; report findings by severity with file evidence.
4. **Repair**: Reproduce the failure, identify its owning layer, fix the root cause, and test the affected journey.

If the request is broad, prioritize this functional slice:

`sign in -> Today -> recommended action -> learning or practice session -> feedback -> updated evidence -> next action`

Do not repaint legacy screens when the requested change belongs to the approved mobile-first experience. Preserve unrelated user changes.

## Establish the learner context

Infer available context before asking questions. Establish only what materially changes the result:

- learner age or grade band
- school tenant and white-label constraints
- device and connectivity conditions
- requested mode and target journey
- existing frontend stack and repository state
- real data availability and adaptive-engine readiness

When context is incomplete, design for a middle-school learner, 360 px mobile first, responsive through large desktop, touch and keyboard access, variable connectivity, and real-data empty states.

## Apply the experience hierarchy

Keep the primary student navigation stable and ordered:

1. **Today** — the prioritized, explainable learning queue
2. **Learn** — subjects, chapters, concepts, and concept sessions
3. **Practice** — adaptive, review, assignment, exam, and mock modes
4. **Progress** — mastery evidence, growth, habits, and next steps
5. **More** — notebook, saved items, achievements, settings, help, and safety

Keep the same destinations across breakpoints. Change the navigation presentation, not the student's mental model. Make the current location and the next useful action obvious.

## Make adaptation visible and honest

Render backend-owned recommendations and evidence; never simulate intelligence in presentation code.

- Explain recommendations with concise reason labels such as “Review due”, “Build this prerequisite”, or “Ready for a challenge”.
- Show the source and freshness of learning evidence when it affects interpretation.
- Keep mastery, retention, confidence, difficulty, and next-action semantics distinct.
- Do not calculate authoritative mastery or adaptive sequencing in the browser.
- Do not imply that IRT, SRS, CME, DKT/BKT, personalization, or outcome guarantees work unless the inspected data path proves it.
- Provide truthful loading, unavailable, insufficient-evidence, and recovery states.

## Use Foxy with restraint

Treat Foxy as the contextual learning brain and companion, not a decorative chatbot.

- Provide one persistent but non-blocking entry point.
- Carry learner, concept, attempt, language, modality, and safety context through real contracts.
- Prefer short actions: Explain simpler, Give an example, Hint, Quiz me, Save to notebook, and Report issue.
- Keep the current task visible while Foxy opens.
- Support age-appropriate language, vernacular interaction, voice readiness, privacy, and escalation.
- Never let Foxy fabricate mastery, grades, teacher messages, or learning history.

## Design the complete state model

For every data-bound region and action, define:

- loading or skeleton
- loaded with meaningful data
- empty or insufficient evidence
- partial or stale data
- recoverable error and retry
- offline or interrupted session when relevant
- locked, unavailable, or permission-limited content
- completion, confirmation, and undo when applicable

Every visible control must work, be disabled with a reason, or be removed. Do not ship dead buttons, false affordances, or placeholder analytics.

## Build journeys before surfaces

For each requested experience:

1. State the learner's goal and the measurable completion condition.
2. Map entry, decision, action, feedback, recovery, and exit.
3. Identify the owning data and adaptive decision for each step.
4. Define mobile behavior first, then tablet and desktop composition.
5. Specify components, states, accessibility, analytics, and acceptance criteria.
6. Implement or review the smallest end-to-end slice.
7. Test interaction, responsiveness, real data, and failure states.

Prefer progressive disclosure. Keep the primary action above secondary analytics. Use recognition over recall and plain learner language over system terminology.

## Protect the product boundary

Keep fees, billing, transport, vehicle routes, and generic school ERP features outside the student experience unless the user explicitly changes scope. Razorpay platform payments do not justify payment clutter on the learner dashboard.

Do not expose internal engine acronyms to students. Translate them into useful reasons and actions.

## Produce decision-ready outputs

For a **design specification**, include:

- learner problem and desired outcome
- IA or route map
- primary journey
- screen anatomy and component inventory
- responsive behavior
- state and permission matrix
- accessibility and safety requirements
- data dependencies and event plan
- acceptance criteria and open risks

For **implementation**, include working code, tests, and preview or verification evidence when the environment permits. Follow existing conventions unless they conflict with a documented migration decision.

For an **audit**, lead with the verdict. For each finding provide severity, user impact, evidence, root cause, and recommended correction. Separate verified facts from inference.

## Completion rule

Do not declare the student dashboard complete because it renders. Require a functional primary journey, truthful data, responsive behavior, accessible interaction, defined failure recovery, and evidence that the requested adaptive behavior reaches the UI.
