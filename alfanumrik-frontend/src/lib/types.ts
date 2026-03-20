// ============================================================
// Alfanumrik v2 — TypeScript Types
// Maps exactly to the v2 Supabase schema
// ============================================================

export type Subject = 'math' | 'science' | 'english' | 'hindi' | 'social_science';
export type BloomLevel = 'remember' | 'understand' | 'apply' | 'analyze' | 'evaluate' | 'create';
export type MasteryLevel = 'not_started' | 'attempted' | 'familiar' | 'proficient' | 'mastered';
export type Language = 'en' | 'hi' | 'hinglish';
export type SessionMode = 'learn' | 'practice' | 'doubt' | 'quiz' | 'review';
export type Difficulty = 'gentle' | 'normal' | 'challenge';

// Student context stored in localStorage + synced to Supabase
export interface StudentContext {
  id: string;
  name: string;
  grade: number;
  board: string;
  language: Language;
  subject: Subject;
  difficulty: Difficulty;
  xpTotal: number;
  xpWeekly: number;
  streakDays: number;
  streakBest: number;
  isLoggedIn: boolean;
}

// Chat message
export interface ChatMessage {
  id: string;
  role: 'student' | 'foxy' | 'system';
  content: string;
  timestamp: number;
  questionId?: string;
  isCorrect?: boolean;
}

// Quiz state
export interface QuizState {
  questions: QuizQuestion[];
  currentIndex: number;
  responses: QuizResponse[];
  startedAt: number;
  isComplete: boolean;
}

export interface QuizQuestion {
  id: string;
  conceptId: string;
  questionTextEn: string;
  questionTextHi: string | null;
  options: Array<{ id: string; textEn: string; textHi: string; isCorrect: boolean }>;
  correctAnswer: string;
  explanationEn: string | null;
  explanationHi: string | null;
  hintEn: string | null;
  hintHi: string | null;
  bloomLevel: BloomLevel;
  difficulty: number;
}

export interface QuizResponse {
  questionId: string;
  conceptId: string;
  selectedAnswer: string;
  isCorrect: boolean;
  timeTakenSeconds: number;
}

// Subject display helpers
export const SUBJECT_CONFIG: Record<Subject, {
  nameEn: string;
  nameHi: string;
  icon: string;
  color: string;
}> = {
  math: { nameEn: 'Mathematics', nameHi: 'गणित', icon: '🧮', color: '#FF6B35' },
  science: { nameEn: 'Science', nameHi: 'विज्ञान', icon: '🔬', color: '#00B4D8' },
  english: { nameEn: 'English', nameHi: 'अंग्रेज़ी', icon: '📚', color: '#FFB800' },
  hindi: { nameEn: 'Hindi', nameHi: 'हिन्दी', icon: '📝', color: '#2DC653' },
  social_science: { nameEn: 'Social Science', nameHi: 'सामाजिक विज्ञान', icon: '🌍', color: '#9B4DAE' },
};

export const BLOOM_CONFIG: Record<BloomLevel, { label: string; color: string; order: number }> = {
  remember: { label: 'Remember', color: '#4CAF50', order: 1 },
  understand: { label: 'Understand', color: '#2196F3', order: 2 },
  apply: { label: 'Apply', color: '#FF9800', order: 3 },
  analyze: { label: 'Analyze', color: '#9C27B0', order: 4 },
  evaluate: { label: 'Evaluate', color: '#F44336', order: 5 },
  create: { label: 'Create', color: '#E91E63', order: 6 },
};

export const MASTERY_CONFIG: Record<MasteryLevel, { label: string; labelHi: string; color: string; order: number }> = {
  not_started: { label: 'Not Started', labelHi: 'शुरू नहीं', color: '#666', order: 0 },
  attempted: { label: 'Attempted', labelHi: 'प्रयास किया', color: '#FF9800', order: 1 },
  familiar: { label: 'Familiar', labelHi: 'परिचित', color: '#2196F3', order: 2 },
  proficient: { label: 'Proficient', labelHi: 'दक्ष', color: '#4CAF50', order: 3 },
  mastered: { label: 'Mastered', labelHi: 'महारत', color: '#FFD700', order: 4 },
};
