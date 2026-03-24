/* ═══════════════════════════════════════════════════════════════
   ALFANUMRIK 2.0 — Cognitive Engine
   Pure-function library implementing 15 cognitive science principles:
   - SM-2 Spaced Repetition (SuperMemo algorithm)
   - Bloom's Taxonomy Progression
   - Zone of Proximal Development (ZPD) Calculator
   - Interleaving Algorithm (enhanced, always-on)
   - Cognitive Load Manager (fatigue detection, mid-session adjustment)
   - Metacognitive Reflection Prompt Generator (bilingual)
   - Learning Velocity Analytics
   - Knowledge Gap Detector
   - Enhanced Quiz Generator (3 modes)
   - IRT Student Ability Estimation (3PL Newton-Raphson MLE)
   - Bayesian Knowledge Tracing (BKT with adaptive parameters)
   - Error Classification (careless / conceptual / misinterpretation)
   - RL Reward Function (reinforcement learning for question selection)
   - Retention Decay Model (Ebbinghaus forgetting curve)
   - Lesson Flow Engine (6-step structured lesson with gating)
   - Predict-Before-Reveal (active recall prompts)
   ═══════════════════════════════════════════════════════════════ */

// ─── Types ───────────────────────────────────────────────────

export type BloomLevel = 'remember' | 'understand' | 'apply' | 'analyze' | 'evaluate' | 'create';

export const BLOOM_LEVELS: BloomLevel[] = ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'];

export const BLOOM_ORDER: Record<BloomLevel, number> = {
  remember: 0,
  understand: 1,
  apply: 2,
  analyze: 3,
  evaluate: 4,
  create: 5,
};

export const BLOOM_CONFIG: Record<BloomLevel, {
  label: string;
  labelHi: string;
  color: string;
  icon: string;
  description: string;
  descriptionHi: string;
}> = {
  remember: {
    label: 'Remember',
    labelHi: 'याद करो',
    color: '#9CA3AF',
    icon: '○',
    description: 'Recall facts and basic concepts',
    descriptionHi: 'तथ्य और बुनियादी अवधारणाएँ याद करो',
  },
  understand: {
    label: 'Understand',
    labelHi: 'समझो',
    color: '#3B82F6',
    icon: '◔',
    description: 'Explain ideas or concepts',
    descriptionHi: 'विचारों या अवधारणाओं को समझाओ',
  },
  apply: {
    label: 'Apply',
    labelHi: 'लागू करो',
    color: '#10B981',
    icon: '◑',
    description: 'Use information in new situations',
    descriptionHi: 'नई स्थितियों में जानकारी का उपयोग करो',
  },
  analyze: {
    label: 'Analyze',
    labelHi: 'विश्लेषण करो',
    color: '#F59E0B',
    icon: '◕',
    description: 'Draw connections among ideas',
    descriptionHi: 'विचारों के बीच संबंध खोजो',
  },
  evaluate: {
    label: 'Evaluate',
    labelHi: 'मूल्यांकन करो',
    color: '#EF4444',
    icon: '◉',
    description: 'Justify a stand or decision',
    descriptionHi: 'किसी निर्णय को सही ठहराओ',
  },
  create: {
    label: 'Create',
    labelHi: 'रचना करो',
    color: '#8B5CF6',
    icon: '●',
    description: 'Produce new or original work',
    descriptionHi: 'नया या मौलिक काम करो',
  },
};

export type QuizMode = 'cognitive' | 'board' | 'practice';

export interface SM2Card {
  easeFactor: number;    // >= 1.3
  interval: number;      // days
  repetitions: number;   // consecutive correct
}

export interface BloomMastery {
  bloomLevel: BloomLevel;
  mastery: number;       // 0-1
  attempts: number;
  correct: number;
}

export interface ZPDResult {
  targetDifficulty: number; // 0-1 scale
  targetBloomLevel: BloomLevel;
  confidenceBand: [number, number]; // [lower, upper] difficulty range
}

export interface CognitiveLoadState {
  consecutiveErrors: number;
  consecutiveCorrect: number;
  fatigueScore: number;      // 0-1, higher = more fatigued
  questionsAttempted: number;
  avgResponseTime: number;
  shouldEaseOff: boolean;
  shouldPushHarder: boolean;
  shouldPause: boolean;
}

export interface ReflectionPrompt {
  type: 'metacognitive' | 'praise' | 'pause' | 'transfer';
  message: string;
  messageHi: string;
}

export interface EnrichedQuestion {
  id: string;
  bloomLevel: BloomLevel;
  difficulty: number;
  source: string;
  boardYear?: number;
  topicId?: string;
  [key: string]: unknown;
}

