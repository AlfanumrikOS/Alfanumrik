/**
 * src/lib/state/context/builder.ts — Step 6: context-rich AI calls.
 *
 * Today: Foxy (and the doubt-solver, ncert-solver, cme-engine) get
 * called with a thin "current question + history of last 3 turns"
 * payload. The result is the AI guessing at the learner's level,
 * subjects, recent struggles, and tenant personality.
 *
 * After this: every AI call gets a `LearnerAiContext` block in the
 * system prompt that carries the learner's actual state — current
 * mastery on the topic, weakest chapter, recent milestones, what they
 * did in the last hour, tenant's AI personality override. The Edge
 * Functions just paste this block into their existing prompt scaffold;
 * no AI-side rewrites required.
 *
 * Two design rules:
 *
 *   1. **Compact, not exhaustive.** The block is bounded ~1500 tokens
 *      regardless of how rich the learner's history is. We aggressively
 *      pick the most relevant signals and drop the rest. AI calls are
 *      hot path — bloated context is real money.
 *
 *   2. **Markdown, not JSON.** The Anthropic + Claude Edge Functions
 *      consume prompts as text. We render the context as a tight
 *      markdown block the model parses naturally. JSON-stringified
 *      objects get worse comprehension and waste tokens on punctuation.
 *
 * Privacy: this builder runs server-side only (admin client). The
 * resulting context never leaks to the client; it's spliced into the
 * AI prompt inside the Edge Function call.
 */

import type { JourneyEvent } from '../journey/journey';
import {
  pickSubjectMastery,
  weakestChapter,
  type StudentState,
} from '../student-state';

export interface BuildAiContextArgs {
  state: StudentState;
  /** Recent journey events for this learner — last 24h is typical. The
   *  builder takes up to ~12 entries; pre-filter if you have many. */
  recentJourney: JourneyEvent[];
  /** What the AI is currently helping with. Drives "focus subject"
   *  ranking — the builder leads with this subject's mastery first. */
  currentFocus?: {
    subjectCode?: string;
    chapterNumber?: number;
    mode?: 'tutor' | 'doubt_solve' | 'revision';
  };
}

export interface AiContextBlock {
  /** The text to splice into the AI system prompt. */
  markdown: string;
  /** Rough token estimate — useful for budget-aware fallbacks. */
  approxTokens: number;
}

const MAX_JOURNEY_ENTRIES = 12;
const MAX_OTHER_SUBJECTS = 3;

/**
 * Build the context block. Pure function — no I/O. Caller has already
 * built the state and journey snapshot.
 */
