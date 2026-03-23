/* ─── Alfanumrik 2.0 Cognitive Engine ──────────────────────────────────
 *  Pure-function library implementing:
 *  - SM-2 Spaced Repetition (SuperMemo algorithm)
 *  - Bloom's Taxonomy Progression
 *  - Zone of Proximal Development (ZPD) Calculator
 *  - Interleaving Algorithm
 *  - Cognitive Load Manager (fatigue detection)
 *  - Metacognitive Reflection Prompt Generator (bilingual)
 *  - Learning Velocity Analytics
 *  - Knowledge Gap Detector
 *  - Enhanced Quiz Generator (3 modes)
 * ──────────────────────────────────────────────────────────────────── */

// ── Bloom's Taxonomy ──────────────────────────────────────────────────

export type BloomLevel = 'remember' | 'understand' | 'apply' | 'analyze' | 'evaluate' | 'create';

export const BLOOM_HIERARCHY: BloomLevel[] = [
  'remember', 'understand', 'apply', 'analyze', 'evaluate', 'create',
];

export const BLOOM_CONFIG: Record<BloomLevel, { label: string; labelHi: string; color: string; icon: string; order: number }> = {
  remember:   { label: 'Remember',   labelHi: 'याद करें',    color: '#9CA3AF', icon: '🧠', order: 0 },
  understand: { label: 'Understand', labelHi: 'समझें',       color: '#3B82F6', icon: '💡', order: 1 },
  apply:      { label: 'Apply',      labelHi: 'लागू करें',   color: '#10B981', icon: '🔧', order: 2 },
  analyze:    { label: 'Analyze',    labelHi: 'विश्लेषण',    color: '#F59E0B', icon: '🔬', order: 3 },
  evaluate:   { label: 'Evaluate',   labelHi: 'मूल्यांकन',   color: '#EF4444', icon: '⚖️', order: 4 },
  create:     { label: 'Create',     labelHi: 'रचना करें',   color: '#8B5CF6', icon: '🎨', order: 5 },
};

/** Get the next Bloom level for a student on a topic */
export function getNextBloomLevel(current: BloomLevel): BloomLevel | null {
  const idx = BLOOM_HIERARCHY.indexOf(current);
  return idx < BLOOM_HIERARCHY.length - 1 ? BLOOM_HIERARCHY[idx + 1] : null;
}

/** Check if student has mastered enough at current Bloom level to progress */
export function shouldProgressBloom(
  correctAtLevel: number,
  totalAtLevel: number,
  threshold = 0.75,
): boolean {
  if (totalAtLevel < 3) return false;
  return correctAtLevel / totalAtLevel >= threshold;
}

// ── SM-2 Spaced Repetition ────────────────────────────────────────────

export interface SM2State {
  easeFactor: number;   // min 1.3
  interval: number;     // days
  repetitions: number;
  nextReviewDate: string; // ISO date
}

export const SM2_DEFAULTS: SM2State = {
  easeFactor: 2.5,
  interval: 1,
  repetitions: 0,
  nextReviewDate: new Date().toISOString(),
};

/**
 * SM-2 algorithm: compute next review state based on quality (0-5).
 * quality: 0=total blackout, 3=correct with difficulty, 5=perfect
 */
export function sm2Update(state: SM2State, quality: number): SM2State {
  const q = Math.max(0, Math.min(5, Math.round(quality)));
  let { easeFactor, interval, repetitions } = state;

  if (q < 3) {
    // Failed — reset
    repetitions = 0;
    interval = 1;
  } else {
    // Passed
    if (repetitions === 0) {
      interval = 1;
    } else if (repetitions === 1) {
      interval = 6;
    } else {
      interval = Math.round(interval * easeFactor);
    }
    repetitions += 1;
  }

  // Update ease factor
  easeFactor = easeFactor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  easeFactor = Math.max(1.3, easeFactor);

  const next = new Date();
  next.setDate(next.getDate() + interval);

  return {
    easeFactor,
    interval,
    repetitions,
    nextReviewDate: next.toISOString(),
  };
}

