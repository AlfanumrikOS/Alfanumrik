/**
 * ALFANUMRIK — Foxy Dialogue Manager + RLHF + HITL
 *
 * Manages conversation state, turn-taking, and learning from feedback.
 *
 * DIALOGUE MANAGEMENT:
 *   Tracks conversation state across turns using a dialogue state machine.
 *   Decides what Foxy should do next based on NLU output + history.
 *
 * RLHF (Reinforcement Learning from Human Feedback):
 *   Student feedback (thumbs up/down, implicit signals) trains the system
 *   to select better response strategies over time.
 *
 * HITL (Human-in-the-Loop):
 *   Flags low-confidence NLU results and edge cases for human review.
 *   Teachers/admins can correct Foxy's behavior to improve future sessions.
 */

import type { NLUResult, StudentIntent, StudentEmotion } from './foxy-nlu';
import type { SessionMode, VoiceSessionState, LearnerMemory } from './foxy-voice-engine';

// ─── Dialogue State Machine ─────────────────────────────

export type DialogueState =
  | 'greeting'          // session start
  | 'topic_selection'   // deciding what to study
  | 'explaining'        // Foxy is teaching
  | 'checking'          // Foxy asked a comprehension check
  | 'quizzing'          // Foxy is asking quiz questions
  | 'waiting_answer'    // waiting for student's answer
  | 'giving_feedback'   // responding to student's answer
  | 'hinting'           // giving hints after wrong answer
  | 'remediating'       // simplifying after struggle
  | 'motivating'        // building confidence
  | 'recapping'         // summarizing session
  | 'farewell'          // ending session
  | 'handling_doubt'    // answering student's question
  | 'off_topic_redirect'; // steering back from off-topic

export interface DialogueContext {
  state: DialogueState;
  previousStates: DialogueState[];  // last 5 states for backtracking
  currentSlot: DialogueSlot;
  turnsSinceLastQuestion: number;
  turnsSinceLastExplanation: number;
  turnsSinceStateChange: number;
  unansweredQuestions: string[];     // Foxy's questions student hasn't answered
  pendingTopics: string[];           // topics queued to cover
  coveredTopics: string[];
  activeQuestion: string | null;     // current quiz question
  hintLevel: number;                 // 0 = no hint, 1 = first hint, 2 = second hint, 3 = give answer
  maxHints: number;
}

interface DialogueSlot {
  subject: string | null;
  topic: string | null;
  subtopic: string | null;
  difficulty: 'easy' | 'medium' | 'hard' | null;
  questionType: 'recall' | 'understanding' | 'application' | null;
}

export function createDialogueContext(subject: string, topic: string): DialogueContext {
  return {
    state: 'greeting',
    previousStates: [],
    currentSlot: { subject, topic, subtopic: null, difficulty: null, questionType: null },
    turnsSinceLastQuestion: 0,
    turnsSinceLastExplanation: 0,
    turnsSinceStateChange: 0,
    unansweredQuestions: [],
    pendingTopics: [],
    coveredTopics: [],
    activeQuestion: null,
    hintLevel: 0,
    maxHints: 2,
  };
}

// ─── Dialogue Policy (what to do next) ──────────────────

export interface DialogueAction {
  nextState: DialogueState;
  responseType: ResponseType;
  modifiers: ResponseModifier[];
  reason: string;
}

export type ResponseType =
  | 'explain_concept'
  | 'ask_question'
  | 'give_hint'
  | 'give_answer'
  | 'correct_feedback'
  | 'wrong_feedback'
  | 'encouragement'
  | 'topic_transition'
  | 'comprehension_check'
  | 'recap_summary'
  | 'greeting'
  | 'farewell'
  | 'redirect_to_topic'
  | 'answer_doubt'
  | 'simplify_explanation';

export type ResponseModifier =
  | 'use_analogy'
  | 'use_example'
  | 'use_visual'
  | 'slow_pace'
  | 'fast_pace'
  | 'extra_encouragement'
  | 'increase_difficulty'
  | 'decrease_difficulty'
  | 'ask_for_reasoning'
  | 'connect_to_real_life';

