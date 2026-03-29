/**
 * ALFANUMRIK — Foxy Voice Orchestration Engine
 *
 * Controls WHAT Foxy says and HOW Foxy behaves during a voice session.
 * This is NOT a single prompt — it's a state machine that selects
 * the right behavior based on real-time student signals.
 *
 * Architecture:
 *   StudentContext + SessionState → ModeRouter → SystemPrompt + Behavior
 *
 * Foxy is a TEACHER, not an assistant. Foxy leads. Foxy asks questions.
 * Foxy decides when to explain, challenge, hint, or pause.
 */

// ─── Student Context (loaded from DB at session start) ────

export interface LearnerMemory {
  name: string;
  grade: string;
  board: string;
  preferredLanguage: 'en' | 'hi' | 'hinglish';
  explanationStyle: 'step_by_step' | 'visual' | 'analogy' | 'example_first';
  pacePreference: 'slow' | 'moderate' | 'fast';
  confidenceLevel: 'low' | 'developing' | 'moderate' | 'high';
  recentWeakConcepts: Array<{ conceptId: string; title: string; confidence: number }>;
  recentStrongConcepts: Array<{ conceptId: string; title: string; masteryPct: number }>;
  recentMistakes: Array<{ questionText: string; errorType: string }>;
  currentFocusTopic: string | null;
  lastSessionSummary: string | null;
  lastSessionMode: string | null;
  sessionStreak: number;
  totalVoiceSessions: number;
  parentGoals: string | null;
}

// ─── Session State (tracks real-time during conversation) ──

export type SessionMode = 'teach' | 'revise' | 'quiz' | 'motivate' | 'recap' | 'freeform';

export interface VoiceSessionState {
  mode: SessionMode;
  subject: string;
  topic: string;
  turnCount: number;
  studentTurns: number;
  foxyTurns: number;
  consecutiveCorrect: number;
  consecutiveWrong: number;
  questionsAsked: number;
  questionsCorrect: number;
  silenceCount: number; // times student was silent > 5 sec
  shortResponseCount: number; // times student gave < 3 word answer
  sessionDurationSec: number;
  lastStudentSentiment: 'engaged' | 'confused' | 'bored' | 'frustrated' | 'neutral';
  conceptsCovered: string[];
  transcript: Array<{ role: 'student' | 'foxy'; text: string; timestampMs: number }>;
}

export function createSessionState(mode: SessionMode, subject: string, topic: string): VoiceSessionState {
  return {
    mode, subject, topic,
    turnCount: 0, studentTurns: 0, foxyTurns: 0,
    consecutiveCorrect: 0, consecutiveWrong: 0,
    questionsAsked: 0, questionsCorrect: 0,
    silenceCount: 0, shortResponseCount: 0,
    sessionDurationSec: 0,
    lastStudentSentiment: 'neutral',
    conceptsCovered: [],
    transcript: [],
  };
}

// ─── Mode Router ─────────────────────────────────────────

/**
 * Determines what Foxy should do next based on real-time signals.
 * This runs after every student turn.
 */
export function routeNextAction(
  state: VoiceSessionState,
  memory: LearnerMemory,
): { nextMode: SessionMode; reason: string } {

  // Struggle detection: 3+ wrong in a row → switch to remedial
  if (state.consecutiveWrong >= (memory.confidenceLevel === 'low' ? 2 : 3)) {
    return { nextMode: 'motivate', reason: 'Student is struggling. Switch to encouragement + simpler examples.' };
  }

  // Boredom detection: short responses + silences
  if (state.shortResponseCount >= 3 && state.silenceCount >= 2) {
    return { nextMode: 'quiz', reason: 'Student seems disengaged. Switch to interactive quiz to re-engage.' };
  }

  // Mastery detection: 5+ correct in a row → advance difficulty or topic
  if (state.consecutiveCorrect >= 5 && state.mode === 'quiz') {
    return { nextMode: 'teach', reason: 'Student has mastered this level. Move to next concept.' };
  }

  // Time-based: after 10 minutes of teaching, switch to quiz
  if (state.mode === 'teach' && state.sessionDurationSec > 600 && state.questionsAsked === 0) {
    return { nextMode: 'quiz', reason: 'Time to check understanding after explanation.' };
  }

  // Time-based: after 15 minutes total, offer recap
  if (state.sessionDurationSec > 900 && state.mode !== 'recap') {
    return { nextMode: 'recap', reason: 'Session is long. Offer a recap and wrap-up.' };
  }

  // Stay in current mode
  return { nextMode: state.mode, reason: 'Continue current mode.' };
}

// ─── System Prompt Builder ───────────────────────────────

/**
 * Builds the system prompt for Foxy based on mode, context, and state.
 * This is injected into Claude/LLM at every turn.
 */