/** Convert quiz accuracy (0-1) to SM-2 quality (0-5) */
export function accuracyToQuality(accuracy: number, timeSpentRatio = 1): number {
  // timeSpentRatio: actual/expected. >1 means slow (harder), <1 means fast (easier)
  const base = accuracy * 5;
  const timeAdjust = timeSpentRatio > 1.5 ? -0.5 : timeSpentRatio < 0.5 ? 0.5 : 0;
  return Math.max(0, Math.min(5, base + timeAdjust));
}

// ── Zone of Proximal Development (ZPD) ────────────────────────────────

export interface ZPDResult {
  targetDifficulty: number; // 1-10
  bloomTarget: BloomLevel;
  confidence: number;       // 0-1, how confident we are in the target
}

/**
 * Calculate the ZPD target for a student on a topic.
 * masteryLevel: 0-1 (current mastery)
 * recentAccuracy: 0-1 (last 5-10 questions)
 * currentBloom: their highest mastered Bloom level
 */
export function calculateZPD(
  masteryLevel: number,
  recentAccuracy: number,
  currentBloom: BloomLevel,
  streakCorrect: number,
  streakWrong: number,
): ZPDResult {
  // Base difficulty from mastery
  let targetDiff = Math.round(masteryLevel * 10) + 1;

  // Adjust based on recent performance
  if (recentAccuracy > 0.85 && streakCorrect >= 3) {
    targetDiff = Math.min(10, targetDiff + 2); // Push harder
  } else if (recentAccuracy > 0.7) {
    targetDiff = Math.min(10, targetDiff + 1); // Slight push
  } else if (recentAccuracy < 0.4 || streakWrong >= 3) {
    targetDiff = Math.max(1, targetDiff - 2); // Ease off
  } else if (recentAccuracy < 0.55) {
    targetDiff = Math.max(1, targetDiff - 1); // Slight ease
  }

  // Bloom target
  let bloomTarget = currentBloom;
  if (recentAccuracy > 0.8 && shouldProgressBloom(streakCorrect, streakCorrect + streakWrong)) {
    bloomTarget = getNextBloomLevel(currentBloom) || currentBloom;
  }

  // Confidence in our ZPD estimate (higher with more data)
  const totalAttempts = streakCorrect + streakWrong;
  const confidence = Math.min(1, totalAttempts / 20);

  return { targetDifficulty: targetDiff, bloomTarget, confidence };
}

// ── Interleaving Algorithm ────────────────────────────────────────────

export interface TopicWeight {
  topicId: string;
  mastery: number;    // 0-1
  lastAttempted: Date;
  isWeak: boolean;
}

/**
 * Select topics for an interleaved session.
 * Returns topicIds in recommended order.
 * 70% weak topics, 30% strong topics (retrieval practice).
 * Never same topic back-to-back.
 */
export function interleaveTopics(
  topics: TopicWeight[],
  sessionSize: number,
): string[] {
  const weak = topics.filter(t => t.isWeak).sort((a, b) => a.mastery - b.mastery);
  const strong = topics.filter(t => !t.isWeak).sort(
    (a, b) => a.lastAttempted.getTime() - b.lastAttempted.getTime(), // least recent first
  );

  const weakCount = Math.ceil(sessionSize * 0.7);
  const strongCount = sessionSize - weakCount;

  const selectedWeak = weak.slice(0, weakCount).map(t => t.topicId);
  const selectedStrong = strong.slice(0, strongCount).map(t => t.topicId);

  // Interleave: never same topic back-to-back
  const result: string[] = [];
  let wi = 0, si = 0;
  let lastTopic = '';

  for (let i = 0; i < sessionSize; i++) {
    // Alternate weak/strong with ratio ~70/30
    const preferWeak = i % 3 !== 2; // positions 0,1 = weak; position 2 = strong
    let picked: string | undefined;

    if (preferWeak && wi < selectedWeak.length) {
      picked = selectedWeak[wi++];
    } else if (si < selectedStrong.length) {
      picked = selectedStrong[si++];
    } else if (wi < selectedWeak.length) {
      picked = selectedWeak[wi++];
    }

    if (!picked) break;

    // Avoid back-to-back same topic
    if (picked === lastTopic && result.length > 0) {
      // Try swapping with next available
      const alt = wi < selectedWeak.length ? selectedWeak[wi] : si < selectedStrong.length ? selectedStrong[si] : null;
      if (alt && alt !== lastTopic) {
        result.push(alt);
        if (wi < selectedWeak.length && selectedWeak[wi] === alt) wi++;
        else if (si < selectedStrong.length && selectedStrong[si] === alt) si++;
        // Put the skipped one back for next iteration
        result.push(picked);
        lastTopic = picked;
        i++; // used two slots
        continue;
      }
    }

    result.push(picked);
    lastTopic = picked;
  }

  return result.slice(0, sessionSize);
}

