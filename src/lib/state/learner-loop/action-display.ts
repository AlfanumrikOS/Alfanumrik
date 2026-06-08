/**
 * src/lib/state/learner-loop/action-display.ts — pure mapping from a
 * LearnerAction kind + payload to the bilingual UI props the dashboard
 * hero (and any other consumer) uses to render the action card.
 *
 * Pure function. No React, no SWR, no DOM — exported as a typed lookup
 * so tests can pin every kind ⇄ label pair without standing up the UI.
 *
 * Why a separate module:
 *   - The dashboard hero (Phase 3a) needs it.
 *   - The study-plan "Today" card (Phase 3b) will need it.
 *   - The /revise route (Phase 4) will need a subset (decayed topics).
 *   - Tests want to assert the mapping never leaks unmapped kinds.
 *
 * The icon is an emoji string so the dashboard's existing emoji-as-icon
 * design (see AboveFoldHero) renders without a sprite import.
 */

import type { LearnerAction } from './types';

export interface ActionDisplay {
  icon: string;
  /** Top-line label (uppercase eyebrow in the card design). */
  eyebrowEn: string;
  eyebrowHi: string;
  /** Main title — the action. */
  titleEn: string;
  titleHi: string;
  /** Sub-line — diagnostic / reason text. */
  subEn: string;
  subHi: string;
  /** Tint hint for the icon background (CSS color or var(--token)). */
  tint: string;
}

/**
 * Map a LearnerAction to its bilingual display props. Total over the
 * `LearnerAction` discriminated union — the compiler errors if a new
 * action kind is added without a case here.
 */
export function actionDisplay(action: LearnerAction): ActionDisplay {
  switch (action.kind) {
    case 'cold_start_diagnostic':
      return {
        icon: '🎯',
        eyebrowEn: 'Get started',
        eyebrowHi: 'शुरू करो',
        titleEn: 'Take the diagnostic quiz',
        titleHi: 'पहला डायग्नोस्टिक क्विज़',
        subEn: 'A short check-in so Foxy can pick the right lessons for you',
        subHi: 'एक छोटा क्विज़ जिससे Foxy तुम्हारे लिए सही पाठ चुने',
        tint: 'var(--purple, #7C3AED)',
      };

    case 'teacher_remediation': {
      // Phase 3A Wave A / A3 — the "from your teacher" card. Chapter-anchored
      // when the assignment resolved a (subject, chapter); else a general
      // teacher-assigned practice. Bilingual (P7).
      const hasAnchor =
        action.subjectCode !== undefined && action.chapterNumber !== undefined;
      return {
        icon: '👩‍🏫',
        eyebrowEn: 'From your teacher',
        eyebrowHi: 'तुम्हारे शिक्षक से',
        titleEn: hasAnchor
          ? `${capitalize(action.subjectCode!)} · Chapter ${action.chapterNumber}`
          : 'Practice your teacher assigned',
        titleHi: hasAnchor
          ? `${subjectHi(action.subjectCode!)} · अध्याय ${action.chapterNumber}`
          : 'शिक्षक का दिया अभ्यास',
        subEn: 'Your teacher picked this for you — let’s clear it up',
        subHi: 'तुम्हारे शिक्षक ने यह चुना है — इसे पक्का करते हैं',
        tint: 'var(--purple, #7C3AED)',
      };
    }

    case 'review_due_cards': {
      const n = action.dueCount;
      return {
        icon: '🔁',
        eyebrowEn: 'Today',
        eyebrowHi: 'आज',
        titleEn: `Review ${n} flashcard${n === 1 ? '' : 's'}`,
        titleHi: `${n} फ्लैशकार्ड दोहराओ`,
        subEn: "Strengthen what you've already learned",
        subHi: 'जो सीखा है उसे और मज़बूत करो',
        tint: '#0891B2', // matches /review accent
      };
    }

    case 'revise_decayed_topic':
      return {
        icon: modalityIcon(action.recommendedModality),
        eyebrowEn: 'Revise',
        eyebrowHi: 'फिर से देखो',
        titleEn: `${capitalize(action.subjectCode)} · Chapter ${action.chapterNumber}`,
        titleHi: `${subjectHi(action.subjectCode)} · अध्याय ${action.chapterNumber}`,
        subEn: `${action.daysSinceLastTouch} days since you last looked at this`,
        subHi: `${action.daysSinceLastTouch} दिन हो गए इस पर ध्यान दिए हुए`,
        tint: '#6366F1',
      };

    case 'start_quiz':
      return {
        icon: '⚡',
        eyebrowEn: action.reason === 'todays_zpd' ? "Today's practice" : 'Practice',
        eyebrowHi: action.reason === 'todays_zpd' ? 'आज का अभ्यास' : 'अभ्यास',
        titleEn: `${capitalize(action.subjectCode)} · Chapter ${action.chapterNumber}`,
        titleHi: `${subjectHi(action.subjectCode)} · अध्याय ${action.chapterNumber}`,
        subEn: `${zpdLabelEn(action.zpdBin)} questions tuned to where you are`,
        subHi: `${zpdLabelHi(action.zpdBin)} सवाल — तुम्हारे स्तर पर`,
        tint: 'var(--orange, #E8581C)',
      };

    case 'continue_lesson':
      return {
        icon: '📚',
        eyebrowEn: 'Continue',
        eyebrowHi: 'जारी रखो',
        titleEn: `${capitalize(action.subjectCode)} · Chapter ${action.chapterNumber}`,
        titleHi: `${subjectHi(action.subjectCode)} · अध्याय ${action.chapterNumber}`,
        subEn: `${Math.round(action.progressPct * 100)}% complete — pick up where you left off`,
        subHi: `${Math.round(action.progressPct * 100)}% पूरा — जहाँ छोड़ा था वहाँ से शुरू`,
        tint: '#16A34A',
      };

    case 'weekly_dive':
      return {
        icon: '🌊',
        eyebrowEn: 'This Sunday',
        eyebrowHi: 'इस रविवार',
        titleEn: 'Take a deep dive',
        titleHi: 'गहरी डाइव लो',
        subEn: action.suggestedPrompt,
        subHi: action.suggestedPrompt, // suggestedPrompt is server-built; keep as-is
        tint: '#2563EB',
      };

    case 'monthly_synthesis':
      return {
        icon: '🎓',
        eyebrowEn: 'Month-end',
        eyebrowHi: 'महीने का अंत',
        titleEn: 'Your monthly synthesis',
        titleHi: 'महीने का सारांश',
        subEn: 'See how far you came this month',
        subHi: 'देखो इस महीने कितना सीखा',
        tint: '#D97706',
      };

    case 'resume_in_progress':
      return {
        icon: '▶️',
        eyebrowEn: 'Right now',
        eyebrowHi: 'अभी',
        titleEn: 'Resume where you left off',
        titleHi: 'जहाँ छोड़ा था वहाँ से जारी रखो',
        subEn: 'You have an activity in progress',
        subHi: 'तुम्हारी एक गतिविधि चल रही है',
        tint: 'var(--orange, #E8581C)',
      };
  }
}