export interface QuizGeneratorResult {
  questions: EnrichedQuestion[];
  metadata: {
    mode: QuizMode;
    bloomDistribution: Record<BloomLevel, number>;
    interleavingRatio: number;
    zpdTarget: number;
    difficultyRange: [number, number];
  };
}

// ─── SM-2 Spaced Repetition ──────────────────────────────────

/**
 * SuperMemo SM-2 algorithm implementation.
 * Returns updated card state after a review.
 * @param card Current card state
 * @param quality Rating 0-5 (0=complete blackout, 5=perfect)
 */
export function sm2Update(card: SM2Card, quality: number): SM2Card {
  const q = Math.min(5, Math.max(0, Math.round(quality)));

  let { easeFactor, interval, repetitions } = card;

  if (q >= 3) {
    // Correct response
    if (repetitions === 0) {
      interval = 1;
    } else if (repetitions === 1) {
      interval = 6;
    } else {
      interval = Math.round(interval * easeFactor);
    }
    repetitions += 1;
  } else {
    // Incorrect — reset
    repetitions = 0;
    interval = 1;
  }

  // Update ease factor: EF' = EF + (0.1 - (5-q) * (0.08 + (5-q) * 0.02))
  easeFactor = easeFactor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  easeFactor = Math.max(1.3, easeFactor);

  return { easeFactor, interval, repetitions };
}

/**
 * Convert a boolean correct/incorrect + time to SM-2 quality (0-5).
 */
export function responseToQuality(isCorrect: boolean, timeSpent: number, avgTime: number): number {
  if (!isCorrect) {
    return timeSpent > avgTime * 2 ? 0 : 1; // complete blackout vs. near miss
  }
  // Correct responses: rate by speed
  if (timeSpent < avgTime * 0.5) return 5;  // very fast
  if (timeSpent < avgTime) return 4;         // normal speed
  if (timeSpent < avgTime * 1.5) return 3;   // hesitant but correct
  return 3; // slow but correct
}

/**
 * Calculate next review date from SM-2 interval.
 */
export function nextReviewDate(interval: number): Date {
  const date = new Date();
  date.setDate(date.getDate() + interval);
  return date;
}

// ─── Bloom's Taxonomy Progression ────────────────────────────

/**
 * Determine the highest bloom level a student has mastered for a topic.
 */
export function getHighestMasteredBloom(bloomMasteries: BloomMastery[]): BloomLevel {
  let highest: BloomLevel = 'remember';
  for (const bm of bloomMasteries) {
    if (bm.mastery >= 0.7 && BLOOM_ORDER[bm.bloomLevel] > BLOOM_ORDER[highest]) {
      highest = bm.bloomLevel;
    }
  }
  return highest;
}

/**
 * Determine the next bloom level to target for a student on a topic.
 */
export function getNextBloomTarget(bloomMasteries: BloomMastery[]): BloomLevel {
  const highest = getHighestMasteredBloom(bloomMasteries);
  const nextIdx = Math.min(BLOOM_ORDER[highest] + 1, BLOOM_LEVELS.length - 1);
  return BLOOM_LEVELS[nextIdx];
}

/**
 * Update bloom mastery after a response.
 */
export function updateBloomMastery(
  current: BloomMastery,
  isCorrect: boolean,
  weight: number = 0.15
): BloomMastery {
  const newAttempts = current.attempts + 1;
  const newCorrect = current.correct + (isCorrect ? 1 : 0);
  // Exponential moving average for mastery
  const target = isCorrect ? 1 : 0;
  const newMastery = current.mastery + weight * (target - current.mastery);

  return {
    ...current,
    attempts: newAttempts,
    correct: newCorrect,
    mastery: Math.max(0, Math.min(1, newMastery)),
  };
}

// ─── Zone of Proximal Development (ZPD) ──────────────────────

/**
 * Calculate the ZPD target difficulty for a student.
 * ZPD = just above what the student can do comfortably.
 * @param currentMastery Overall mastery (0-1)
 * @param recentAccuracy Accuracy over last N questions (0-1)
 * @param bloomMasteries Bloom level masteries for the topic
 */
export function calculateZPD(
  currentMastery: number,
  recentAccuracy: number,
  bloomMasteries: BloomMastery[] = []
): ZPDResult {
  // Target difficulty: slightly above current performance
  // Sweet spot: 70-85% success rate (Vygotsky's ZPD)
  const baseTarget = currentMastery + 0.1; // push 10% above mastery
  const accuracyAdjustment = (recentAccuracy - 0.75) * 0.2; // adjust based on recent performance
  const targetDifficulty = Math.max(0.1, Math.min(0.95, baseTarget + accuracyAdjustment));

  // Confidence band: narrow for consistent students, wide for inconsistent
  const bandwidth = recentAccuracy > 0.5 ? 0.15 : 0.25;
  const confidenceBand: [number, number] = [
    Math.max(0, targetDifficulty - bandwidth),
    Math.min(1, targetDifficulty + bandwidth),
  ];

  // Target bloom level based on mastery
  const targetBloomLevel = bloomMasteries.length > 0
    ? getNextBloomTarget(bloomMasteries)
    : difficultyToBloom(targetDifficulty);

  return { targetDifficulty, targetBloomLevel, confidenceBand };
}

