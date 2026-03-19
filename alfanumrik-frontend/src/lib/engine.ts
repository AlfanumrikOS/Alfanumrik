// Alfanumrik Adaptive Learning Engine
// BKT + SM-2 Spaced Repetition + IRT Diagnostics + Interleaving
// Evidence: Mindspark 0.37 SD, Khan Academy 0.47 SD, SM-2 d≈0.54, Interleaving d=0.83-1.05

import type { BloomLevel, Question } from './types';

// === Bayesian Knowledge Tracing ===
interface BKTParams { pInit: number; pLearn: number; pGuess: number; pSlip: number }
const DEFAULT_BKT: BKTParams = { pInit: 0.1, pLearn: 0.15, pGuess: 0.2, pSlip: 0.1 };

export function updateBKT(currentP: number, isCorrect: boolean, params = DEFAULT_BKT): number {
  const { pLearn, pGuess, pSlip } = params;
  const pCorrectMastered = isCorrect ? 1 - pSlip : pSlip;
  const pCorrectNotMastered = isCorrect ? pGuess : 1 - pGuess;
  const posterior = (currentP * pCorrectMastered) / (currentP * pCorrectMastered + (1 - currentP) * pCorrectNotMastered);
  return Math.min(Math.max(posterior + (1 - posterior) * pLearn, 0), 1);
}

// === Mastery Level ===
export function getMasteryLevel(pMastery: number, correctStreak: number, attempts: number) {
  if (attempts === 0) return 'not_started' as const;
  if (pMastery >= 0.95 && correctStreak >= 5) return 'mastered' as const;
  if (pMastery >= 0.85 && correctStreak >= 3) return 'proficient' as const;
  if (pMastery >= 0.60) return 'familiar' as const;
  return 'attempted' as const;
}

// === Spaced Repetition (SM-2) ===
export function calculateNextReview(easeFactor: number, repetitions: number, isCorrect: boolean, quality: number) {
  if (!isCorrect || quality < 3) {
    return { nextInterval: 1, newEaseFactor: Math.max(1.3, easeFactor - 0.2), newRepetitions: 0 };
  }
  const newEF = Math.max(1.3, easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)));
  const newReps = repetitions + 1;
  const interval = newReps === 1 ? 1 : newReps === 2 ? 3 : Math.round((repetitions || 1) * newEF);
  return { nextInterval: interval, newEaseFactor: newEF, newRepetitions: newReps };
}

// === Interleaving ===
export function interleaveQuestions(current: Question[], previous: Question[], ratio = 0.3): Question[] {
  const interleavedCount = Math.ceil(current.length * ratio);
  const shuffledPrev = [...previous].sort(() => Math.random() - 0.5).slice(0, interleavedCount);
  const combined = [...current, ...shuffledPrev];
  for (let i = combined.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [combined[i], combined[j]] = [combined[j], combined[i]];
  }
  return combined;
}

// === Bloom's Taxonomy ===
const BLOOM_ORDER: BloomLevel[] = ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'];

export function getBloomLevelNumber(level: BloomLevel): number { return BLOOM_ORDER.indexOf(level) + 1; }
export function getBloomLabel(level: BloomLevel): string {
  return { remember: 'Remember', understand: 'Understand', apply: 'Apply', analyze: 'Analyze', evaluate: 'Evaluate', create: 'Create' }[level];
}
export function getBloomLabelHi(level: BloomLevel): string {
  return { remember: 'याद करो', understand: 'समझो', apply: 'लागू करो', analyze: 'विश्लेषण', evaluate: 'मूल्यांकन', create: 'रचना करो' }[level];
}
export function getBloomColor(level: BloomLevel): string {
  return { remember: '#2DC653', understand: '#00B4D8', apply: '#FFB800', analyze: '#FF6B35', evaluate: '#9B4DAE', create: '#FF4757' }[level];
}

// === XP System ===
export function calculateXP(isCorrect: boolean, bloomLevel: BloomLevel, streak: number, timeTakenMs: number, hintsUsed: number, difficulty: number): number {
  if (!isCorrect) return 2;
  const base = 10;
  const bloomMul = 1 + getBloomLevelNumber(bloomLevel) * 0.15;
  const diffBonus = Math.round(difficulty * 10);
  const streakBonus = Math.min(streak * 2, 20);
  const speedBonus = timeTakenMs < 10000 ? 5 : timeTakenMs < 20000 ? 3 : 0;
  return Math.max(5, Math.round(base * bloomMul + diffBonus + streakBonus + speedBonus - hintsUsed * 3));
}

export function getLevelFromXP(xp: number): number { return Math.floor(Math.sqrt(xp / 50)) + 1; }
export function getXPForLevel(level: number): number { return (level - 1) * (level - 1) * 50; }
export function getXPProgress(xp: number) {
  const level = getLevelFromXP(xp);
  const currentLevelXP = getXPForLevel(level);
  const nextLevelXP = getXPForLevel(level + 1);
  const current = xp - currentLevelXP;
  const required = nextLevelXP - currentLevelXP;
  return { level, current, required, percentage: Math.min(100, (current / required) * 100) };
}

// === IRT Adaptive Item Selection ===
export function selectNextItem(theta: number, items: { id: string; difficulty: number; discrimination: number }[], answeredIds: Set<string>) {
  const available = items.filter(i => !answeredIds.has(i.id));
  if (!available.length) return null;
  let maxInfo = -Infinity, best = available[0];
  for (const item of available) {
    const p = 1 / (1 + Math.exp(-item.discrimination * (theta - item.difficulty)));
    const info = item.discrimination ** 2 * p * (1 - p);
    if (info > maxInfo) { maxInfo = info; best = item; }
  }
  return best;
}

export function updateTheta(theta: number, isCorrect: boolean, difficulty: number, discrimination: number): number {
  const p = 1 / (1 + Math.exp(-discrimination * (theta - difficulty)));
  return theta + 0.3 * (isCorrect ? 1 - p : -p);
}
