/**
 * ALFANUMRIK — Foxy NLU (Natural Language Understanding)
 *
 * Multi-layer NLU pipeline for understanding student utterances
 * during voice sessions. Operates in real-time (<200ms for local,
 * <800ms when using LLM layer).
 *
 * Pipeline:
 *   Raw text → Preprocessing → Feature Extraction → Intent Classification
 *              → Entity Recognition → Emotion Detection → Discourse Analysis
 *              → Pedagogical Signal Extraction → Unified NLU Result
 *
 * Layer 1: Linguistic feature extraction (local, instant)
 * Layer 2: Intent + entity classification (LLM-backed, async)
 * Layer 3: Discourse-level tracking (accumulates across turns)
 */

// ─── NLU Result Types ────────────────────────────────────

export interface NLUResult {
  // What the student is trying to do
  intent: StudentIntent;
  intentConfidence: number; // 0-1

  // What they're talking about
  entities: ExtractedEntity[];

  // How they feel
  emotion: StudentEmotion;
  emotionConfidence: number;

  // Pedagogical signals
  pedagogicalSignals: PedagogicalSignal[];

  // Discourse features
  discourse: DiscourseFeatures;

  // Raw linguistic features
  linguistic: LinguisticFeatures;
}

export type StudentIntent =
  | 'answer_question'     // responding to a quiz question
  | 'ask_doubt'           // asking for clarification
  | 'request_explanation' // "explain this to me"
  | 'request_example'     // "give me an example"
  | 'request_repeat'      // "say that again"
  | 'request_simpler'     // "make it easier"
  | 'request_harder'      // "this is too easy"
  | 'confirm_understanding' // "yes I get it"
  | 'deny_understanding'  // "no I don't get it"
  | 'request_topic_change'// "let's do something else"
  | 'express_frustration' // "I give up"
  | 'express_boredom'     // "this is boring"
  | 'social_chat'         // off-topic conversation
  | 'request_quiz'        // "quiz me"
  | 'request_hint'        // "give me a hint"
  | 'greeting'            // "hi", "hello"
  | 'farewell'            // "bye", "I'm done"
  | 'unknown';

export type StudentEmotion =
  | 'confident'    // sure of themselves
  | 'curious'      // wanting to know more
  | 'confused'     // doesn't understand
  | 'frustrated'   // struggling and upset
  | 'bored'        // disengaged
  | 'anxious'      // worried about getting it wrong
  | 'excited'      // engaged and enthusiastic
  | 'neutral';

export interface ExtractedEntity {
  type: 'subject' | 'topic' | 'concept' | 'formula' | 'number' | 'answer_option';
  value: string;
  span: [number, number]; // character positions
}

export interface PedagogicalSignal {
  type: 'misconception' | 'partial_understanding' | 'knowledge_gap' |
        'correct_reasoning' | 'rote_answer' | 'deep_understanding' |
        'transfer_attempt' | 'metacognitive_awareness';
  detail: string;
  confidence: number;
}

export interface DiscourseFeatures {
  turnPosition: number;
  isFollowUp: boolean;           // relates to previous Foxy utterance
  isTopicShift: boolean;         // student changed subject
  responseLatencyMs: number;     // how long they took to respond
  verbosity: 'minimal' | 'brief' | 'moderate' | 'elaborate';
  engagementTrend: 'increasing' | 'stable' | 'decreasing';
  consecutiveBriefResponses: number;
}

export interface LinguisticFeatures {
  language: 'en' | 'hi' | 'hinglish' | 'mixed';
  wordCount: number;
  sentenceCount: number;
  questionCount: number;
  negationPresent: boolean;
  uncertaintyMarkers: number;  // "maybe", "I think", "shayad"
  hedgingPresent: boolean;     // "kind of", "sort of", "thoda"
  emphasisMarkers: number;     // "definitely", "exactly", "bilkul"
  fillerCount: number;         // "um", "uh", "hmm"
  codeSwitch: boolean;         // switched between en/hi mid-utterance
}