/**
 * Map a difficulty (0-1) to a bloom level.
 */
export function difficultyToBloom(difficulty: number): BloomLevel {
  if (difficulty < 0.17) return 'remember';
  if (difficulty < 0.33) return 'understand';
  if (difficulty < 0.50) return 'apply';
  if (difficulty < 0.67) return 'analyze';
  if (difficulty < 0.83) return 'evaluate';
  return 'create';
}

/**
 * Map a bloom level to a difficulty range.
 */
export function bloomToDifficultyRange(bloom: BloomLevel): [number, number] {
  const idx = BLOOM_ORDER[bloom];
  const step = 1 / 6;
  return [idx * step, (idx + 1) * step];
}

/**
 * Map difficulty (0-1) to question difficulty level (1-3).
 */
export function zpdToDifficultyLevel(zpd: number): number {
  if (zpd < 0.33) return 1;
  if (zpd < 0.67) return 2;
  return 3;
}

// ─── Interleaving Algorithm ──────────────────────────────────

export interface TopicWeight {
  topicId: string;
  mastery: number;
  isWeak: boolean;     // mastery < 0.6
  isStrong: boolean;   // mastery >= 0.8
  lastAttempted?: Date;
}

/**
 * Select topics for interleaved practice.
 * 70% weak topics, 30% strong topics (retrieval practice).
 * Never same topic back-to-back.
 */
export function interleaveTopics(
  topics: TopicWeight[],
  count: number
): string[] {
  const weak = topics.filter(t => t.isWeak).sort((a, b) => a.mastery - b.mastery);
  const strong = topics.filter(t => t.isStrong).sort(() => Math.random() - 0.5);
  const medium = topics.filter(t => !t.isWeak && !t.isStrong);

  const weakCount = Math.round(count * 0.7);
  const strongCount = Math.round(count * 0.3);

  const selected: string[] = [];

  // Fill weak slots
  const weakPool = [...weak, ...medium];
  for (let i = 0; i < weakCount && weakPool.length > 0; i++) {
    const idx = i % weakPool.length;
    selected.push(weakPool[idx].topicId);
  }

  // Fill strong slots (retrieval practice)
  for (let i = 0; i < strongCount && strong.length > 0; i++) {
    const idx = i % strong.length;
    selected.push(strong[idx].topicId);
  }

  // Shuffle to prevent back-to-back same topic
  return deduplicateAdjacent(shuffleArray(selected));
}

function shuffleArray<T>(arr: T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function deduplicateAdjacent(arr: string[]): string[] {
  if (arr.length <= 1) return arr;
  const result = [arr[0]];
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] !== result[result.length - 1]) {
      result.push(arr[i]);
    } else {
      // Find next different item and swap
      let swapped = false;
      for (let j = i + 1; j < arr.length; j++) {
        if (arr[j] !== result[result.length - 1]) {
          result.push(arr[j]);
          arr[j] = arr[i];
          swapped = true;
          break;
        }
      }
      if (!swapped) result.push(arr[i]); // no choice, allow adjacent
    }
  }
  return result;
}

// ─── Cognitive Load Manager ──────────────────────────────────

/**
 * Update cognitive load state after a response.
 * Detects fatigue, recommends difficulty adjustments.
 */
export function updateCognitiveLoad(
  state: CognitiveLoadState,
  isCorrect: boolean,
  timeSpent: number
): CognitiveLoadState {
  const newState = { ...state };
  newState.questionsAttempted += 1;

  if (isCorrect) {
    newState.consecutiveCorrect += 1;
    newState.consecutiveErrors = 0;
  } else {
    newState.consecutiveErrors += 1;
    newState.consecutiveCorrect = 0;
  }

  // Update average response time (running average)
  newState.avgResponseTime = state.avgResponseTime === 0
    ? timeSpent
    : state.avgResponseTime * 0.7 + timeSpent * 0.3;

  // Fatigue detection: increasing response times + decreasing accuracy
  const timeFatigue = timeSpent > state.avgResponseTime * 1.5 ? 0.1 : 0;
  const errorFatigue = !isCorrect ? 0.08 : -0.03;
  newState.fatigueScore = Math.max(0, Math.min(1,
    state.fatigueScore + timeFatigue + errorFatigue
  ));

  // Decision thresholds
  newState.shouldEaseOff = newState.consecutiveErrors >= 3 || newState.fatigueScore > 0.6;
  newState.shouldPushHarder = newState.consecutiveCorrect >= 3 && newState.fatigueScore < 0.3;
  newState.shouldPause = newState.consecutiveErrors >= 5 || newState.fatigueScore > 0.8;

  return newState;
}

