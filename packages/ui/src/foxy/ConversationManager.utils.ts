export interface ConversationSummary {
  id: string;
  title: string;
  subject: string;
  chapter?: string;
  chapterNumber?: number;
  /**
   * OPTIONAL since 2026-08-24. `GET /api/foxy/sessions` deliberately does not
   * return a message preview: the list endpoint carries titles + subjects +
   * counts only, never message bodies (P13 — the same reason the single-session
   * GET excludes `sources`). The row renders without a preview line when this
   * is absent; it is NOT replaced with filler copy.
   */
  lastMessage?: string;
  messageCount: number;
  updatedAt: string;
  isActive: boolean;
}

export const FALLBACK_SUBJECT_NAMES: Record<string, string> = {
  math: 'Mathematics',
  science: 'Science',
  english: 'English',
  hindi: 'Hindi',
  physics: 'Physics',
  chemistry: 'Chemistry',
  biology: 'Biology',
  social_studies: 'Social Studies',
  coding: 'Coding',
};

export const FALLBACK_SUBJECT_NAMES_HI: Record<string, string> = {
  math: 'गणित',
  science: 'विज्ञान',
  english: 'अंग्रेज़ी',
  hindi: 'हिंदी',
  physics: 'भौतिकी',
  chemistry: 'रसायन विज्ञान',
  biology: 'जीव विज्ञान',
  social_studies: 'सामाजिक विज्ञान',
  coding: 'कोडिंग',
};

/**
 * The language-free half of `generateTitle`: the student's OWN first prompt,
 * normalized and truncated to a 50-char thread title. Returns `null` when the
 * thread has no usable user turn — the CALLER supplies the bilingual
 * subject-name fallback via `subjectTitleFallback()`.
 *
 * Split out on 2026-08-24 so `GET /api/foxy/sessions` can derive the SAME
 * title server-side without duplicating this logic and without the server
 * having to know the student's language (P7: language is a client decision).
 * P13: the input is the student's own message and the output is returned only
 * to that same authenticated student. It is never logged.
 */
export function deriveConversationTitle(
  firstUserContent: string | null | undefined,
): string | null {
  if (!firstUserContent) return null;
  let title = firstUserContent
    .replace(/^(teach me about|explain|help me with|mujhe sikhao|samjhao):\s*/i, '')
    .replace(/\(Chapter \d+\)/i, '')
    .trim();
  if (title.length > 50) title = title.substring(0, 47) + '...';
  return title || null;
}

/** The bilingual "this thread has no prompt yet" title (P7). */
export function subjectTitleFallback(subject: string, isHi = false): string {
  return (
    (isHi ? FALLBACK_SUBJECT_NAMES_HI : FALLBACK_SUBJECT_NAMES)[subject] ||
    subject ||
    (isHi ? 'नई चैट' : 'New Chat')
  );
}

export function generateTitle(messages: Array<{ role: string; content: string }>, subject: string, isHi = false): string {
  const firstUserMsg = messages.find(m => m.role === 'student' || m.role === 'user');
  return (
    deriveConversationTitle(firstUserMsg?.content) ?? subjectTitleFallback(subject, isHi)
  );
}

export interface SimplifiedMode {
  id: string;
  label: string;
  labelHi: string;
  icon: string;
  description: string;
  descriptionHi: string;
}

export const SIMPLIFIED_MODES: SimplifiedMode[] = [
  {
    id: 'ask',
    label: 'Ask Foxy',
    labelHi: 'Foxy \u0938\u0947 \u092A\u0942\u091B\u094B',
    icon: '\uD83D\uDCA1',
    description: 'Learn concepts, clear doubts',
    descriptionHi: '\u0915\u0949\u0928\u094D\u0938\u0947\u092A\u094D\u091F \u0938\u0940\u0916\u094B, \u0921\u093E\u0909\u091F \u0915\u094D\u0932\u093F\u092F\u0930 \u0915\u0930\u094B',
  },
  {
    id: 'practice',
    label: 'Practice',
    labelHi: '\u0905\u092D\u094D\u092F\u093E\u0938',
    icon: '\u270F\uFE0F',
    description: 'Problems & quizzes',
    descriptionHi: '\u092A\u094D\u0930\u0936\u094D\u0928 \u0914\u0930 \u0915\u094D\u0935\u093F\u091C\u093C',
  },
  {
    id: 'revise',
    label: 'Revise',
    labelHi: '\u0930\u093F\u0935\u0940\u091C\u093C',
    icon: '\uD83D\uDD04',
    description: 'Summaries & notes',
    descriptionHi: '\u0938\u093E\u0930\u093E\u0902\u0936 \u0914\u0930 \u0928\u094B\u091F\u094D\u0938',
  },
];

export const MODE_MAP: Record<string, string> = {
  ask: 'learn',
  practice: 'practice',
  revise: 'revision',
  lesson: 'lesson',
};