// ─── Layer 1: Linguistic Feature Extraction (Local) ──────

const HINDI_UNCERTAINTY = ['shayad', 'lagta hai', 'pata nahi', 'ho sakta'];
const ENGLISH_UNCERTAINTY = ['maybe', 'i think', 'not sure', 'probably', 'i guess', 'perhaps'];
const HINDI_HEDGE = ['thoda', 'kuch kuch', 'aise hi', 'lagbhag'];
const ENGLISH_HEDGE = ['kind of', 'sort of', 'a bit', 'somewhat', 'like'];
const HINDI_EMPHASIS = ['bilkul', 'pakka', 'zaroor', 'haan haan', 'ekdum'];
const ENGLISH_EMPHASIS = ['definitely', 'exactly', 'absolutely', 'for sure', 'of course', 'yes yes'];
const FILLERS = ['um', 'uh', 'hmm', 'erm', 'like', 'you know', 'matlab', 'woh', 'toh'];
const HINDI_NEGATION = ['nahi', 'nhi', 'nahin', 'mat', 'na', 'kabhi nahi'];
const ENGLISH_NEGATION = ["don't", "doesn't", "didn't", "can't", "cannot", "won't", "not", "no", "never"];

export function extractLinguisticFeatures(text: string): LinguisticFeatures {
  const lower = text.toLowerCase().trim();
  const words = lower.split(/\s+/).filter(Boolean);
  const sentences = text.split(/[.!?।]+/).filter(s => s.trim().length > 0);
  const questions = text.split('?').length - 1;

  // Language detection
  const hindiPattern = /[\u0900-\u097F]/;
  const hasHindi = hindiPattern.test(text);
  const hasEnglish = /[a-zA-Z]{2,}/.test(text);
  const hindiRomanized = HINDI_UNCERTAINTY.concat(HINDI_HEDGE, HINDI_EMPHASIS, HINDI_NEGATION)
    .some(w => lower.includes(w));

  let language: LinguisticFeatures['language'] = 'en';
  if (hasHindi && hasEnglish) language = 'mixed';
  else if (hasHindi) language = 'hi';
  else if (hindiRomanized && hasEnglish) language = 'hinglish';

  // Feature counts
  const uncertaintyMarkers = [...HINDI_UNCERTAINTY, ...ENGLISH_UNCERTAINTY]
    .filter(m => lower.includes(m)).length;
  const hedging = [...HINDI_HEDGE, ...ENGLISH_HEDGE].some(h => lower.includes(h));
  const emphasisMarkers = [...HINDI_EMPHASIS, ...ENGLISH_EMPHASIS]
    .filter(e => lower.includes(e)).length;
  const fillerCount = words.filter(w => FILLERS.includes(w)).length;
  const negation = [...HINDI_NEGATION, ...ENGLISH_NEGATION].some(n => lower.includes(n));
  const codeSwitch = (hasHindi || hindiRomanized) && hasEnglish;

  return {
    language,
    wordCount: words.length,
    sentenceCount: sentences.length,
    questionCount: questions,
    negationPresent: negation,
    uncertaintyMarkers,
    hedgingPresent: hedging,
    emphasisMarkers,
    fillerCount,
    codeSwitch,
  };
}

// ─── Layer 1b: Intent Classification (Rule-based fast path) ─