/**
 * Core dialogue policy — decides Foxy's next action based on
 * NLU result + dialogue context + learner memory.
 */
export function selectDialogueAction(
  nlu: NLUResult,
  ctx: DialogueContext,
  memory: LearnerMemory,
  sessionState: VoiceSessionState,
): DialogueAction {
  const { intent, emotion, pedagogicalSignals, discourse } = nlu;

  // ── FAREWELL: student wants to leave ──
  if (intent === 'farewell') {
    return {
      nextState: 'farewell',
      responseType: 'farewell',
      modifiers: [],
      reason: 'Student indicated they want to end the session.',
    };
  }

  // ── FRUSTRATION: immediate intervention ──
  if (emotion === 'frustrated' || intent === 'express_frustration') {
    return {
      nextState: 'motivating',
      responseType: 'encouragement',
      modifiers: ['extra_encouragement', 'decrease_difficulty'],
      reason: 'Student is frustrated. Switch to motivational mode with easier content.',
    };
  }

  // ── DOUBT: student is asking a question ──
  if (intent === 'ask_doubt' || intent === 'request_explanation') {
    return {
      nextState: 'handling_doubt',
      responseType: 'answer_doubt',
      modifiers: memory.explanationStyle === 'analogy' ? ['use_analogy'] : ['use_example'],
      reason: 'Student asked a question. Answer it before continuing.',
    };
  }

  // ── REQUEST SIMPLER: struggling ──
  if (intent === 'request_simpler' || intent === 'deny_understanding') {
    return {
      nextState: 'remediating',
      responseType: 'simplify_explanation',
      modifiers: ['decrease_difficulty', 'use_analogy', 'slow_pace'],
      reason: 'Student needs simpler explanation.',
    };
  }

  // ── REQUEST HARDER: bored or advanced ──
  if (intent === 'request_harder' || intent === 'express_boredom') {
    return {
      nextState: 'quizzing',
      responseType: 'ask_question',
      modifiers: ['increase_difficulty', 'ask_for_reasoning'],
      reason: 'Student wants more challenge. Increase difficulty.',
    };
  }

  // ── REQUEST HINT: during quiz ──
  if (intent === 'request_hint' && ctx.state === 'waiting_answer') {
    ctx.hintLevel++;
    if (ctx.hintLevel > ctx.maxHints) {
      return {
        nextState: 'giving_feedback',
        responseType: 'give_answer',
        modifiers: ['use_example'],
        reason: 'Max hints reached. Give the answer with explanation.',
      };
    }
    return {
      nextState: 'hinting',
      responseType: 'give_hint',
      modifiers: [],
      reason: `Giving hint ${ctx.hintLevel} of ${ctx.maxHints}.`,
    };
  }

  // ── ANSWER: student responded to a quiz question ──
  if (intent === 'answer_question' && ctx.state === 'waiting_answer') {
    // Correctness will be determined by the LLM layer
    // For now, return a generic "evaluate answer" action
    return {
      nextState: 'giving_feedback',
      responseType: sessionState.consecutiveCorrect > 0 ? 'correct_feedback' : 'wrong_feedback',
      modifiers: sessionState.consecutiveCorrect >= 3 ? ['increase_difficulty'] : [],
      reason: 'Student answered a question. Evaluate and give feedback.',
    };
  }

  // ── CONFIRM UNDERSTANDING: move forward ──
  if (intent === 'confirm_understanding') {
    // After explanation → ask a checking question
    if (ctx.state === 'explaining' || ctx.state === 'handling_doubt') {
      return {
        nextState: 'checking',
        responseType: 'comprehension_check',
        modifiers: [],
        reason: 'Student says they understand. Verify with a question.',
      };
    }
    // After checking → continue to next topic or quiz
    return {
      nextState: 'quizzing',
      responseType: 'ask_question',
      modifiers: [],
      reason: 'Understanding confirmed. Move to practice.',
    };
  }

  // ── OFF-TOPIC: redirect gently ──
  if (intent === 'social_chat') {
    return {
      nextState: 'off_topic_redirect',
      responseType: 'redirect_to_topic',
      modifiers: [],
      reason: 'Student went off-topic. Gently redirect.',
    };
  }

  // ── BOREDOM: detected from discourse features ──
  if (discourse.consecutiveBriefResponses >= 3 || discourse.engagementTrend === 'decreasing') {
    return {
      nextState: 'quizzing',
      responseType: 'ask_question',
      modifiers: ['connect_to_real_life', 'increase_difficulty'],
      reason: 'Engagement dropping. Switch to interactive quiz with real-world connection.',
    };
  }

  // ── DEFAULT: continue based on current state ──
  switch (ctx.state) {
    case 'greeting':
      return { nextState: 'explaining', responseType: 'explain_concept', modifiers: [], reason: 'Session started. Begin teaching.' };

    case 'explaining':
      ctx.turnsSinceLastExplanation = 0;
      if (ctx.turnsSinceLastQuestion >= 3) {
        return { nextState: 'checking', responseType: 'comprehension_check', modifiers: [], reason: 'Explained 3 turns. Time to check understanding.' };
      }
      return { nextState: 'explaining', responseType: 'explain_concept', modifiers: [], reason: 'Continue explanation.' };

    case 'quizzing':
    case 'checking':
      return { nextState: 'waiting_answer', responseType: 'ask_question', modifiers: [], reason: 'Ask next question.' };

    case 'giving_feedback':
      ctx.hintLevel = 0;
      if (ctx.coveredTopics.length >= 3 && sessionState.sessionDurationSec > 600) {
        return { nextState: 'recapping', responseType: 'recap_summary', modifiers: [], reason: 'Covered enough topics. Recap.' };
      }
      return { nextState: 'quizzing', responseType: 'ask_question', modifiers: [], reason: 'Continue quiz.' };

    default:
      return { nextState: 'explaining', responseType: 'explain_concept', modifiers: [], reason: 'Default: continue teaching.' };
  }
}