export function buildVoiceSystemPrompt(
  mode: SessionMode,
  memory: LearnerMemory,
  state: VoiceSessionState,
): string {
  const name = memory.name.split(' ')[0];
  const gradeLabel = `Grade ${memory.grade}`;
  const langNote = memory.preferredLanguage === 'hi'
    ? 'Respond in Hindi. Use Devanagari script.'
    : memory.preferredLanguage === 'hinglish'
    ? 'Respond in Hinglish (mix of Hindi and English, Roman script). Use Indian conversational style.'
    : 'Respond in clear Indian English. Use natural, warm tone.';

  const personality = `You are Foxy, a smart and warm teacher for Indian school students. You are teaching ${name}, a ${gradeLabel} CBSE student.

VOICE RULES (critical — you are speaking, not writing):
- Use SHORT sentences. Max 2-3 sentences per turn.
- Sound natural and conversational, like a real teacher talking.
- Never use markdown, bullet points, or formatting. This is spoken speech.
- Use simple words. Avoid jargon unless explaining it.
- ${langNote}
- Pause naturally. Use "..." for breath pauses.
- Be warm but not childish. Slightly energetic. Like a cool tutor, not a strict teacher.
- Use the student's name occasionally (not every turn).`;

  const contextBlock = buildContextBlock(memory, state);
  const modeInstructions = getModeInstructions(mode, memory, state);

  return `${personality}\n\n${contextBlock}\n\n${modeInstructions}`;
}

function buildContextBlock(memory: LearnerMemory, state: VoiceSessionState): string {
  const parts: string[] = [];

  if (memory.lastSessionSummary) {
    parts.push(`LAST SESSION: ${memory.lastSessionSummary}`);
  }

  if (memory.recentWeakConcepts.length > 0) {
    const weak = memory.recentWeakConcepts.slice(0, 3).map(c => c.title).join(', ');
    parts.push(`WEAK AREAS: ${weak} — gently revisit these.`);
  }

  if (memory.recentMistakes.length > 0) {
    const mistakes = memory.recentMistakes.slice(0, 2).map(m => m.questionText).join('; ');
    parts.push(`RECENT MISTAKES: ${mistakes}`);
  }

  if (memory.confidenceLevel === 'low') {
    parts.push('CONFIDENCE: Low. Be extra encouraging. Celebrate small wins.');
  }

  if (memory.parentGoals) {
    parts.push(`PARENT GOAL: ${memory.parentGoals}`);
  }

  if (state.consecutiveWrong >= 2) {
    parts.push(`ALERT: Student got ${state.consecutiveWrong} wrong in a row. Simplify and encourage.`);
  }

  if (state.consecutiveCorrect >= 3) {
    parts.push(`POSITIVE: Student got ${state.consecutiveCorrect} correct in a row! Acknowledge their streak.`);
  }

  return parts.length > 0 ? `STUDENT CONTEXT:\n${parts.join('\n')}` : '';
}

function getModeInstructions(mode: SessionMode, memory: LearnerMemory, state: VoiceSessionState): string {
  const name = memory.name.split(' ')[0];

  switch (mode) {
    case 'teach':
      return `MODE: TEACHING
You are explaining ${state.topic} in ${state.subject}.
- Lead the explanation. Don't wait for the student to ask.
- Break complex ideas into small, digestible pieces.
- After every 2-3 explanations, ASK a checking question: "Does that make sense?" or "Can you tell me what we just covered?"
- Use ${memory.explanationStyle === 'analogy' ? 'real-world analogies' : memory.explanationStyle === 'visual' ? 'visual descriptions (imagine...)' : memory.explanationStyle === 'example_first' ? 'examples before theory' : 'step-by-step breakdown'}.
- If student says "yes" or "hmm" without detail, probe deeper: "Great, so what would happen if..."`;

    case 'revise':
      return `MODE: REVISION
You are helping ${name} revise ${state.topic}.
- Start by asking what they remember: "Tell me what you remember about..."
- Fill in gaps they miss.
- Use spaced recall: ask them to explain back to you.
- If they struggle, give a hint, not the answer.
- End by asking them to summarize in their own words.`;

    case 'quiz':
      return `MODE: QUIZ
You are quizzing ${name} on ${state.topic}.
- Ask ONE question at a time. Wait for their answer.
- Questions should match ${gradeAppropriate(memory.grade)} difficulty.
- If correct: brief praise + move to next question (slightly harder).
- If wrong: say "Not quite" + give a hint + let them try again.
- After 2 wrong attempts on same question, explain the answer.
- Track their streak. If 3+ correct, say something like "You're on fire!"
- Mix recall, understanding, and application questions.`;

    case 'motivate':
      return `MODE: CONFIDENCE BOOST
${name} is struggling. Your job is to rebuild confidence.
- Acknowledge the difficulty: "This is a tricky topic, and it's okay to find it hard."
- Go back to a simpler version of the concept.
- Ask a very easy question they WILL get right. Then celebrate it.
- Gradually increase difficulty.
- Use phrases like: "See? You know more than you think."
- Do NOT skip this mode too quickly. Stay here for 2-3 turns minimum.`;

    case 'recap':
      return `MODE: SESSION RECAP
The session is wrapping up.
- Summarize what was covered in 2-3 sentences.
- Mention 1 thing they did well.
- Mention 1 thing to practice next time.
- End with an encouraging closing: "Great session, ${name}! See you next time."
- If they got a good score, celebrate it.
- Keep it brief — this is the goodbye.`;

    case 'freeform':
      return `MODE: OPEN CONVERSATION
${name} wants to talk or ask questions freely.
- Answer their questions directly.
- If they go off-topic, gently steer back: "That's interesting! But let's focus on..."
- If they ask something outside your subject, say: "I'm best at ${state.subject}, but let me try..."
- Stay helpful and warm.`;

    default:
      return '';
  }
}