/**
 * Create an initial cognitive load state.
 */
export function initialCognitiveLoad(): CognitiveLoadState {
  return {
    consecutiveErrors: 0,
    consecutiveCorrect: 0,
    fatigueScore: 0,
    questionsAttempted: 0,
    avgResponseTime: 0,
    shouldEaseOff: false,
    shouldPushHarder: false,
    shouldPause: false,
  };
}

/**
 * Calculate adjusted difficulty based on cognitive load.
 * Returns a multiplier for the target ZPD difficulty.
 */
export function adjustDifficulty(
  currentZPD: number,
  cognitiveLoad: CognitiveLoadState
): number {
  if (cognitiveLoad.shouldEaseOff) {
    return Math.max(0.1, currentZPD - 0.15); // drop difficulty
  }
  if (cognitiveLoad.shouldPushHarder) {
    return Math.min(0.95, currentZPD + 0.1); // increase difficulty
  }
  return currentZPD; // stay in ZPD
}

// ─── Metacognitive Reflection Prompts ────────────────────────

/**
 * Generate a reflection prompt based on the student's current state.
 */
export function getReflectionPrompt(
  isCorrect: boolean,
  consecutiveErrors: number,
  consecutiveCorrect: number,
  bloomLevel: BloomLevel
): ReflectionPrompt | null {
  // After wrong answer: metacognitive reflection
  if (!isCorrect && consecutiveErrors === 0) {
    return {
      type: 'metacognitive',
      message: 'Think about why you chose that answer. What concept tripped you up?',
      messageHi: 'सोचो कि तुमने वो जवाब क्यों चुना। कौन सी अवधारणा ने तुम्हें confuse किया?',
    };
  }

  // After 3 consecutive errors: pause and suggest
  if (consecutiveErrors >= 3) {
    return {
      type: 'pause',
      message: "Let's pause. Would re-reading the chapter or watching a quick video help?",
      messageHi: 'रुको। क्या chapter दोबारा पढ़ना या एक video देखना मदद करेगा?',
    };
  }

  // After getting a hard question right: praise + transfer
  if (isCorrect && consecutiveCorrect >= 2 && BLOOM_ORDER[bloomLevel] >= 3) {
    return {
      type: 'praise',
      message: 'Great work! Can you explain to yourself why this is correct?',
      messageHi: 'शाबाश! क्या तुम खुद को समझा सकते हो कि यह सही क्यों है?',
    };
  }

  // After first correct on a higher bloom level
  if (isCorrect && BLOOM_ORDER[bloomLevel] >= 4) {
    return {
      type: 'transfer',
      message: 'Excellent analysis! Can you connect this to what you learned earlier?',
      messageHi: 'बहुत बढ़िया विश्लेषण! क्या तुम इसे पहले सीखी हुई बात से जोड़ सकते हो?',
    };
  }

  return null;
}

// ─── Learning Velocity Analytics ─────────────────────────────

export interface VelocityDatapoint {
  date: string; // ISO date
  mastery: number;
}

/**
 * Calculate learning velocity using simple linear regression on mastery data.
 * Returns mastery points per day.
 */
export function calculateLearningVelocity(datapoints: VelocityDatapoint[]): number {
  if (datapoints.length < 2) return 0;

  const sorted = [...datapoints].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const firstDate = new Date(sorted[0].date).getTime();

  // Convert to days from first date
  const xs = sorted.map(d => (new Date(d.date).getTime() - firstDate) / (1000 * 60 * 60 * 24));
  const ys = sorted.map(d => d.mastery);

  // Simple linear regression
  const n = xs.length;
  const sumX = xs.reduce((a, b) => a + b, 0);
  const sumY = ys.reduce((a, b) => a + b, 0);
  const sumXY = xs.reduce((a, x, i) => a + x * ys[i], 0);
  const sumX2 = xs.reduce((a, x) => a + x * x, 0);

  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return 0;

  const slope = (n * sumXY - sumX * sumY) / denom;
  return Math.max(0, slope); // velocity can't be negative (we clamp)
}

/**
 * Predict date when student will reach target mastery.
 */
