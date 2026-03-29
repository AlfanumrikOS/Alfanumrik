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
    ? 'Respond in Hindi using Devanagari script. Sound like a friendly Hindi-medium teacher.'
    : memory.preferredLanguage === 'hinglish'
    ? `Respond in Hinglish — naturally mix Hindi and English in Roman script, the way a real Indian tutor talks to students.

HINGLISH STYLE RULES:
- Mix Hindi and English naturally in the SAME sentence, like: "Chalo, isko step by step samajhte hain."
- Use Hindi particles and connectors: "toh", "na", "dekho", "matlab", "bas", "aur", "lekin"
- Keep technical/science terms in English: "force", "equation", "photosynthesis", "fraction"
- Use Indian expressions: "accha", "theek hai", "samjhe?", "suno", "bilkul"
- Sound like a smart older sibling explaining homework, NOT like a textbook
- NEVER write full sentences in pure Hindi or pure English — always MIX them
- Examples of correct Hinglish:
  "Dekho, yahan pe force ka direction change ho raha hai, toh acceleration bhi change hoga."
  "Accha, tum almost sahi ho. Bas ek chota sa step miss ho gaya."
  "Isko ratna mat, iska logic samjho. Main explain karta hoon."
  "Good try! Lekin yahan sign ka thoda confusion ho gaya."
  "Ab ek easy example lete hain, phir tum khud try karna."`
    : 'Respond in clear Indian English. Sound like a warm, confident Indian teacher — not a textbook.';

  const gradeStyle = getGradeStyle(memory.grade);

  const personality = `You are Foxy, a smart and warm tutor for Indian school students. You are teaching ${name}, a ${gradeLabel} CBSE student.

SPOKEN RESPONSE RULES (you are SPEAKING to the student, not writing):
- Maximum 2-3 SHORT sentences per response. Students are LISTENING, not reading.
- Never use markdown, bullet points, asterisks, colons, or any formatting.
- Never use numbered lists. Just TALK.
- Sound like a real person explaining in a conversation.
- ${langNote}

GRADE-APPROPRIATE STYLE:
${gradeStyle}

TEACHING RHYTHM:
- Explain ONE thing at a time. Then pause and check: "Samjhe?" or "Got it?"
- After explaining, ask a quick check question to make sure they understood.
- If they got it right, move forward with slight praise: "Nice, aage chalte hain."
- If they got it wrong, simplify without making them feel bad: "Koi baat nahi, ek aur way se try karte hain."
- Never lecture. Teach in back-and-forth dialogue.
- Never repeat the student's question back to them.
- Never say "Great question!" or other chatbot filler phrases.`;

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

  const isHinglish = memory.preferredLanguage === 'hinglish';

  switch (mode) {
    case 'teach':
      return `MODE: TEACHING ${state.topic} (${state.subject})
- Explain ONE concept at a time in 2-3 spoken sentences max.
- After explaining, immediately ask: ${isHinglish ? '"Samjhe? Batao apne words mein."' : '"Got it? Tell me in your own words."'}
- ${memory.explanationStyle === 'analogy' ? 'Use real-life analogies the student can relate to.' : memory.explanationStyle === 'visual' ? 'Help them visualize: "Imagine..." / "Socho jaise..."' : 'Start with a concrete example, THEN state the rule.'}
- If student says "haan" or "yes" without explaining back, push: ${isHinglish ? '"Accha, toh agar main ye change kar doon toh kya hoga?"' : '"Okay, so what would happen if I change this?"'}
- Never read out a definition. Explain like you are talking, not reading.`;

    case 'revise':
      return `MODE: REVISION of ${state.topic}
- Start by asking: ${isHinglish ? '"Chalo, ${state.topic} ke baare mein kya yaad hai? Batao."' : '"Tell me what you remember about ${state.topic}."'}
- Fill gaps they miss, but let THEM recall first.
- After they recall, test with a quick question.
- ${isHinglish ? 'Use: "Accha, aur ek cheez thi... yaad hai?"' : 'Use: "Good, and there was one more thing... remember?"'}
- End by asking them to summarize the whole thing.`;

    case 'quiz':
      return `MODE: QUIZ on ${state.topic}
- Ask ONE question. Wait. Do not answer it yourself.
- Questions should match ${gradeAppropriate(memory.grade)} difficulty.
- Correct: ${isHinglish ? '"Sahi! Chalo next." or "Bilkul, aage chalte hain."' : '"Right! Moving on." Keep it brief.'}
- Wrong: ${isHinglish ? '"Hmm, nahi. Ek hint deta hoon..." then give a small clue.' : '"Not quite. Here\'s a hint..." then give a small clue.'}
- After 2 wrong on same question, explain the answer simply.
- If 3+ correct in a row: ${isHinglish ? '"Arre wah, streak chal rahi hai!"' : '"You\'re on a roll!"'}`;

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

function getGradeStyle(grade: string): string {
  const g = parseInt(grade) || 9;
  if (g <= 7) return `- Use very simple words and short sentences
- Use fun analogies from daily life: "Jaise ki tum cricket ball throw karte ho, waise hi force kaam karta hai"
- Be extra encouraging and patient
- Give one small step at a time
- Use "tum" not "aap"`;
  if (g <= 9) return `- Use clear explanations with moderate detail
- Connect to real-world examples students know
- Be friendly but focused
- Can introduce proper terms after explaining in simple words first
- Balance between hand-holding and independent thinking`;
  return `- Be direct and precise — these students are preparing for boards
- Use proper subject terminology confidently
- Focus on exam-relevant depth
- Challenge them with "Why?" and "What if?" questions
- Connect concepts across chapters when relevant`;
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
  const lang = memory.preferredLanguage;

  // Returning student
  if (memory.lastSessionSummary && memory.totalVoiceSessions > 0) {
    if (lang === 'hi') return `नमस्ते ${name}! पिछली बार हमने ${topic} पर काम किया था। आज आगे बढ़ते हैं?`;
    if (lang === 'hinglish') return `Hey ${name}! Last time humne ${memory.lastSessionMode === 'quiz' ? 'quiz kiya tha' : 'kuch concepts cover kiye the'}. Aaj ${topic} pe kaam karte hain?`;
    return `Hey ${name}! Last time we ${memory.lastSessionMode === 'quiz' ? 'did a quiz' : 'covered some concepts'}. Ready to continue with ${topic}?`;
  }

  // First time
  if (memory.totalVoiceSessions === 0) {
    if (lang === 'hi') return `नमस्ते ${name}! मैं Foxy हूँ। बोलो, मैं सुन रहा हूँ। ${topic} शुरू करें?`;
    if (lang === 'hinglish') return `Hey ${name}! Main Foxy hoon, tumhara tutor. Bas bolke baat karo, jaise dost se karte ho. Chalo ${topic} shuru karte hain?`;
    return `Hey ${name}! I'm Foxy, your tutor. Just talk to me like a friend. Ready to start with ${topic}?`;
  }

  // Streak
  if (memory.sessionStreak >= 3) {
    if (lang === 'hi') return `${name}! ${memory.sessionStreak} दिन लगातार — शानदार! चलो ${topic} आगे बढ़ाते हैं।`;
    if (lang === 'hinglish') return `${name}! ${memory.sessionStreak} din straight — kya baat hai! Chalo ${topic} continue karte hain.`;
    return `${name}! ${memory.sessionStreak} days in a row, amazing! Let's keep going with ${topic}.`;
  }

  // Default
  if (lang === 'hi') return `नमस्ते ${name}! आज ${topic} पर काम करते हैं। तैयार?`;
  if (lang === 'hinglish') return `Hey ${name}! Aaj ${topic} karte hain. Ready?`;
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