export function buildAiContext(args: BuildAiContextArgs): AiContextBlock {
  const lines: string[] = [];

  // 1. Identity. The AI reads grade/board to calibrate vocabulary.
  lines.push('## About this learner');
  lines.push(`- Grade ${args.state.grade}, ${args.state.board} board, preferred language: ${args.state.language === 'hi' ? 'Hindi' : 'English'}`);
  if (args.state.consent.isMinor) {
    lines.push('- Minor — keep tone supportive, avoid mature examples.');
  }
  if (args.state.tenant.aiPersonality) {
    lines.push(`- This learner's school has set the AI personality to: "${args.state.tenant.aiPersonality.slice(0, 240)}"`);
  }
  lines.push('');

  // 2. Focus subject mastery, if a focus is set.
  if (args.currentFocus?.subjectCode) {
    const focus = pickSubjectMastery(args.state, args.currentFocus.subjectCode);
    if (focus) {
      const mean = focus.meanMastery !== null
        ? Math.round(focus.meanMastery * 100) + '%'
        : 'no signal yet';
      lines.push(`## Their current standing in ${focus.subjectCode}`);
      lines.push(`- Overall mastery: **${mean}**`);
      if (args.currentFocus.chapterNumber != null) {
        const chapter = focus.chapters.find(c => c.chapterNumber === args.currentFocus!.chapterNumber);
        if (chapter && chapter.mastery !== null) {
          lines.push(
            `- Chapter ${chapter.chapterNumber}: ${Math.round(chapter.mastery * 100)}% (${chapter.attempts} attempts)`,
          );
        } else if (chapter) {
          lines.push(`- Chapter ${chapter.chapterNumber}: no signal yet`);
        }
      }
      // Top 3 strongest + 3 weakest chapters in the focus subject.
      const ranked = focus.chapters
        .filter(c => c.mastery !== null)
        .sort((a, b) => (b.mastery ?? 0) - (a.mastery ?? 0));
      if (ranked.length > 0) {
        const strongest = ranked.slice(0, 3);
        const weakest = ranked.slice(-3).reverse();
        if (strongest.length > 0) {
          lines.push(`- Strongest chapters: ${strongest.map(c => `ch.${c.chapterNumber} (${Math.round((c.mastery ?? 0) * 100)}%)`).join(', ')}`);
        }
        if (weakest.length > 0 && weakest[0].chapterNumber !== strongest[strongest.length - 1].chapterNumber) {
          lines.push(`- Weakest chapters: ${weakest.map(c => `ch.${c.chapterNumber} (${Math.round((c.mastery ?? 0) * 100)}%)`).join(', ')}`);
        }
      }
      lines.push('');
    }
  }

  // 3. Other subjects — just headline mastery. Keep terse.
  const otherSubjects = args.state.mastery
    .filter(m => m.subjectCode !== args.currentFocus?.subjectCode && m.meanMastery !== null)
    .sort((a, b) => (b.meanMastery ?? 0) - (a.meanMastery ?? 0))
    .slice(0, MAX_OTHER_SUBJECTS);
  if (otherSubjects.length > 0) {
    lines.push('## Their other subjects (overall)');
    for (const s of otherSubjects) {
      lines.push(`- ${s.subjectCode}: ${Math.round((s.meanMastery ?? 0) * 100)}%`);
    }
    lines.push('');
  }

  // 4. Engagement context.
  lines.push('## Engagement right now');
  lines.push(`- Current streak: ${args.state.engagement.currentStreakDays} day${args.state.engagement.currentStreakDays === 1 ? '' : 's'} (longest: ${args.state.engagement.longestStreakDays})`);
  if (args.state.engagement.lastActiveAt) {
    const hoursAgo = Math.round((Date.now() - Date.parse(args.state.engagement.lastActiveAt)) / 3_600_000);
    if (hoursAgo < 48) {
      lines.push(`- Last active ${hoursAgo === 0 ? 'within the last hour' : `${hoursAgo}h ago`}`);
    }
  }
  if (args.state.live.kind !== 'idle') {
    lines.push(`- Currently: ${describeLive(args.state.live)}`);
  }
  lines.push('');

  // 5. Recent journey — what just happened.
  if (args.recentJourney.length > 0) {
    lines.push('## Recent activity (most recent first)');
    for (const j of args.recentJourney.slice(0, MAX_JOURNEY_ENTRIES)) {
      const minsAgo = Math.round((Date.now() - Date.parse(j.occurredAt)) / 60_000);
      const ago = minsAgo < 60 ? `${minsAgo}m ago` : `${Math.round(minsAgo / 60)}h ago`;
      const detail = j.detail ? ` — ${j.detail}` : '';
      lines.push(`- ${ago}: ${j.title}${detail}`);
    }
    lines.push('');
  }

  // 6. One actionable suggestion the AI can lean on.
  const w = weakestChapter(args.state);
  if (w) {
    lines.push('## Suggested teaching opportunity');
    lines.push(
      `- ${w.subjectCode} ch.${w.chapterNumber} is their weakest spot (${Math.round(w.mastery * 100)}%). ` +
        'If the conversation drifts toward "what should I work on", point here.',
    );
    lines.push('');
  }

  const markdown = lines.join('\n').trim() + '\n';
  const approxTokens = Math.ceil(markdown.length / 4);
  return { markdown, approxTokens };
}

function describeLive(live: StudentState['live']): string {
  switch (live.kind) {
    case 'idle':
      return 'idle';
    case 'in_quiz':
      return `taking a quiz on ${live.subjectCode} ch.${live.chapterNumber} (${live.questionsAnswered}/${live.questionCount})`;
    case 'in_foxy':
      return `mid-conversation with Foxy${live.subjectCode ? ` about ${live.subjectCode}` : ''} (turn ${live.turnCount})`;
    case 'in_lesson':
      return `watching a lesson on ${live.subjectCode} ch.${live.chapterNumber}`;
  }
}