export function predictMasteryDate(
  currentMastery: number,
  velocity: number,
  targetMastery: number = 0.95
): Date | null {
  if (velocity <= 0) return null;
  if (currentMastery >= targetMastery) return new Date();

  const daysNeeded = (targetMastery - currentMastery) / velocity;
  if (daysNeeded > 365) return null; // more than a year, too uncertain

  const date = new Date();
  date.setDate(date.getDate() + Math.ceil(daysNeeded));
  return date;
}

/**
 * Estimate sessions needed to reach target mastery.
 * Assumes average 0.05 mastery gain per session.
 */
export function estimateSessionsToMastery(
  currentMastery: number,
  avgGainPerSession: number = 0.05,
  targetMastery: number = 0.95
): number {
  if (currentMastery >= targetMastery) return 0;
  if (avgGainPerSession <= 0) return -1;
  return Math.ceil((targetMastery - currentMastery) / avgGainPerSession);
}

// ─── Knowledge Gap Detector ──────────────────────────────────

export interface PrerequisiteChain {
  topicId: string;
  prerequisiteIds: string[];
}

export interface DetectedGap {
  topicId: string;
  prerequisiteTopicId?: string;
  gapType: 'weak_prerequisite' | 'missing_bloom_level' | 'stale_knowledge' | 'persistent_error';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  descriptionHi: string;
}

/**
 * Detect knowledge gaps based on mastery data and prerequisite chains.
 */
export function detectKnowledgeGaps(
  topicMasteries: Array<{ topicId: string; mastery: number; lastAttempted?: string }>,
  bloomProgressions: Array<{ topicId: string; bloomLevel: BloomLevel; mastery: number }>,
  prerequisites: PrerequisiteChain[] = []
): DetectedGap[] {
  const gaps: DetectedGap[] = [];
  const masteryMap = new Map(topicMasteries.map(t => [t.topicId, t]));

  // 1. Weak prerequisites: topic has high mastery but prerequisite is low
  for (const chain of prerequisites) {
    const topicMastery = masteryMap.get(chain.topicId);
    if (!topicMastery || topicMastery.mastery < 0.3) continue; // student hasn't started this topic

    for (const prereqId of chain.prerequisiteIds) {
      const prereq = masteryMap.get(prereqId);
      if (prereq && prereq.mastery < 0.5) {
        gaps.push({
          topicId: chain.topicId,
          prerequisiteTopicId: prereqId,
          gapType: 'weak_prerequisite',
          severity: prereq.mastery < 0.3 ? 'critical' : 'high',
          description: 'You need to strengthen the prerequisite topic first.',
          descriptionHi: 'पहले prerequisite topic को मजबूत करो।',
        });
      }
    }
  }

  // 2. Missing bloom levels: student can remember but can't apply
  const bloomByTopic = new Map<string, BloomMastery[]>();
  for (const bp of bloomProgressions) {
    if (!bloomByTopic.has(bp.topicId)) bloomByTopic.set(bp.topicId, []);
    bloomByTopic.get(bp.topicId)!.push({
      bloomLevel: bp.bloomLevel,
      mastery: bp.mastery,
      attempts: 0,
      correct: 0,
    });
  }

  for (const [topicId, blooms] of Array.from(bloomByTopic.entries())) {
    const sorted = blooms.sort((a, b) => BLOOM_ORDER[a.bloomLevel] - BLOOM_ORDER[b.bloomLevel]);
    for (let i = 1; i < sorted.length; i++) {
      // Check for gaps: lower level mastered but higher level weak
      if (sorted[i - 1].mastery > 0.7 && sorted[i].mastery < 0.3 && sorted[i].bloomLevel !== 'create') {
        gaps.push({
          topicId,
          gapType: 'missing_bloom_level',
          severity: 'medium',
          description: `You can ${sorted[i - 1].bloomLevel} this topic but struggle to ${sorted[i].bloomLevel}.`,
          descriptionHi: `तुम इस topic को ${sorted[i - 1].bloomLevel} कर सकते हो लेकिन ${sorted[i].bloomLevel} में कठिनाई है।`,
        });
        break; // one gap per topic
      }
    }
  }

  // 3. Stale knowledge: high mastery but not practiced in 30+ days
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  for (const topic of topicMasteries) {
    if (topic.mastery > 0.6 && topic.lastAttempted) {
      const lastDate = new Date(topic.lastAttempted);
      if (lastDate < thirtyDaysAgo) {
        gaps.push({
          topicId: topic.topicId,
          gapType: 'stale_knowledge',
          severity: 'low',
          description: "It's been a while since you practiced this topic. Time for a quick review!",
          descriptionHi: 'इस topic का अभ्यास किये काफी समय हो गया। एक quick review का समय है!',
        });
      }
    }
  }

  return gaps;
}

