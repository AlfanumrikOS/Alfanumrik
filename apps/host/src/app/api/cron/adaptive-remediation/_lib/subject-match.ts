/**
 * Phase A Loop A — tiered subject matching for B2B escalation class selection.
 *
 * Round 2 condition fix (assessment cond 2, BLOCKING-B2B): the original
 * matcher was a bare bidirectional substring test, which produced
 *   (a) FALSE POSITIVES — class "Social Science" matched code 'science'
 *       (substring), so a wrong-subject teacher could be prioritised; and
 *   (b) FALSE NEGATIVES — code 'social_studies' did NOT match class
 *       "Social Studies" (the underscore broke the comparison).
 *
 * Ratified replacement — a three-tier matcher:
 *
 *   Tier 2 (exact)   — normalized equality. Separator runs ([_\s]+) collapse
 *                      to a single space, lowercased, trimmed:
 *                      'social_studies' ≡ 'Social Studies'.
 *   Tier 1 (partial) — token-boundary alignment, NOT bare substring. The
 *                      shorter side's tokens must align 1:1 with the LEADING
 *                      tokens of the longer side, each pair related by a
 *                      token-start prefix ('math' ~ 'Mathematics Standard',
 *                      'social studies' ~ 'Social Studies & Civics',
 *                      'hindi' ~ 'Hindi B'). Because alignment is anchored at
 *                      token 0, 'science' can NEVER match inside
 *                      'Social Science' / 'Political Science' /
 *                      'Computer Science' — containment is not alignment.
 *   Tier 0 (none)    — everything else.
 *
 * Class selection ranks tier 2 ABOVE tier 1 ABOVE tier 0 (exact-equality
 * beats partial token match), then falls back to the existing
 * newest-created-first tie-break.
 *
 * Known, documented limitation: 'Social Science' (a common CBSE display name
 * for SST) does NOT match code 'social_studies' under these rules — alias
 * mapping is an assessment-owned vocabulary decision and is deliberately out
 * of scope here (a non-matching class only loses the subject-priority boost;
 * escalation still proceeds via the newest-created class with a teacher).
 *
 * Pure module: no I/O, no clock, deterministic. P13: subject labels/codes
 * only — never PII.
 */

/**
 * Normalize a subject label or code for comparison: lowercase, collapse
 * underscore/whitespace runs to a single space, trim.
 * 'Social_Studies ' → 'social studies'.
 */
export function normalizeSubjectLabel(raw: string): string {
  return raw.toLowerCase().replace(/[_\s]+/g, ' ').trim();
}

/** 2 = exact normalized equality; 1 = token-boundary partial; 0 = no match. */
export type SubjectMatchTier = 0 | 1 | 2;

/**
 * Match tier between a class's display subject and an intervention's subject
 * code. Covers the CBSE code set (math, science, english, hindi,
 * social_studies, physics, chemistry, biology, business_studies,
 * political_science, computer_science, economics, accountancy, geography,
 * history) — see the tier matrix test for the pinned behavior.
 */
export function subjectMatchTier(
  classSubject: string | null,
  subjectCode: string,
): SubjectMatchTier {
  if (!classSubject) return 0;
  const a = normalizeSubjectLabel(classSubject);
  const b = normalizeSubjectLabel(subjectCode);
  if (!a || !b) return 0;

  // Tier 2: exact normalized equality.
  if (a === b) return 2;

  // Tier 1: leading token alignment. The shorter token list must pair off
  // against the longer list's LEADING tokens, each pair related by a
  // token-start prefix in either direction ('math'→'mathematics',
  // 'computers'→'computer'). Anchoring at token 0 is what kills the
  // 'science' ⊂ 'social science' substring false positive.
  const aTokens = a.split(' ');
  const bTokens = b.split(' ');
  const [shorter, longer] =
    aTokens.length <= bTokens.length ? [aTokens, bTokens] : [bTokens, aTokens];
  for (let i = 0; i < shorter.length; i++) {
    const s = shorter[i];
    const l = longer[i];
    if (!l.startsWith(s) && !s.startsWith(l)) return 0;
  }
  return 1;
}