/**
 * Apply dialogue action — updates context state.
 */
export function applyAction(ctx: DialogueContext, action: DialogueAction): void {
  ctx.previousStates.push(ctx.state);
  if (ctx.previousStates.length > 5) ctx.previousStates.shift();

  ctx.state = action.nextState;
  ctx.turnsSinceStateChange = action.nextState !== ctx.state ? 0 : ctx.turnsSinceStateChange + 1;
  ctx.turnsSinceLastQuestion++;
  ctx.turnsSinceLastExplanation++;

  if (action.responseType === 'ask_question' || action.responseType === 'comprehension_check') {
    ctx.turnsSinceLastQuestion = 0;
  }
  if (action.responseType === 'explain_concept' || action.responseType === 'simplify_explanation') {
    ctx.turnsSinceLastExplanation = 0;
  }
}

// ─── RLHF: Learning from Feedback ───────────────────────

export interface FeedbackSignal {
  sessionId: string;
  turnIndex: number;
  signalType: 'explicit_positive' | 'explicit_negative' | 'implicit_engaged' | 'implicit_disengaged';
  responseType: ResponseType;
  modifiers: ResponseModifier[];
  emotion: StudentEmotion;
  intent: StudentIntent;
  context: {
    mode: SessionMode;
    topic: string;
    grade: string;
    confidenceLevel: string;
  };
}

/**
 * Record a feedback signal for RLHF training.
 * Explicit: student clicked thumbs up/down.
 * Implicit: derived from engagement metrics.
 */
export function createFeedbackSignal(
  sessionId: string,
  turnIndex: number,
  isPositive: boolean,
  isExplicit: boolean,
  action: DialogueAction,
  nlu: NLUResult,
  sessionState: VoiceSessionState,
  memory: LearnerMemory,
): FeedbackSignal {
  return {
    sessionId,
    turnIndex,
    signalType: isExplicit
      ? (isPositive ? 'explicit_positive' : 'explicit_negative')
      : (isPositive ? 'implicit_engaged' : 'implicit_disengaged'),
    responseType: action.responseType,
    modifiers: action.modifiers,
    emotion: nlu.emotion,
    intent: nlu.intent,
    context: {
      mode: sessionState.mode,
      topic: sessionState.topic,
      grade: memory.grade,
      confidenceLevel: memory.confidenceLevel,
    },
  };
}