function gradeAppropriate(grade: string): string {
  const g = parseInt(grade) || 9;
  if (g <= 7) return 'CBSE Grade 6-7 (foundational, concrete examples)';
  if (g <= 9) return 'CBSE Grade 8-9 (intermediate, some abstraction)';
  return 'CBSE Grade 10-12 (advanced, board-exam level)';
}

// ─── Session Opening Lines ───────────────────────────────

/**
 * What Foxy says in the first 10 seconds of a voice session.
 * Personalized based on learner memory.
 */
export function getSessionOpener(memory: LearnerMemory, mode: SessionMode, topic: string): string {
  const name = memory.name.split(' ')[0];
  const isHi = memory.preferredLanguage === 'hi';

  // Returning student with context
  if (memory.lastSessionSummary && memory.totalVoiceSessions > 0) {
    if (isHi) {
      return `नमस्ते ${name}! पिछली बार हमने ${memory.lastSessionMode === 'quiz' ? 'क्विज़ किया था' : 'पढ़ाई की थी'}। आज ${topic} पर काम करें?`;
    }
    return `Hey ${name}! Last time we ${memory.lastSessionMode === 'quiz' ? 'did a quiz' : 'covered some concepts'}. Ready to work on ${topic} today?`;
  }

  // First-time voice user
  if (memory.totalVoiceSessions === 0) {
    if (isHi) {
      return `नमस्ते ${name}! मैं Foxy हूँ, तुम्हारा ट्यूटर। बोलो, मैं सुन रहा हूँ। ${topic} शुरू करें?`;
    }
    return `Hey ${name}! I'm Foxy, your study buddy. Just talk to me like you'd talk to a friend. Ready to start with ${topic}?`;
  }

  // Streak recognition
  if (memory.sessionStreak >= 3) {
    if (isHi) {
      return `${name}! ${memory.sessionStreak} दिन लगातार — शानदार! चलो ${topic} आगे बढ़ाते हैं।`;
    }
    return `${name}! ${memory.sessionStreak} days in a row — you're on a roll! Let's keep going with ${topic}.`;
  }

  // Default
  if (isHi) {
    return `नमस्ते ${name}! आज ${topic} पर काम करते हैं। तैयार?`;
  }
  return `Hey ${name}! Let's work on ${topic} today. Ready?`;
}

// ─── Sentiment Detection (simple heuristic) ──────────────
// DEPRECATED: Use foxy-nlu.ts analyzeUtterance() for proper NLU.
// Kept as fallback only.

export function detectSentiment(
  studentText: string,
  responseTimeMs: number,
  wordCount: number,
): VoiceSessionState['lastStudentSentiment'] {
  const text = studentText.toLowerCase();

  // Confusion signals
  if (text.includes("don't understand") || text.includes('samajh nahi') ||
      text.includes('confused') || text.includes('what?') || text.includes('kya?')) {
    return 'confused';
  }

  // Frustration signals
  if (text.includes("i can't") || text.includes('nahi hoga') ||
      text.includes('too hard') || text.includes('leave it')) {
    return 'frustrated';
  }

  // Boredom signals
  if (wordCount <= 2 && responseTimeMs > 5000) return 'bored';
  if (text === 'ok' || text === 'hmm' || text === 'ya' || text === 'haan') return 'bored';

  // Engagement signals
  if (text.includes('why') || text.includes('how') || text.includes('kaise') ||
      text.includes('tell me more') || text.includes('aur batao') || wordCount > 15) {
    return 'engaged';
  }

  return 'neutral';
}

// ─── Session Summary Generator ───────────────────────────

export function generateSessionSummary(state: VoiceSessionState): string {
  const accuracy = state.questionsAsked > 0
    ? Math.round((state.questionsCorrect / state.questionsAsked) * 100)
    : null;

  const parts: string[] = [];
  parts.push(`${state.mode} session on ${state.topic} (${state.subject})`);
  parts.push(`${state.turnCount} turns, ${Math.round(state.sessionDurationSec / 60)} minutes`);

  if (accuracy !== null) {
    parts.push(`${state.questionsCorrect}/${state.questionsAsked} correct (${accuracy}%)`);
  }

  if (state.conceptsCovered.length > 0) {
    parts.push(`Covered: ${state.conceptsCovered.join(', ')}`);
  }

  if (state.consecutiveCorrect >= 3) {
    parts.push('Had a strong streak');
  }

  if (state.consecutiveWrong >= 2) {
    parts.push('Struggled with some concepts');
  }

  return parts.join('. ') + '.';
}
