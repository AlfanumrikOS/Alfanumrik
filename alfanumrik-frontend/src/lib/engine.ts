// Alfanumrik Adaptive Learning Engine
// BKT + SM-2 Spaced Repetition + IRT Diagnostics + Interleaving
// Evidence: Mindspark 0.37 SD, Khan Academy 0.47 SD, SM-2 d≈0.54, Interleaving d=0.83-1.05

import type { BloomLevel } from './types';

// === Bayesian Knowledge Tracing (client-side mirror of Supabase RPC) ===
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