/**
 * Derive implicit feedback from session metrics.
 * Called at end of session to generate RLHF training data.
 */
export function deriveImplicitFeedback(
  sessionState: VoiceSessionState,
  memory: LearnerMemory,
): Array<{ turnIndex: number; isPositive: boolean }> {
  const signals: Array<{ turnIndex: number; isPositive: boolean }> = [];

  // Positive: student stayed for > 5 minutes
  if (sessionState.sessionDurationSec > 300) {
    signals.push({ turnIndex: -1, isPositive: true });
  }

  // Positive: high accuracy
  if (sessionState.questionsAsked > 3 && sessionState.questionsCorrect / sessionState.questionsAsked > 0.7) {
    signals.push({ turnIndex: -1, isPositive: true });
  }

  // Negative: many silences (student disengaged)
  if (sessionState.silenceCount > 3) {
    signals.push({ turnIndex: -1, isPositive: false });
  }

  // Negative: short session with struggle
  if (sessionState.sessionDurationSec < 120 && sessionState.consecutiveWrong >= 2) {
    signals.push({ turnIndex: -1, isPositive: false });
  }

  return signals;
}

// ─── HITL: Human-in-the-Loop Flagging ────────────────────

export interface HITLFlag {
  sessionId: string;
  turnIndex: number;
  flagType: HITLFlagType;
  studentText: string;
  foxyResponse: string;
  nluResult: NLUResult;
  dialogueAction: DialogueAction;
  reason: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
}

export type HITLFlagType =
  | 'low_nlu_confidence'      // NLU couldn't classify intent/emotion
  | 'possible_misconception'  // student may have a misconception
  | 'safety_concern'          // inappropriate content
  | 'off_curriculum'          // question outside CBSE scope
  | 'repeated_struggle'       // student failed same concept 3+ times
  | 'edge_case'               // unusual interaction pattern
  | 'student_distress';       // emotional distress signals

/**
 * Check if a turn should be flagged for human review.
 */
export function checkForHITLFlags(
  sessionId: string,
  turnIndex: number,
  studentText: string,
  foxyResponse: string,
  nlu: NLUResult,
  action: DialogueAction,
  sessionState: VoiceSessionState,
): HITLFlag[] {
  const flags: HITLFlag[] = [];
  const base = { sessionId, turnIndex, studentText, foxyResponse, nluResult: nlu, dialogueAction: action };

  // Low NLU confidence
  if (nlu.intentConfidence < 0.4 && nlu.emotionConfidence < 0.4) {
    flags.push({
      ...base,
      flagType: 'low_nlu_confidence',
      reason: `Intent confidence ${nlu.intentConfidence}, emotion confidence ${nlu.emotionConfidence}`,
      priority: 'low',
    });
  }

  // Possible misconception detected
  const misconception = nlu.pedagogicalSignals.find(s => s.type === 'misconception');
  if (misconception) {
    flags.push({
      ...base,
      flagType: 'possible_misconception',
      reason: misconception.detail,
      priority: 'medium',
    });
  }

  // Repeated struggle
  if (sessionState.consecutiveWrong >= 4) {
    flags.push({
      ...base,
      flagType: 'repeated_struggle',
      reason: `${sessionState.consecutiveWrong} consecutive wrong answers on ${sessionState.topic}`,
      priority: 'high',
    });
  }

  // Student distress
  if (nlu.emotion === 'frustrated' && nlu.emotionConfidence > 0.8) {
    const distressWords = ['hate', 'stupid', 'useless', 'worst', 'nahi hoga', 'pagal'];
    if (distressWords.some(w => studentText.toLowerCase().includes(w))) {
      flags.push({
        ...base,
        flagType: 'student_distress',
        reason: 'High-confidence frustration with distress language',
        priority: 'critical',
      });
    }
  }

  // Safety concern
  const safetyPatterns = /\b(kill|die|hurt|violence|suicide|bully)\b/i;
  if (safetyPatterns.test(studentText)) {
    flags.push({
      ...base,
      flagType: 'safety_concern',
      reason: 'Potential safety-related content detected',
      priority: 'critical',
    });
  }

  return flags;
}