// ── Cognitive Load Manager ────────────────────────────────────────────

export interface SessionMetrics {
  questionsAnswered: number;
  correctStreak: number;
  wrongStreak: number;
  avgTimePerQuestion: number;   // seconds
  sessionDurationMinutes: number;
  recentAccuracy: number;       // last 5 questions
}

export type CognitiveAction =
  | { type: 'continue' }
  | { type: 'ease_difficulty' }
  | { type: 'increase_difficulty' }
  | { type: 'suggest_break' }
  | { type: 'show_reflection'; prompt: string; promptHi: string }
  | { type: 'offer_help'; topic: string };

/**
 * Mid-session cognitive load adjustment.
 * Returns recommended action based on session metrics.
 */
export function assessCognitiveLoad(metrics: SessionMetrics): CognitiveAction {
  const { questionsAnswered, correctStreak, wrongStreak, avgTimePerQuestion, sessionDurationMinutes, recentAccuracy } = metrics;

  // Fatigue detection: long session + declining accuracy
  if (sessionDurationMinutes > 30 && recentAccuracy < 0.4) {
    return { type: 'suggest_break' };
  }

  // Frustration detection: 3+ wrong in a row
  if (wrongStreak >= 3) {
    return {
      type: 'show_reflection',
      prompt: "Let's pause. Would reviewing the chapter help before continuing?",
      promptHi: 'रुकिए। क्या आगे बढ़ने से पहले चैप्टर दोबारा पढ़ना सही रहेगा?',
    };
  }

  // Slow answering = cognitive overload
  if (avgTimePerQuestion > 120 && questionsAnswered > 3) {
    return { type: 'ease_difficulty' };
  }

  // Crushing it: push harder
  if (correctStreak >= 3 && recentAccuracy > 0.9) {
    return { type: 'increase_difficulty' };
  }

  // Boredom: fast + high accuracy
  if (avgTimePerQuestion < 15 && recentAccuracy > 0.95 && questionsAnswered > 5) {
    return { type: 'increase_difficulty' };
  }

  return { type: 'continue' };
}

// ── Metacognitive Reflection Prompts ──────────────────────────────────

export interface ReflectionPrompt {
  en: string;
  hi: string;
  trigger: 'wrong_answer' | 'streak_wrong' | 'hard_correct' | 'bloom_up' | 'session_end';
}

const REFLECTION_BANK: ReflectionPrompt[] = [
  // Wrong answer
  { trigger: 'wrong_answer', en: 'Think about why you chose that. What concept tripped you up?', hi: 'सोचिए आपने यह विकल्प क्यों चुना। कौन सा concept आपको उलझा रहा है?' },
  { trigger: 'wrong_answer', en: 'What would you do differently if you saw this question again?', hi: 'अगर यह प्रश्न दोबारा आए तो आप क्या अलग करेंगे?' },
  { trigger: 'wrong_answer', en: 'Can you identify which step went wrong in your thinking?', hi: 'क्या आप बता सकते हैं कि आपकी सोच में कौन सा कदम गलत हुआ?' },

  // Streak wrong (3+)
  { trigger: 'streak_wrong', en: "Let's pause. Would re-reading the chapter help?", hi: 'रुकिए। क्या चैप्टर दोबारा पढ़ना मददगार होगा?' },
  { trigger: 'streak_wrong', en: "This topic seems tricky. Want me to explain the basics first?", hi: 'यह topic कठिन लग रहा है। क्या मैं पहले basics समझाऊं?' },

  // Hard question correct
  { trigger: 'hard_correct', en: 'Great work! Can you explain to yourself why this is correct?', hi: 'शाबाश! क्या आप खुद को समझा सकते हैं कि यह सही क्यों है?' },
  { trigger: 'hard_correct', en: 'You nailed it! What strategy helped you solve this?', hi: 'बहुत अच्छा! किस strategy ने आपकी मदद की?' },

  // Bloom level up
  { trigger: 'bloom_up', en: "You've moved up from {prev} to {next}! You're thinking at a higher level now.", hi: 'आप {prev} से {next} तक पहुंच गए! अब आप उच्च स्तर पर सोच रहे हैं।' },

  // Session end
  { trigger: 'session_end', en: 'What was the hardest concept today? Review it tomorrow for better retention.', hi: 'आज सबसे कठिन concept क्या था? कल इसे दोहराएं ताकि याद रहे।' },
  { trigger: 'session_end', en: 'You practiced {count} questions. Which topic needs more work?', hi: 'आपने {count} प्रश्न हल किए। किस topic पर और काम करना चाहिए?' },
];

