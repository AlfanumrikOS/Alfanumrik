# Quality Review: Ratification readiness of Engineering Constitution v2 and Release Constitution v2

Reviewer: quality agent. Scope: governance-document consistency review only, per the initiative
plan's own ratification process. No application code was touched by this review; no file other
than this one was modified.

Documents read in full: the initiative plan, both constitution drafts (Engineering v2, Release
v2), the live project-level constitution file (agent roster / domain ownership / product
invariants), the live top-level project-instructions file, the Product Organization proposal,
the permanent-SDLC proposal, plus spot-checks against several documents under
docs/audit/2026-07-02-certification/ (executive summary, production-readiness scorecard, risk
register, environment-readiness consolidated verdict, architect Stage-1 findings, the ERG-1
gate document, and the Executive Release Board decision package).

## Automated Checks

N/A. This is a documentation-only review; no code was changed, so type-check / lint / test /
build are not applicable. Regression catalog is unaffected.

## Findings

| # | Severity | Location | Issue |
|---|----------|----------|-------|
| 1 | BLOCKER | engineering-constitution-v2-draft.md Section 6 vs Section 1/2 | Section 6 claims "the existing 10 engineering agents core charters are unchanged by this version." This is false as written elsewhere in the same document. Section 1's role table for quality no longer lists the UX-audit line item the live constitution's domain-ownership table (row 28, "UX audit -- Owner: quality") currently assigns it, and Section 2 confirms the removal: "UX/UI Director inherits the UX-audit authority previously held by quality." Likewise Section 2 states "Data and Analytics Lead owns whether dashboard numbers are correct and complete. Ops retains ownership of everything else" -- removing the analytics/reporting-integrity half of ops's current charter (live domain-ownership rows 16-17). These are real charter changes to two of the ten existing agents, not additions of a new reviewer alongside an unchanged charter (contrast with assessment/backend, whose Build authority is explicitly preserved under the Business Analyst/Curriculum-Expert boundary language -- a materially different, non-charter-changing situation). Section 6 must be corrected to say something like "unchanged except for the two explicit reassignments in Section 2 (UX-audit line item from quality to UX/UI Director; analytics/reporting-integrity from ops to Data and Analytics Lead)." As drafted, a reader who trusts Section 6 without cross-reading Section 2 gets a wrong picture of what ratifying this document does to two live agents. |
| 2 | BLOCKER | engineering-constitution-v2-draft.md Section 3 rule 3 vs live constitution's "User Approval Required For" list | Section 3 rule 3 lists categories that "escalate directly to you [CEO]. No role... has authority to resolve these": product invariant, agent-system change, data-dropping schema change, pricing change, AI model/provider change, new CBSE subject. This list silently drops "RBAC role or permission additions," which is explicitly present in the live constitution's approval list today. Section 6 simultaneously claims this version "does not remove or weaken any existing control." As literally written, a disagreement over adding a new RBAC role/permission would now resolve via rules 1-2 (Build/Verify, then orchestrator) rather than going straight to the CEO -- a real weakening of an existing control. Must either add RBAC/permission additions back into rule 3's list, or state explicitly that this is a deliberate, separately-approved change -- it cannot be silently absent while Section 6 claims nothing was weakened. |
| 3 | BLOCKER | engineering-constitution-v2-draft.md Section 4 (Release Manager row) vs release-constitution-v2-draft.md Section 5 | Direct cross-document contradiction on who actually decides whether a release proceeds. Engineering Constitution v2's veto table gives Release Manager an individual veto: "Can veto: Whether a release proceeds, pending Executive Release Board sign-off." Release Constitution Section 5 assigns that decision to the Executive Release Board as a body ("Convened by Release Manager... only then a decision: APPROVED, APPROVED WITH CONDITIONS, or REJECTED") -- a multi-stakeholder group (per the actual session artifact, the Executive Release Board decision package: "Prepared for: CTO, Chief Architect, Product Lead, QA Lead, Security Lead, AI Lead, DevOps Lead, UX Lead. Prepared by: Release Management (orchestrator)"). Release Constitution nowhere grants Release Manager a personal veto; it only grants "any engineer with deploy access" rollback authority (Section 7), a different power. As drafted, the two documents disagree about a first-order governance question -- whether one role can personally block a release, or whether that authority belongs only to the convened Board. Must be reconciled in both documents before either is ratified: either strip the individual veto from Engineering Constitution v2's table, or add that personal-veto grant explicitly to Release Constitution Section 5. Ratifying one document without correcting the other leaves this contradiction live. |
| 4 | MAJOR | engineering-constitution-v2-draft.md Section 3 rules 3 and 4 | Logical gap in escalation precedence. Rule 3 sends any disagreement "concerning a product invariant" straight to the CEO, bypassing every role including the orchestrator. Rule 4 sends any disagreement "concerning whether a release should proceed" to the Executive Release Board, convened by Release Manager, "not to the orchestrator alone." Nothing states which rule governs when a disagreement is both -- the common case for the highest-stakes findings (e.g. this session's real CERT-01 finding: a live-reachable RBAC-adjacent gap that was explicitly the central release go/no-go question in the Board decision package: "The Board should explicitly decide whether to require this fixed before approval"). If a single finding is simultaneously a product-invariant question and a release-gate question, the document gives two different authorities jurisdiction over what is functionally one decision, with no stated precedence or hand-off protocol. Add an explicit rule resolving precedence between rule 3 and rule 4. |
| 5 | MAJOR | engineering-constitution-v2-draft.md Section 3 | Related, narrower gap: rules 1-2 are scoped to "a disagreement between a Build owner and a Verify owner within one domain." They do not address disagreement between two Verify roles reviewing the same change for different reasons (e.g. UX/UI Director approves a frontend change on accessibility grounds while Curriculum and Learning Expert vetoes the same change on pedagogy grounds). Rule 2's "if unresolved, it escalates to the orchestrator" plausibly covers this by generous reading, but is textually scoped to the Build-vs-Verify case from rule 1, not stated as a general catch-all. Recommend rule 2 be reworded to cover any unresolved disagreement between roles generally. |
| 6 | MAJOR | engineering-constitution-v2-draft.md Section 5 vs the permanent-SDLC proposal and the initiative plan's absorption claim | Does Engineering Constitution v2 genuinely absorb the SDLC proposal? Not in operative substance. Section 5 is two sentences: it imports only the proposal's two-track refinement (full 10-phase for risk-bearing changes, existing loop for low-risk changes) but never reproduces, or even names, the 10 phases, their owners, or -- critically -- the proposal's own "Gate criteria per phase" table (the explicit entry/exit condition per phase, which the source proposal itself says exists "so this is enforceable rather than aspirational... or a mandatory phase becomes a checkbox nobody actually verifies"). If the standalone SDLC proposal document is retired now that its content is claimed "absorbed" (per the initiative plan: "No content is lost; it is being organized into the four-document structure"), the phase list and gate criteria vanish from ratified governance entirely -- nothing in Engineering Constitution v2 defines what "full 10-phase process" concretely requires. If instead the proposal document is meant to stay authoritative by reference, the initiative plan's "not existing as a separate track" claim is inaccurate. Fix: either inline the phase-to-owner table and gate criteria into Section 5, or explicitly state the proposal document remains incorporated by reference and stays live. |
| 7 | MAJOR | engineering-constitution-v2-draft.md Section 1/2 vs the Product Organization proposal | Same absorption gap for the Product Organization proposal. Two concrete, load-bearing pieces are dropped entirely: (a) the "Tool access recommendation" section (no edit/write access to app source/migrations/Edge Functions for any of the 7 new roles; read-only codebase access plus write access scoped to each role's own doc tree) -- a security-relevant permission boundary for 7 new roles about to get real tool configuration in Wave 2, appearing nowhere in Engineering Constitution v2; (b) the "Review chain implications" section (concrete new review-chain-matrix rows: Product Manager sign-off before builder agents begin on scope changes, Curriculum and Learning Expert sign-off alongside assessment for pedagogy changes, Data and Analytics Lead sign-off for new dashboards/KPIs) -- Section 2's "Authority boundaries" discusses adjacency in the abstract but never states the review-chain matrix needs new rows, nor what they'd be. Given this codebase's hooks mechanically enforce agent-ownership-by-file-path and review-chain completeness, omitting the tool-access and review-chain specifics is a genuine content loss with downstream enforcement consequences, not a stylistic compression. |
| 8 | MAJOR | release-constitution-v2-draft.md Section 1 vs Section 3, cross-checked against the production-readiness scorecard and architect Stage-1 findings notes | Spot-check of the "grounded in a process actually exercised this session" claim. Section 1 states Stage 1 (static) "Produces MEDIUM-confidence findings at best -- no live system is touched," corroborated by the actual scorecard ("Stage-1 confidence only (MEDIUM ceiling per the confidence rubric)... no category has live Stage 2/3 verification yet"). But Section 3's confidence rubric defines HIGH as "(live-verified plus independently re-read plus has a regression-catalog pin)," and the actual Stage-1 findings documents this session tagged numerous individual findings HIGH confidence purely from thorough static full-file reads and cross-referencing (e.g. architect-findings.md: "Confidence: HIGH (hand-read the full file, confirmed no remediation anywhere in the chain via exhaustive grep)"; the summary table tags six separate Stage-1-only findings HIGH, none of them live-executed). Read literally, Section 3's HIGH definition would disqualify most of the HIGH tags actually used and relied on this session, while Section 1 and the scorecard simultaneously (and correctly) cap the aggregate Stage-1 confidence at MEDIUM regardless of those per-finding HIGH tags. The constitution conflates two distinct things this session's practice actually kept separate: (a) finding-level confidence -- how thoroughly was this specific claim verified (can legitimately be HIGH from an exhaustive static read); and (b) stage/release-level confidence -- capped by verification stage regardless of how many individual findings are HIGH. Recommend Section 3 be split into these two explicit tiers, with a stated rule that a Stage-1 HIGH-confidence finding still contributes to at most a Stage-1 MEDIUM ceiling for release-readiness purposes. This is not a fabricated process (the underlying practice is real and evidence-first), but the written rubric does not accurately describe the two-tier way confidence was actually used. |
| 9 | MINOR | release-constitution-v2-draft.md Section 7 | "Schema changes are treated as forward-only per this codebase existing convention" is a fair summary but slightly overstates the precision of the actual convention. The migration/rollback runbook documents paired, hand-authored, reviewed "rollback migration" files that sit ready and are applied manually by an operator (closer to "no automatic down-migration tooling; compensating migrations are written and manually applied" than literal forward-only). Low-impact wording nit; the practical effect described (manual, reasoned forward fix, no automatic revert) matches the runbook. |
| 10 | INFORMATIONAL | Both drafts | Positive finding: the ERG-N pattern, the four risk-impact tags (Blocker / Should-Fix-Before-Release / Post-Release-Acceptable / Informational), the Environment Readiness Assessment's six criteria, the "an unchecked gate item with no evidence is the honest default" rule, and the Board's DEFERRED option all check out cleanly against the real session artifacts (risk register, environment-readiness consolidated verdict, the ERG-1 gate document, the Board decision package -- which in fact returned exactly a DEFERRED recommendation, the real-world case the constitution describes). The "evidence-first, independently re-derive rather than cite" claim is well corroborated (the regression-catalog undercount finding and the mobile-default-config escalation for the QUIZ-ACTIVE gap were both independent-re-derivation catches, matching Section 3's narrative closely). This is genuinely session-grounded work, not an idealized retrofit -- the defects found (#3, #8) are specific and fixable, not evidence the whole premise is fabricated. |

## Verdict

- Engineering Constitution v2 (engineering-constitution-v2-draft.md): REJECT.
  Findings #1 and #2 are self-contradictions within the document itself (Section 6's "unchanged /
  not weakened" claims are falsified by Section 2 and Section 3 elsewhere in the same draft) --
  not stylistic issues, factual misstatements about what ratifying the document would actually do
  to two live agents and one existing user-approval control. Finding #3 is an unresolved
  cross-document authority contradiction that must not be ratified while open. Findings #4-#7 are
  real gaps in logical completeness and in the absorption claim the initiative plan makes on this
  document's behalf. None of these require a rewrite from scratch -- all are targeted, specific
  textual fixes -- but they must be corrected and re-reviewed before ratification, per this
  document's own Section 7 ratification bar ("confirmation from each existing agent that its
  charter as restated here matches its actual current behavior" -- a check that, honestly
  applied, would itself have caught findings #1 and #2).

- Release Constitution v2 (release-constitution-v2-draft.md): APPROVE WITH CONDITIONS.
  The document's central claim -- "grounded entirely in a process actually exercised this
  session" -- holds up well under spot-check (finding #10). Conditions, all addressable without
  re-architecting the document: (a) resolve the shared Release-Manager-authority contradiction
  with Engineering Constitution v2 (finding #3 -- one contradiction that must be fixed in both
  documents together, not independently); (b) clarify the two-tier confidence model in Section 3
  so finding-level HIGH tags and stage-level MEDIUM ceilings are both accurately described
  (finding #8); (c) optionally tighten the "forward-only" wording in Section 7 (finding #9,
  minor).

## Overall verdict

NOT ready for ratification as-is. Do not ratify either document today.

Release Constitution v2 is close -- one shared cross-document fix plus one rubric clarification
away from ratifiable. Engineering Constitution v2 needs more substantive correction: two
self-contradictions about what the document itself changes or preserves (findings #1, #2), an
unresolved authority question shared with Release Constitution (finding #3), an undefined
escalation-precedence gap for the (likely common) case where a release decision and a product
invariant question are the same dispute (finding #4), and two "absorption" claims from the
initiative plan that are not actually backed by operative content in the draft (findings #6,
#7).

Because finding #3 spans both documents, they should be corrected and re-submitted together
rather than ratifying Release Constitution now and Engineering Constitution v2 later --
ratifying either alone would leave a live contradiction about who can block a release standing
in the ratified governance set.

Recommended next step: route findings #1-#7 back to whichever agent/process authored these
drafts (the initiative plan names the orchestrator as facilitator) for a targeted revision pass,
then a second quality review limited to the changed sections -- not a full re-review -- before
asking for CEO ratification.

---

# Re-review (revision 2)

Reviewer: quality agent. Scope: targeted re-review of revision 2 of both drafts, limited to the
sections changed in response to findings #1-#9 above, per my own recommendation in the original
review. Both drafts were nonetheless read in full (not just diffed) so that a fix in one section
could be checked against everything else in the document, not just the paragraph it touches.
Source proposals re-read in full for cross-check: 2026-07-02-permanent-sdlc-proposal.md,
2026-07-02-product-organization-proposal.md. The live top-level project-instructions file (the
root-level constitution containing the agent roster and CEO-approval list) was re-checked for the
CEO-approval list and the domain-ownership rows referenced by Section 2's two reassignments.

## Automated Checks

N/A. Documentation-only change; no code touched.

## Per-finding disposition

| # | Original issue | Disposition | Verification |
|---|---|---|---|
| 1 | Section 6 falsely claimed no charter changes while Section 2 removed UX-audit from quality and analytics/reporting-integrity from ops | RESOLVED | Section 2 now explicitly names "the two true charter reassignments" up front. Section 6 rewritten to say "eight of the ten existing engineering agents' charters are unchanged... Two existing agents have a specific, narrow charter change, both stated explicitly in Section 2 and nowhere else." Section 1's role table entries for quality and ops both carry an inline pointer to Section 2/6. No remaining internal contradiction. |
| 2 | Section 3 rule 3's CEO-escalation list silently dropped "RBAC role or permission additions," while Section 6 claimed nothing was weakened | RESOLVED | Rule 3 now lists 7 items: product invariant, agent-system change, data-dropping schema change, RBAC role/permission addition, pricing/subscription change, AI model/provider change, new CBSE subject. Diffed item-for-item against the live project-instructions file's "User Approval Required For" list (also 7 items). Exact match, no omissions either direction. |
| 3 | Direct cross-document contradiction: Engineering Constitution v2 gave Release Manager a personal release veto; Release Constitution assigned that decision to the Board only | RESOLVED | Engineering Constitution v2 Section 4's Release Manager row now reads "Can veto: Whether a Release Candidate has adequate evidence to be submitted to the Executive Release Board... Cannot veto: The release go/no-go decision itself, which belongs to the Executive Release Board as a body." Release Constitution Section 5 states the mirror image, and each cross-references the other by section number. This is the strongest fix of the nine -- it agrees close to word-for-word. |
| 4 | No stated precedence between rule 3 (product-invariant to CEO) and rule 4 (release-gate to Board) when a finding is both | RESOLVED | New Section 3 rule 5: where a disagreement is simultaneously a rule-3 category and a release-gate question, rule 3 wins -- direct CEO escalation, with the Board's analysis as input, not an independently binding path. Release Constitution Section 5 restates the identical precedence and cites "per its own rule 5." Checked for interaction with rules 1/2 (peer disagreement to orchestrator) -- no overlap; rule 5 only engages when a rule-3 category is also in play. |
| 5 | Rule 2's orchestrator-escalation was textually scoped to the Build-vs-Verify case, not stated as a general catch-all for Verify-vs-Verify disagreement | RESOLVED | Rule 1 reworded to explicitly cover both Build-vs-Verify disagreement and disagreement between two Verify roles reviewing the same change for different reasons, using the UX/UI-Director-vs-Curriculum-and-Learning-Expert example verbatim as illustration. Rule 2's escalation now sits under this broadened rule 1. |
| 6 | Section 5 claimed to "adopt" the permanent-SDLC proposal but never reproduced the phase-to-owner table or gate/exit criteria | RESOLVED | Section 5 now inlines a full 10-row table (phase, owner(s), exit criterion). Cross-checked every row against the source proposal's two tables ("mapped to owners" and "Gate criteria per phase"): owners match phase-for-phase; exit criteria are faithful condensed paraphrases (e.g. phase 8 preserves the "scaled to the size of the change, not always this exhaustive" qualifier). No phase, owner, or exit condition dropped or altered in meaning. |
| 7 | Section 1/2 dropped the Product Organization proposal's tool-access boundary and review-chain-matrix implications entirely | RESOLVED | New Section 1a reproduces the tool-access recommendation faithfully and expands it -- names the specific doc tree for all 7 roles individually (proposal only gave 2 worked examples). New Section 2a reproduces the review-chain-matrix implication as a concrete 5-row table, a superset of the proposal's 3 worked examples plus its "Where each role sits in the pipeline" content. Section 7 still correctly defers the actual matrix-file edit to a Wave 2 task requiring file-write tooling not available this session. No content loss remains. |
| 8 | Section 3's confidence rubric conflated finding-level confidence with stage-level confidence, so the literal HIGH definition contradicted findings actually tagged HIGH this session | RESOLVED, with one residual gap noted below (not blocking) | Section 3 now explicitly splits "Finding-level confidence" from "Stage-level confidence ceiling," stating plainly these "are two different claims and must not be conflated." Finding-level HIGH changed to "has or gets a regression-catalog pin" -- the "or gets" loosening specifically fixes the disqualification problem the original finding cited. Stage-level ceiling explicitly caps Stage-1-only packages at MEDIUM "regardless of how many individual findings within it are HIGH." Residual gap: the stage-level paragraph never states what ceiling Stage 2 alone (without Stage 3) yields -- it only says "toward HIGH," leaving the Stage-2-only case undefined. Not a self-contradiction and has no live effect (this program never left Stage 1), so it does not block ratification, but should be clarified before a future program reaches Stage 2. Flagged MINOR. |
| 9 | "Forward-only" overstated the precision of the actual migration-rollback convention | RESOLVED | Section 7 now reads "no automatic down-migration tooling; a migration-related production problem escalates to architect for a manually-authored, reviewed compensating migration applied deliberately by an operator, not an automatic schema revert." Matches the runbook's actual convention precisely; the imprecise "forward-only" framing is dropped entirely. |

## New-contradiction check (fixes interacting with fixes)

Specifically re-examined whether the nine fixes, applied together, created any contradiction that
did not exist in revision 1:

- Rule 5's precedence (finding #4) and the reworded rule 1 (finding #5): different escalation
  tiers (peer-resolution vs. CEO-bypass); rule 5 only engages when a rule-3 category is also in
  play on top of a release decision. No overlap that could produce two valid but different
  outcomes for the same dispute.
- The Release Manager fix (finding #3) and the new precedence rule (finding #4) both touch "who
  decides a release": rule 5 decides whether the CEO or the Board's process governs; the Release
  Manager row then correctly describes Release Manager's authority within the Board's process
  only, never claiming authority over the CEO-escalation path rule 5 created. No overlap.
- Section 6's rewritten "what does not change" (finding #1) depends on rule 3's list actually
  being correct (finding #2) -- verified this is not a residual false claim now that the
  underlying list is fixed.
- Section 7's ratification-status recap under-recaps its own rejection reasons (mentions only the
  two self-contradictions and the cross-document contradiction, not findings #4-#7). This is a
  self-description imprecision, not a live contradiction in the document's operative rules, since
  #4-#7 are each fixed elsewhere in the same revision. Noted as MINOR/cosmetic; does not affect
  ratification readiness.
- No other new cross-document disagreement found. The two documents' shared claims (Release
  Manager authority, the rule-3/rule-4 precedence, the two-track SDLC classification) now state
  the same rule in both places, each with a correct cross-reference to the other.

## Verdict

- Engineering Constitution v2 (engineering-constitution-v2-draft.md): APPROVE.
  All seven findings assigned to this document (#1, #2, #3, #4, #5, #6, #7) are genuinely
  resolved, not reworded around. The two self-contradictions (#1, #2) are gone. The
  cross-document authority question (#3) is resolved on both sides with matching language. The
  precedence gap (#4) has an explicit, single-directional rule that composes cleanly with the
  rest of Section 3. Rule 1's scope (#5) is explicit. Both absorption claims (#6, #7) are backed
  by real inlined content, verified line-for-line against their source proposals.

- Release Constitution (release-constitution-v2-draft.md): APPROVE WITH CONDITIONS.
  Findings #3 (shared) and #9 are fully resolved. Finding #8 is resolved for the specific
  conflation it identified, but the fix surfaces one adjacent, previously-invisible gap: the
  stage-level ceiling for Stage 2 (partial live evidence, no Stage 3) is undefined. Condition:
  add one clarifying sentence to Section 3 stating what ceiling Stage-2-only completion yields,
  before this rubric is exercised on a change that actually reaches Stage 2 without Stage 3 (not
  before ratification -- the current certification program is Stage-1-only throughout, so this
  gap has no live effect today). MINOR condition, addressable in a follow-up sentence, not a
  reason to hold ratification.

## Overall verdict

Ready for ratification, together, as revision 2. All nine findings from the first review are
resolved in substance, not merely reworded. The one condition remaining (Stage-2-only confidence
ceiling, under finding #8) is minor, has no effect on the certification program actually run this
session (which never left Stage 1), and does not warrant blocking ratification -- it should be
picked up as a fast-follow documentation edit the first time a change is scheduled for Stage 2.
No new cross-document contradiction was introduced by the fixes themselves; the shared claims
(Release Manager authority, rule-3/rule-4 precedence) now agree word-for-word in intent across
both documents, each correctly cross-referencing the other by section number.

Recommended next step: proceed to CEO ratification of both documents together, as revision 2
recommends. Track the Stage-2-ceiling clarification (finding #8's residual gap) as a lightweight
follow-up, not a ratification blocker.
