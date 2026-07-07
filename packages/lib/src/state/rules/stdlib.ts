/**
 * src/lib/state/rules/stdlib.ts — the initial rule library.
 *
 * Starter rules that demonstrate the pattern. As features migrate to
 * the unified-state architecture, the if-blocks they currently carry
 * become rules in this file. Adding a rule is the diff that ships a
 * policy change; the surfaces stay untouched.
 *
 * Convention: one exported `Rule` const per file-level declaration,
 * with a stable `id` namespaced by feature. Rule ids never change once
 * shipped — they're keys in the audit log.
 *
 * The full set is exported as `STANDARD_RULES` at the bottom so
 * callers don't pick up rules ad hoc.
 */

import { weakestChapter } from '../student-state';
import type { Rule } from './engine';

// ── 1. Foxy gate for unverified minors ───────────────────────────────
//
// DPDP Act: minors need a verified parent link before they can use AI
// features unsupervised. The Foxy edge function and the AI Solve API
// both need to honour this. Today this check is duplicated in three
// places; this rule consolidates it.

export const foxyGateMinorWithoutParentRule: Rule<{
  reason: 'minor_without_verified_parent';
  ctaLabelEn: string;
  ctaLabelHi: string;
}> = {
  id: 'foxy.gate.minor_without_parent',
  description: 'Block Foxy access for minors whose parent link is unverified (DPDP compliance).',
  evaluate({ state }) {
    if (!state.consent.isMinor) return null;
    if (state.consent.parentLinkVerified) return null;
    return {
      ruleId: 'foxy.gate.minor_without_parent',
      decision: 'foxy.gate',
      priority: 100,
      reason: {
        reason: 'minor_without_verified_parent',
        ctaLabelEn: 'Ask a parent to verify your account to use Foxy',
        ctaLabelHi: 'Foxy का उपयोग करने के लिए माता-पिता से सत्यापन कराएँ',
      },
    };
  },
};

// ── 2. Module-disabled hide rules ────────────────────────────────────
//
// When a school admin disables a module (white-label tenant_modules),
// the affected nav links disappear for students in that tenant. One
// rule per high-traffic module; the sidebar checks the rule output
// instead of re-reading tenant_modules.

function makeModuleHideRule(moduleKey: string, priority = 90): Rule<{ moduleKey: string }> {
  return {
    id: `nav.module.hide.${moduleKey}`,
    description: `Hide the ${moduleKey} nav entry when the tenant has disabled the module.`,
    evaluate({ state }) {
      if (state.tenant.enabledModules.includes(moduleKey)) return null;
      return {
        ruleId: `nav.module.hide.${moduleKey}`,
        decision: 'nav.module.hide',
        priority,
        reason: { moduleKey },
      };
    },
  };
}

export const navModuleHideRules: Rule[] = [
  makeModuleHideRule('foxy_tutor'),
  makeModuleHideRule('quiz_engine'),
  makeModuleHideRule('live_classes'),
  makeModuleHideRule('analytics'),
  makeModuleHideRule('assignments'),
  makeModuleHideRule('communication'),
];

// ── 3. Next-quiz suggestion ──────────────────────────────────────────
//
// The student dashboard's "what should I do next" card. Picks the
// learner's weakest chapter with a recent attempt. Surfaces it as a
// quiz nudge unless they're mid-quiz (don't interrupt themselves).

export const dashboardSuggestNextQuizRule: Rule<{
  subjectCode: string;
  chapterNumber: number;
  currentMastery: number;
  language: 'en' | 'hi';
}> = {
  id: 'dashboard.suggest.next_quiz',
  description: 'Suggest a practice quiz on the learner\'s weakest chapter with signal.',
  evaluate({ state }) {
    if (state.live.kind === 'in_quiz') return null; // already practising
    if (!state.tenant.enabledModules.includes('quiz_engine')) return null;
    const w = weakestChapter(state);
    if (!w) return null;
    // Don't pester a strong learner. Only nudge below 0.7.
    if (w.mastery >= 0.7) return null;
    return {
      ruleId: 'dashboard.suggest.next_quiz',
      decision: 'dashboard.suggest.next_quiz',
      priority: 60,
      reason: {
        subjectCode: w.subjectCode,
        chapterNumber: w.chapterNumber,
        currentMastery: w.mastery,
        language: state.language,
      },
    };
  },
};

// ── 4. Family-plan upsell ────────────────────────────────────────────
//
// Show the family-plan upsell to engaged free-tier users in grades
// 6–10. We don't want to upsell already-paying users, and we don't
// want to upsell minors who can't pay. Engagement floor: 7-day streak.

export const upsellFamilyPlanRule: Rule<{
  reason: 'free_tier_engaged_student';
  copy: 'streak_milestone';
}> = {
  id: 'upsell.family_plan',
  description: 'Surface the family-plan upsell after 7-day streak on free tier.',
  evaluate({ state }) {
    if (state.access.planSlug !== 'free') return null;
    if (state.engagement.currentStreakDays < 7) return null;
    if (state.consent.isMinor && !state.consent.parentLinkVerified) {
      // Without a verified parent, the conversion can't complete anyway.
      return null;
    }
    return {
      ruleId: 'upsell.family_plan',
      decision: 'upsell.show',
      priority: 40,
      reason: { reason: 'free_tier_engaged_student', copy: 'streak_milestone' },
    };
  },
};

// ── 5. Parent weekly digest scheduling ───────────────────────────────
//
// A subscriber to learner.quiz_completed / learner.lesson_completed
// could just queue a digest every time; this rule centralises the
// "is it time to send a digest" policy so the schedule is queryable.

export const parentWeeklyDigestRule: Rule<{
  learnerAuthUserId: string;
  hasParent: boolean;
}> = {
  id: 'notification.parent.weekly',
  description: 'Queue a weekly digest to verified parents if there is meaningful new activity.',
  evaluate({ state, now }) {
    if (state.parentIds.length === 0) return null;
    // Engagement-bound: don't digest if the learner hasn't been active
    // in the last 7 days — there's nothing to report.
    if (!state.engagement.lastActiveAt) return null;
    const daysSince = (now.getTime() - Date.parse(state.engagement.lastActiveAt)) / 86_400_000;
    if (daysSince > 7) return null;
    return {
      ruleId: 'notification.parent.weekly',
      decision: 'notification.parent.weekly',
      priority: 30,
      reason: {
        learnerAuthUserId: state.authUserId,
        hasParent: true,
      },
    };
  },
};

// ── Export the full registry ─────────────────────────────────────────

export const STANDARD_RULES: ReadonlyArray<Rule> = [
  foxyGateMinorWithoutParentRule,
  ...navModuleHideRules,
  dashboardSuggestNextQuizRule,
  upsellFamilyPlanRule,
  parentWeeklyDigestRule,
];