// ─── Enhanced Quiz Generator ─────────────────────────────────

export interface QuizGeneratorInput {
  mode: QuizMode;
  subject: string;
  grade: string;
  count: number;
  // For cognitive mode
  studentMastery?: number;
  recentAccuracy?: number;
  bloomMasteries?: BloomMastery[];
  topicWeights?: TopicWeight[];
  cognitiveLoad?: CognitiveLoadState;
  // For board mode
  boardYear?: number;
  // For practice mode
  difficulty?: number;
  topicId?: string;
}

/**
 * Generate quiz parameters based on mode.
 * Returns configuration for the server-side quiz fetcher.
 */
export function generateQuizParams(input: QuizGeneratorInput): {
  mode: QuizMode;
  difficulty: number;
  bloomTarget: BloomLevel;
  topicIds: string[];
  interleavingRatio: number;
  zpdTarget: number;
  boardYear?: number;
  source?: string;
} {
  switch (input.mode) {
    case 'cognitive': {
      // ZPD-based adaptive selection
      const zpd = calculateZPD(
        input.studentMastery ?? 0.5,
        input.recentAccuracy ?? 0.5,
        input.bloomMasteries
      );

      // Adjust for cognitive load
      const adjustedDifficulty = input.cognitiveLoad
        ? adjustDifficulty(zpd.targetDifficulty, input.cognitiveLoad)
        : zpd.targetDifficulty;

      // Interleave topics
      const topicIds = input.topicWeights
        ? interleaveTopics(input.topicWeights, input.count)
        : [];

      return {
        mode: 'cognitive',
        difficulty: zpdToDifficultyLevel(adjustedDifficulty),
        bloomTarget: zpd.targetBloomLevel,
        topicIds,
        interleavingRatio: topicIds.length > 0
          ? new Set(topicIds).size / topicIds.length
          : 0,
        zpdTarget: adjustedDifficulty,
      };
    }

    case 'board': {
      return {
        mode: 'board',
        difficulty: 0, // all difficulties
        bloomTarget: 'apply', // board exams focus on application
        topicIds: [],
        interleavingRatio: 1, // board papers are naturally interleaved
        zpdTarget: 0.6,
        boardYear: input.boardYear,
        source: 'cbse_board',
      };
    }

    case 'practice':
    default: {
      return {
        mode: 'practice',
        difficulty: input.difficulty ?? 0,
        bloomTarget: 'understand',
        topicIds: input.topicId ? [input.topicId] : [],
        interleavingRatio: 0,
        zpdTarget: 0.5,
      };
    }
  }
}

// ─── Board Exam Scoring ──────────────────────────────────────

export interface BoardExamScore {
  totalMarks: number;
  obtainedMarks: number;
  percentage: number;
  grade: string;
  message: string;
  messageHi: string;
}

/**
 * Calculate a projected board exam score based on quiz performance.
 * @param correct Number of correct answers
 * @param total Total questions
 * @param totalBoardMarks Total marks on the board paper (typically 80)
 */
export function calculateBoardExamScore(
  correct: number,
  total: number,
  totalBoardMarks: number = 80
): BoardExamScore {
  const percentage = total > 0 ? (correct / total) * 100 : 0;
  const obtainedMarks = Math.round((percentage / 100) * totalBoardMarks);

  let grade: string;
  let message: string;
  let messageHi: string;

  if (percentage >= 90) {
    grade = 'A1';
    message = `Outstanding! You would likely score ${obtainedMarks}/${totalBoardMarks} on the board exam!`;
    messageHi = `शानदार! बोर्ड परीक्षा में तुम्हारा स्कोर ${obtainedMarks}/${totalBoardMarks} हो सकता है!`;
  } else if (percentage >= 80) {
    grade = 'A2';
    message = `Excellent! Projected score: ${obtainedMarks}/${totalBoardMarks}. Almost there!`;
    messageHi = `बहुत बढ़िया! अनुमानित स्कोर: ${obtainedMarks}/${totalBoardMarks}। बस थोड़ा और!`;
  } else if (percentage >= 70) {
    grade = 'B1';
    message = `Good effort! Projected score: ${obtainedMarks}/${totalBoardMarks}. Keep practicing!`;
    messageHi = `अच्छा प्रयास! अनुमानित स्कोर: ${obtainedMarks}/${totalBoardMarks}। अभ्यास जारी रखो!`;
  } else if (percentage >= 60) {
    grade = 'B2';
    message = `Projected score: ${obtainedMarks}/${totalBoardMarks}. Focus on weak areas!`;
    messageHi = `अनुमानित स्कोर: ${obtainedMarks}/${totalBoardMarks}। कमज़ोर topics पर ध्यान दो!`;
  } else if (percentage >= 50) {
    grade = 'C1';
    message = `Projected score: ${obtainedMarks}/${totalBoardMarks}. More practice needed.`;
    messageHi = `अनुमानित स्कोर: ${obtainedMarks}/${totalBoardMarks}। और अभ्यास करो।`;
  } else {
    grade = 'D';
    message = `Projected score: ${obtainedMarks}/${totalBoardMarks}. Let Foxy help you review the basics!`;
    messageHi = `अनुमानित स्कोर: ${obtainedMarks}/${totalBoardMarks}। Foxy से basics सीखो!`;
  }

  return { totalMarks: totalBoardMarks, obtainedMarks, percentage, grade, message, messageHi };
}