/** Get a reflection prompt for a given trigger */
export function getReflectionPrompt(
  trigger: ReflectionPrompt['trigger'],
  vars?: Record<string, string>,
): ReflectionPrompt {
  const matching = REFLECTION_BANK.filter(r => r.trigger === trigger);
  const prompt = matching[Math.floor(Math.random() * matching.length)] || matching[0];

  if (!vars) return prompt;

  let en = prompt.en;
  let hi = prompt.hi;
  for (const [key, val] of Object.entries(vars)) {
    en = en.replace(`{${key}}`, val);
    hi = hi.replace(`{${key}}`, val);
  }
  return { ...prompt, en, hi };
}

// ── Learning Velocity ─────────────────────────────────────────────────

export interface MasteryDataPoint {
  date: string;  // ISO date
  mastery: number; // 0-1
}

/**
 * Simple linear regression on mastery data points.
 * Returns slope (mastery units per day) and predicted days to target.
 */
export function calculateLearningVelocity(
  dataPoints: MasteryDataPoint[],
  targetMastery = 0.8,
): { velocity: number; predictedDaysToTarget: number | null } {
  if (dataPoints.length < 2) return { velocity: 0, predictedDaysToTarget: null };

  const origin = new Date(dataPoints[0].date).getTime();
  const xs = dataPoints.map(d => (new Date(d.date).getTime() - origin) / (1000 * 60 * 60 * 24)); // days
  const ys = dataPoints.map(d => d.mastery);

  const n = xs.length;
  const sumX = xs.reduce((a, b) => a + b, 0);
  const sumY = ys.reduce((a, b) => a + b, 0);
  const sumXY = xs.reduce((acc, x, i) => acc + x * ys[i], 0);
  const sumX2 = xs.reduce((acc, x) => acc + x * x, 0);

  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return { velocity: 0, predictedDaysToTarget: null };

  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;

  const currentMastery = ys[ys.length - 1];
  const currentDay = xs[xs.length - 1];

  let predictedDays: number | null = null;
  if (slope > 0 && currentMastery < targetMastery) {
    predictedDays = Math.ceil((targetMastery - intercept - slope * currentDay) / slope);
    if (predictedDays < 0) predictedDays = null;
  } else if (currentMastery >= targetMastery) {
    predictedDays = 0;
  }

  return { velocity: slope, predictedDaysToTarget: predictedDays };
}

// ── Knowledge Gap Detector ────────────────────────────────────────────

export interface PrerequisiteChain {
  topicId: string;
  prerequisites: string[];  // topicIds that must be mastered first
}

export interface KnowledgeGap {
  topicId: string;
  missingPrerequisites: string[];
  severity: 'critical' | 'moderate' | 'minor';
}

/**
 * Detect knowledge gaps by checking prerequisite mastery.
 * Returns topics where prerequisites are not sufficiently mastered.
 */
export function detectKnowledgeGaps(
  chains: PrerequisiteChain[],
  masteryMap: Map<string, number>,  // topicId -> mastery (0-1)
  minPrereqMastery = 0.6,
): KnowledgeGap[] {
  const gaps: KnowledgeGap[] = [];

  for (const chain of chains) {
    const topicMastery = masteryMap.get(chain.topicId) ?? 0;
    if (topicMastery > 0.3) {
      // Student has attempted this topic — check if prereqs are solid
      const missing = chain.prerequisites.filter(
        prereq => (masteryMap.get(prereq) ?? 0) < minPrereqMastery,
      );

      if (missing.length > 0) {
        const avgMissing = missing.reduce((s, p) => s + (masteryMap.get(p) ?? 0), 0) / missing.length;
        const severity: KnowledgeGap['severity'] =
          avgMissing < 0.2 ? 'critical' : avgMissing < 0.4 ? 'moderate' : 'minor';

        gaps.push({ topicId: chain.topicId, missingPrerequisites: missing, severity });
      }
    }
  }

  return gaps.sort((a, b) => {
    const order = { critical: 0, moderate: 1, minor: 2 };
    return order[a.severity] - order[b.severity];
  });
}