const INTENT_PATTERNS: Array<{ intent: StudentIntent; patterns: RegExp[] }> = [
  { intent: 'ask_doubt', patterns: [
    /\b(what|why|how|when|where|which)\b.*\?/i,
    /\b(kya|kaise|kyun|kab|kahan)\b/i,
    /\b(explain|samjhao|bata|batao)\b/i,
    /\b(doubt|question|sawaal)\b/i,
  ]},
  { intent: 'request_example', patterns: [
    /\b(example|udaharan|for instance|jaise)\b/i,
    /\bshow me\b/i,
    /\blike what\b/i,
  ]},
  { intent: 'request_repeat', patterns: [
    /\b(again|repeat|dobara|phir se|once more|ek baar aur)\b/i,
    /\b(sorry.*(didn't|did not).*hear|sun nahi)\b/i,
  ]},
  { intent: 'request_simpler', patterns: [
    /\b(simpl|easier|easy|aasan|simple)\b/i,
    /\b(too (hard|difficult|tough))\b/i,
    /\b(mushkil|kathin)\b/i,
    /\bdon'?t (understand|get)\b/i,
    /\bsamajh (nahi|nhi)\b/i,
  ]},
  { intent: 'request_harder', patterns: [
    /\b(harder|difficult|challenge|tough|mushkil wala)\b/i,
    /\b(too (easy|simple))\b/i,
    /\bboring|bore\b/i,
    /\bbahut aasan\b/i,
  ]},
  { intent: 'confirm_understanding', patterns: [
    /^(yes|yeah|yep|yup|ya|haan|ha|ok|okay|sure|got it|samajh gaya|samajh gayi|accha|theek)$/i,
    /\b(i (get|understand|know)|samajh aa gaya)\b/i,
  ]},
  { intent: 'deny_understanding', patterns: [
    /^(no|nahi|nhi|na)$/i,
    /\b(confused|don'?t (get|understand))\b/i,
    /\b(samajh nahi|nahi samjha|pata nahi)\b/i,
  ]},
  { intent: 'express_frustration', patterns: [
    /\b(give up|can'?t do|hate|impossible|fed up|thak gaya)\b/i,
    /\b(nahi hoga|chhod do|bahut mushkil)\b/i,
    /\b(ugh|argh)\b/i,
  ]},
  { intent: 'express_boredom', patterns: [
    /\b(boring|bored|bore ho raha)\b/i,
    /\b(kuch aur|something else)\b/i,
  ]},
  { intent: 'request_quiz', patterns: [
    /\b(quiz|test|question pucho|sawaal pucho)\b/i,
  ]},
  { intent: 'request_hint', patterns: [
    /\b(hint|clue|help|madad|batao thoda)\b/i,
  ]},
  { intent: 'greeting', patterns: [
    /^(hi|hello|hey|namaste|namaskar)\b/i,
  ]},
  { intent: 'farewell', patterns: [
    /\b(bye|goodbye|done|finish|khatam|bas|alvida)\b/i,
    /\b(i'?m done|ho gaya)\b/i,
  ]},
  { intent: 'request_topic_change', patterns: [
    /\b(next|agle|dusra topic|change|skip)\b/i,
  ]},
];

function classifyIntentLocal(text: string): { intent: StudentIntent; confidence: number } {
  const lower = text.toLowerCase().trim();

  for (const { intent, patterns } of INTENT_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(lower)) {
        return { intent, confidence: 0.75 };
      }
    }
  }

  // If it looks like an answer (short, no question marks, during quiz)
  const words = lower.split(/\s+/);
  if (words.length <= 5 && !lower.includes('?')) {
    return { intent: 'answer_question', confidence: 0.5 };
  }

  return { intent: 'unknown', confidence: 0.3 };
}

// ─── Layer 1c: Emotion Detection (Feature-based) ─────────

function detectEmotionLocal(
  text: string,
  linguistic: LinguisticFeatures,
  responseLatencyMs: number,
): { emotion: StudentEmotion; confidence: number } {
  const lower = text.toLowerCase();

  // High-confidence emotion signals
  if (linguistic.emphasisMarkers >= 2 && !linguistic.negationPresent) {
    return { emotion: 'confident', confidence: 0.8 };
  }

  if (linguistic.questionCount >= 2 || (linguistic.questionCount >= 1 && linguistic.wordCount > 10)) {
    return { emotion: 'curious', confidence: 0.8 };
  }

  // Frustration: negation + emphasis or short + negative
  if (linguistic.negationPresent && (
    lower.includes("can't") || lower.includes('nahi hoga') ||
    lower.includes('give up') || lower.includes('hate')
  )) {
    return { emotion: 'frustrated', confidence: 0.85 };
  }

  // Confusion: uncertainty + hedging
  if (linguistic.uncertaintyMarkers >= 1 && linguistic.hedgingPresent) {
    return { emotion: 'confused', confidence: 0.75 };
  }
  if (linguistic.uncertaintyMarkers >= 2) {
    return { emotion: 'confused', confidence: 0.7 };
  }

  // Anxiety: fillers + uncertainty + short response time
  if (linguistic.fillerCount >= 2 && linguistic.uncertaintyMarkers >= 1) {
    return { emotion: 'anxious', confidence: 0.65 };
  }

  // Boredom: minimal response + high latency
  if (linguistic.wordCount <= 2 && responseLatencyMs > 5000) {
    return { emotion: 'bored', confidence: 0.7 };
  }
  if (linguistic.wordCount <= 1 && ['ok', 'hmm', 'ya', 'haan', 'fine'].includes(lower.trim())) {
    return { emotion: 'bored', confidence: 0.75 };
  }

  // Excitement: long response + emphasis + questions
  if (linguistic.wordCount > 15 && linguistic.emphasisMarkers >= 1) {
    return { emotion: 'excited', confidence: 0.7 };
  }

  // Curious: asking questions
  if (linguistic.questionCount >= 1) {
    return { emotion: 'curious', confidence: 0.6 };
  }

  return { emotion: 'neutral', confidence: 0.5 };
}

// ─── Layer 2: LLM-Backed Deep NLU (async, optional) ─────

export interface DeepNLURequest {
  studentText: string;
  foxyPreviousText: string;
  currentTopic: string;
  currentMode: string;
  grade: string;
}

/**
 * Deep NLU prompt for Claude — extracts pedagogical signals
 * that rule-based systems cannot detect.
 *
 * Used for:
 * - Misconception detection ("mass and weight are the same")
 * - Partial understanding ("force is push... but I don't know about pull")
 * - Rote vs deep answers ("because the book said so" vs reasoning)
 * - Transfer attempts (applying concept to new context)
 */
export function buildDeepNLUPrompt(req: DeepNLURequest): string {
  return `You are an NLU system analyzing a student's utterance during a tutoring session.

CONTEXT:
- Topic: ${req.currentTopic}
- Grade: ${req.grade} CBSE
- Mode: ${req.currentMode}
- Foxy just said: "${req.foxyPreviousText}"
- Student replied: "${req.studentText}"

ANALYZE the student's reply and output ONLY valid JSON:
{
  "intent": one of ["answer_question","ask_doubt","request_explanation","request_example","request_repeat","request_simpler","request_harder","confirm_understanding","deny_understanding","request_topic_change","express_frustration","express_boredom","social_chat","request_quiz","request_hint","greeting","farewell"],
  "emotion": one of ["confident","curious","confused","frustrated","bored","anxious","excited","neutral"],
  "pedagogical_signals": [
    {
      "type": one of ["misconception","partial_understanding","knowledge_gap","correct_reasoning","rote_answer","deep_understanding","transfer_attempt","metacognitive_awareness"],
      "detail": "brief explanation"
    }
  ],
  "is_on_topic": boolean,
  "answer_correctness": null or "correct" or "incorrect" or "partially_correct"
}

Rules:
- Be precise. Don't over-interpret.
- Detect misconceptions carefully — these are the most valuable signals.
- "rote_answer" = student recites without understanding.
- "metacognitive_awareness" = student reflects on their own thinking ("I always mix these up").
- Output ONLY the JSON. No explanation.`;
}

// ─── Layer 3: Discourse Tracker ──────────────────────────

export class DiscourseTracker {
  private turnCount = 0;
  private recentVerbosities: Array<'minimal' | 'brief' | 'moderate' | 'elaborate'> = [];
  private lastTopic: string | null = null;
  private consecutiveBrief = 0;

  track(text: string, linguistic: LinguisticFeatures, currentTopic: string, responseLatencyMs: number): DiscourseFeatures {
    this.turnCount++;

    const verbosity: DiscourseFeatures['verbosity'] =
      linguistic.wordCount <= 2 ? 'minimal' :
      linguistic.wordCount <= 6 ? 'brief' :
      linguistic.wordCount <= 15 ? 'moderate' : 'elaborate';

    this.recentVerbosities.push(verbosity);
    if (this.recentVerbosities.length > 5) this.recentVerbosities.shift();

    if (verbosity === 'minimal' || verbosity === 'brief') {
      this.consecutiveBrief++;
    } else {
      this.consecutiveBrief = 0;
    }

    // Topic shift detection
    const isTopicShift = this.lastTopic !== null && this.lastTopic !== currentTopic;
    this.lastTopic = currentTopic;

    // Engagement trend from verbosity history
    let engagementTrend: DiscourseFeatures['engagementTrend'] = 'stable';
    if (this.recentVerbosities.length >= 3) {
      const recent = this.recentVerbosities.slice(-3);
      const scores = recent.map(v => v === 'elaborate' ? 3 : v === 'moderate' ? 2 : v === 'brief' ? 1 : 0);
      const trend = scores[2] - scores[0];
      engagementTrend = trend > 0 ? 'increasing' : trend < 0 ? 'decreasing' : 'stable';
    }

    return {
      turnPosition: this.turnCount,
      isFollowUp: this.turnCount > 1,
      isTopicShift,
      responseLatencyMs,
      verbosity,
      engagementTrend,
      consecutiveBriefResponses: this.consecutiveBrief,
    };
  }

  reset() {
    this.turnCount = 0;
    this.recentVerbosities = [];
    this.lastTopic = null;
    this.consecutiveBrief = 0;
  }
}

// ─── Unified NLU Pipeline ────────────────────────────────

/**
 * Run the full NLU pipeline on a student utterance.
 * Layer 1 (local) runs instantly. Layer 2 (LLM) is optional.
 */
export function analyzeUtterance(
  text: string,
  responseLatencyMs: number,
  discourseTracker: DiscourseTracker,
  currentTopic: string,
): NLUResult {
  // Layer 1: Linguistic features
  const linguistic = extractLinguisticFeatures(text);

  // Layer 1b: Intent
  const { intent, confidence: intentConf } = classifyIntentLocal(text);

  // Layer 1c: Emotion
  const { emotion, confidence: emotionConf } = detectEmotionLocal(text, linguistic, responseLatencyMs);

  // Layer 3: Discourse
  const discourse = discourseTracker.track(text, linguistic, currentTopic, responseLatencyMs);

  // Pedagogical signals from linguistic features (basic)
  const pedagogicalSignals: PedagogicalSignal[] = [];

  if (linguistic.uncertaintyMarkers >= 2 && linguistic.wordCount > 5) {
    pedagogicalSignals.push({
      type: 'partial_understanding',
      detail: 'Student shows uncertainty despite attempting explanation',
      confidence: 0.6,
    });
  }

  if (linguistic.emphasisMarkers >= 1 && linguistic.wordCount <= 5 && !linguistic.questionCount) {
    pedagogicalSignals.push({
      type: 'rote_answer',
      detail: 'Short confident answer without reasoning — may be memorized',
      confidence: 0.5,
    });
  }

  if (linguistic.wordCount > 20 && linguistic.questionCount === 0 && linguistic.uncertaintyMarkers === 0) {
    pedagogicalSignals.push({
      type: 'deep_understanding',
      detail: 'Elaborate explanation without uncertainty markers',
      confidence: 0.6,
    });
  }

  if (text.toLowerCase().includes('like') && text.toLowerCase().includes('but') && linguistic.wordCount > 10) {
    pedagogicalSignals.push({
      type: 'transfer_attempt',
      detail: 'Student comparing/contrasting concepts — attempting transfer',
      confidence: 0.5,
    });
  }

  return {
    intent,
    intentConfidence: intentConf,
    entities: [], // populated by Layer 2 (LLM) when available
    emotion,
    emotionConfidence: emotionConf,
    pedagogicalSignals,
    discourse,
    linguistic,
  };
}