// ─── IRT Student Ability Estimation ──────────────────────────

/**
 * Newton-Raphson MLE for 3PL IRT model.
 * Estimates student ability (theta) from response data.
 */
export function estimateTheta(responses: { isCorrect: boolean; difficulty: number; discrimination?: number; guessing?: number }[]): number {
  // Newton-Raphson MLE for 3PL IRT
  let theta = 0;
  for (let iter = 0; iter < 10; iter++) {
    let scoreSum = 0, infoSum = 0;
    for (const r of responses) {
      const a = r.discrimination ?? 1.0;
      const b = (r.difficulty - 2) * 1.5; // Map 1-5 to IRT scale
      const c = r.guessing ?? 0.25;
      const p = c + (1 - c) / (1 + Math.exp(-1.7 * a * (theta - b)));
      scoreSum += a * ((r.isCorrect ? 1 : 0) - p);
      infoSum += a * a * p * (1 - p);
    }
    if (infoSum > 0.001) theta = Math.max(-4, Math.min(4, theta + scoreSum / infoSum));
  }
  return theta;
}

/**
 * Probability of correct response under 3PL IRT model.
 */
export function irtProbCorrect(theta: number, difficulty: number, discrimination = 1.0, guessing = 0.25): number {
  const b = (difficulty - 2) * 1.5;
  return guessing + (1 - guessing) / (1 + Math.exp(-1.7 * discrimination * (theta - b)));
}

// ─── Enhanced BKT with Per-Concept Parameters ────────────────

export interface BKTParams {
  pKnow: number; pLearn: number; pGuess: number; pSlip: number;
}

/**
 * Bayesian Knowledge Tracing update with adaptive parameter adjustment.
 */
export function bktUpdate(params: BKTParams, isCorrect: boolean): { newPKnow: number; predicted: number; params: BKTParams } {
  const predicted = params.pKnow * (1 - params.pSlip) + (1 - params.pKnow) * params.pGuess;
  const posterior = isCorrect
    ? (params.pKnow * (1 - params.pSlip)) / Math.max(predicted, 0.001)
    : (params.pKnow * params.pSlip) / Math.max(1 - predicted, 0.001);
  const newPKnow = posterior + (1 - posterior) * params.pLearn;

  // Adapt parameters based on outcome
  const newParams = { ...params };
  if (isCorrect && params.pKnow > 0.7) newParams.pLearn = Math.min(0.4, params.pLearn + 0.01);
  if (!isCorrect && params.pKnow < 0.3) newParams.pLearn = Math.max(0.05, params.pLearn - 0.01);
  if (!isCorrect && params.pKnow > 0.8) newParams.pSlip = Math.min(0.3, params.pSlip + 0.02);
  if (isCorrect) newParams.pSlip = Math.max(0.02, params.pSlip - 0.005);

  return { newPKnow, predicted, params: newParams };
}

// ─── Error Classification ────────────────────────────────────

export type ErrorType = 'correct' | 'careless' | 'conceptual' | 'misinterpretation';

/**
 * Classify the type of error based on response characteristics.
 */
export function classifyError(
  isCorrect: boolean,
  responseTimeSec: number,
  avgResponseTimeSec: number,
  questionDifficulty: number,
  studentMastery: number
): ErrorType {
  if (isCorrect) return 'correct';
  if (responseTimeSec < avgResponseTimeSec * 0.3 || responseTimeSec < 3) return 'careless';
  if (studentMastery > 0.7 && questionDifficulty <= 2) return 'careless';
  if (responseTimeSec > avgResponseTimeSec * 2.5) return 'conceptual';
  if (questionDifficulty >= 3 && studentMastery < 0.4) return 'conceptual';
  return 'misinterpretation';
}

// ─── RL Reward Function ──────────────────────────────────────

/**
 * Calculate reinforcement learning reward for question selection.
 */