/**
 * Short button-fit label for a primary CTA. Constraints:
 *   - Verb-led ("Take", "Review", "Continue", …).
 *   - Fits on one line in a 56px mobile button — keep under ~24 chars.
 *   - Bilingual; the route uses `isHi` to pick.
 *
 * Returned as { en, hi } so callers can pick at render time without
 * threading `isHi` through this module. Tests pin every action kind.
 */
export interface ActionPrimaryCta {
  en: string;
  hi: string;
}

export function actionPrimaryCta(action: LearnerAction): ActionPrimaryCta {
  switch (action.kind) {
    case 'cold_start_diagnostic':
      return { en: 'Take the diagnostic', hi: 'डायग्नोस्टिक लो' };

    case 'teacher_remediation':
      // Phase 3A Wave A / A3 — verb-led, button-fit, bilingual (P7).
      return { en: 'Start teacher task', hi: 'शिक्षक का काम शुरू करो' };

    case 'review_due_cards': {
      const n = action.dueCount;
      return {
        en: `Review ${n} card${n === 1 ? '' : 's'}`,
        hi: `${n} कार्ड दोहराओ`,
      };
    }

    case 'revise_decayed_topic':
      return {
        en: `Revise Chapter ${action.chapterNumber}`,
        hi: `अध्याय ${action.chapterNumber} दोहराओ`,
      };

    case 'start_quiz':
      // Same string the legacy hardcoded button used — the Loop just picks
      // a smarter chapter underneath.
      return { en: "Start today's quiz", hi: 'आज का क्विज़ शुरू करो' };

    case 'continue_lesson':
      return {
        en: `Continue Chapter ${action.chapterNumber}`,
        hi: `अध्याय ${action.chapterNumber} जारी रखो`,
      };

    case 'weekly_dive':
      return { en: 'Take a deep dive', hi: 'गहरी डाइव लो' };

    case 'monthly_synthesis':
      return { en: 'See monthly synthesis', hi: 'महीने का सारांश देखो' };

    case 'resume_in_progress':
      return { en: 'Resume', hi: 'जारी रखो' };
  }
}

// ─── Internal helpers (pure) ─────────────────────────────────────────

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const SUBJECT_HI: Record<string, string> = {
  math: 'गणित',
  mathematics: 'गणित',
  science: 'विज्ञान',
  physics: 'भौतिकी',
  chemistry: 'रसायन',
  biology: 'जीव विज्ञान',
  english: 'अंग्रेज़ी',
  hindi: 'हिंदी',
  history: 'इतिहास',
  geography: 'भूगोल',
  civics: 'नागरिक शास्त्र',
};

function subjectHi(subjectCode: string): string {
  return SUBJECT_HI[subjectCode.toLowerCase()] ?? capitalize(subjectCode);
}

function modalityIcon(modality: 'read' | 'explainer' | 'worked-example'): string {
  switch (modality) {
    case 'read': return '📖';
    case 'explainer': return '💡';
    case 'worked-example': return '✏️';
  }
}

function zpdLabelEn(bin: 1 | 2 | 3): string {
  switch (bin) {
    case 1: return 'Foundation';
    case 2: return 'Build';
    case 3: return 'Stretch';
  }
}

function zpdLabelHi(bin: 1 | 2 | 3): string {
  switch (bin) {
    case 1: return 'बुनियाद';
    case 2: return 'मज़बूती';
    case 3: return 'चुनौती';
  }
}