// ── Enhanced Quiz Generator ───────────────────────────────────────────

export type QuizMode = 'cognitive' | 'board' | 'practice';

export interface QuizGeneratorInput {
  mode: QuizMode;
  studentId: string;
  subject: string;
  // Cognitive mode
  topicWeights?: TopicWeight[];
  currentBloom?: BloomLevel;
  masteryLevel?: number;
  recentAccuracy?: number;
  // Board mode
  boardYear?: number;       // 2015-2024
  boardSet?: string;        // set code
  paperSection?: string;    // section filter
  // Common
  questionCount?: number;
}

export interface QuizGeneratorOutput {
  mode: QuizMode;
  topicIds: string[];
  targetDifficulty: number;
  bloomTarget: BloomLevel;
  bloomDistribution: Record<BloomLevel, number>;  // percentage
  interleavingRatio: number;  // 0-1 (0 = no interleaving, 1 = maximum)
  filters: {
    source?: 'cbse_board' | 'curated' | 'generated';
    boardYear?: number;
    boardSet?: string;
    maxDifficulty?: number;
    minDifficulty?: number;
  };
}

/**
 * Generate quiz parameters based on mode and student state.
 * Returns configuration for the quiz question fetcher.
 */
export function generateQuizParams(input: QuizGeneratorInput): QuizGeneratorOutput {
  const count = input.questionCount || 10;

  if (input.mode === 'board') {
    // Board Exam Practice: filter by source + year, standard difficulty
    return {
      mode: 'board',
      topicIds: [],
      targetDifficulty: 5,
      bloomTarget: 'apply',
      bloomDistribution: { remember: 15, understand: 20, apply: 30, analyze: 20, evaluate: 10, create: 5 },
      interleavingRatio: 0.3,
      filters: {
        source: 'cbse_board',
        boardYear: input.boardYear,
        boardSet: input.boardSet,
      },
    };
  }

  if (input.mode === 'practice') {
    // Standard practice: no ZPD, no interleaving, balanced difficulty
    return {
      mode: 'practice',
      topicIds: [],
      targetDifficulty: input.masteryLevel ? Math.round(input.masteryLevel * 10) : 5,
      bloomTarget: input.currentBloom || 'apply',
      bloomDistribution: { remember: 20, understand: 25, apply: 25, analyze: 15, evaluate: 10, create: 5 },
      interleavingRatio: 0,
      filters: {},
    };
  }

  // Cognitive mode (default): ZPD + Bloom's + interleaving
  const zpd = calculateZPD(
    input.masteryLevel || 0.5,
    input.recentAccuracy || 0.6,
    input.currentBloom || 'understand',
    0,
    0,
  );

  const topicIds = input.topicWeights
    ? interleaveTopics(input.topicWeights, count)
    : [];

  // Bloom distribution shifts based on target
  const bloomIdx = BLOOM_HIERARCHY.indexOf(zpd.bloomTarget);
  const dist: Record<BloomLevel, number> = {
    remember: 5, understand: 10, apply: 20, analyze: 25, evaluate: 25, create: 15,
  };
  // Boost target level and neighbors
  if (bloomIdx >= 0) {
    for (let i = 0; i < BLOOM_HIERARCHY.length; i++) {
      const distance = Math.abs(i - bloomIdx);
      dist[BLOOM_HIERARCHY[i]] = distance === 0 ? 35 : distance === 1 ? 25 : 10;
    }
  }

  return {
    mode: 'cognitive',
    topicIds,
    targetDifficulty: zpd.targetDifficulty,
    bloomTarget: zpd.bloomTarget,
    bloomDistribution: dist,
    interleavingRatio: 0.7,
    filters: {
      minDifficulty: Math.max(1, zpd.targetDifficulty - 2),
      maxDifficulty: Math.min(10, zpd.targetDifficulty + 2),
    },
  };
}