export function calculateReward(
  isCorrect: boolean,
  responseTimeSec: number,
  difficulty: number,
  engagementScore: number = 0.5
): number {
  const timeFactor = isCorrect && responseTimeSec >= 5 && responseTimeSec <= 30 ? 1.0
    : isCorrect && responseTimeSec < 5 ? 0.2 // too fast, guessing
    : responseTimeSec <= 60 ? 0.6 : 0.3;

  let reward = 0.35 * (isCorrect ? 1.0 : -0.3)
    + 0.25 * timeFactor
    + 0.20 * engagementScore
    + 0.20 * 0.5; // mastery placeholder

  if (isCorrect && difficulty >= 2) reward += 0.15; // ZPD bonus
  if (isCorrect && difficulty === 1 && responseTimeSec < 5) reward -= 0.1; // too easy penalty

  return Math.max(-1, Math.min(1, reward));
}

// ─── Retention Decay Model ───────────────────────────────────

/**
 * Ebbinghaus forgetting curve: R = e^(-t/S)
 * Predicts retention probability after a given number of days.
 */
export function predictRetention(daysSinceStudy: number, strength: number = 1.0): number {
  return Math.exp(-daysSinceStudy / Math.max(strength, 0.5));
}

/**
 * Determine if a topic should be retested based on predicted retention.
 */
export function shouldRetest(daysSinceStudy: number, strength: number, threshold = 0.5): boolean {
  return predictRetention(daysSinceStudy, strength) < threshold;
}

// ─── Lesson Flow Engine ──────────────────────────────────────

export const LESSON_STEPS = ['hook', 'visualization', 'guided_examples', 'active_recall', 'application', 'spaced_revision'] as const;
export type LessonStep = typeof LESSON_STEPS[number];

export interface LessonState {
  currentStep: LessonStep;
  stepsCompleted: LessonStep[];
  recallScore: number | null;
  applicationScore: number | null;
}

/**
 * Determine the next step in a lesson flow, with gating logic.
 */
export function getNextLessonStep(state: LessonState): LessonStep | 'complete' {
  const idx = LESSON_STEPS.indexOf(state.currentStep);
  // Must complete recall with >=60% before application
  if (state.currentStep === 'active_recall' && (state.recallScore ?? 0) < 0.6) return 'guided_examples';
  if (idx < LESSON_STEPS.length - 1) return LESSON_STEPS[idx + 1];
  return 'complete';
}

/**
 * Generate a bilingual prompt for a given lesson step.
 */
export function getLessonStepPrompt(step: LessonStep, topic: string, language: string): string {
  const isHi = language === 'hi';
  const prompts: Record<LessonStep, string> = {
    hook: isHi ? `"${topic}" का एक रोचक real-life example बताओ जो curiosity जगाए।` : `Give me an engaging real-life hook for "${topic}" that sparks curiosity.`,
    visualization: isHi ? `"${topic}" को एक diagram या visual analogy से समझाओ।` : `Explain "${topic}" using a visual diagram or analogy. Describe what I should picture.`,
    guided_examples: isHi ? `"${topic}" के 2 solved examples step-by-step दिखाओ।` : `Show me 2 worked examples for "${topic}" with step-by-step solutions.`,
    active_recall: isHi ? `"${topic}" पर 3 recall questions पूछो। मुझे पहले answer करने दो।` : `Ask me 3 recall questions on "${topic}". Let me answer before revealing the answer.`,
    application: isHi ? `"${topic}" पर 2 CBSE board-style application questions दो।` : `Give me 2 CBSE board-style application questions on "${topic}".`,
    spaced_revision: isHi ? `"${topic}" का quick revision summary दो - key points, formulas, common mistakes।` : `Give me a quick revision summary for "${topic}" - key points, formulas, and common mistakes.`,
  };
  return prompts[step];
}

// ─── Predict-Before-Reveal for Active Recall ─────────────────

export interface PredictionChallenge {
  question: string;
  studentPrediction: string | null;
  actualAnswer: string;
  wasCorrect: boolean | null;
}

/**
 * Generate a prediction prompt for active recall.
 */
export function generatePredictionPrompt(topic: string, language: string): string {
  return language === 'hi'
    ? `"${topic}" के बारे में एक prediction question पूछो। Student को पहले predict करने दो, फिर answer reveal करो।`
    : `Ask a prediction question about "${topic}". Let the student predict first, then reveal the answer with explanation.`;
}

// ─── Enhanced Interleaving ───────────────────────────────────

/**
 * Determine if interleaving should be applied.
 * Always interleave if student has attempted 2+ topics or session is long enough.
 */
export function shouldInterleave(sessionLength: number, topicCount: number): boolean {
  // Always interleave if student has attempted 2+ topics
  return topicCount >= 2 || sessionLength >= 5;
}
