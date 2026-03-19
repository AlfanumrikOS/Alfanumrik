export type Subject = 'math' | 'science' | 'english' | 'hindi' | 'social_science';
export type MasteryLevel = 'not_started' | 'attempted' | 'familiar' | 'proficient' | 'mastered';
export type BloomLevel = 'remember' | 'understand' | 'apply' | 'analyze' | 'evaluate' | 'create';
export type SessionMode = 'learn' | 'practice' | 'quiz' | 'review';
export type QuestionType = 'mcq' | 'fill_blank' | 'true_false' | 'short_answer' | 'simulation';

export interface Student {
  id: string;
  name: string;
  grade: number;
  board: 'CBSE' | 'ICSE' | 'STATE';
  language: 'en' | 'hi' | 'hinglish';
  xp: number;
  level: number;
  streak: number;
  longestStreak: number;
  lastActiveAt: string;
}

export interface ConceptNode {
  id: string;
  subject: Subject;
  grade: number;
  chapter: string;
  topic: string;
  title: string;
  titleHi?: string;
  bloomLevel: BloomLevel;
  cbseCompetency?: string;
  prerequisites: string[];
  difficulty: number;
  discrimination: number;
}

export interface Question {
  id: string;
  conceptId: string;
  type: QuestionType;
  bloomLevel: BloomLevel;
  difficulty: number;
  questionText: string;
  questionTextHi?: string;
  options?: { id: string; text: string; textHi?: string; isCorrect: boolean }[];
  correctAnswer: string;
  explanation: string;
  explanationHi?: string;
  hint?: string;
  hintHi?: string;
  misconceptionTag?: string;
  simulationId?: string;
}

export interface StudentMastery {
  studentId: string;
  conceptId: string;
  mastery: MasteryLevel;
  pMastery: number;
  attempts: number;
  correctStreak: number;
  lastAttemptAt: string;
  nextReviewAt: string;
}

export interface Badge {
  id: string;
  name: string;
  nameHi?: string;
  description: string;
  descriptionHi?: string;
  icon: string;
  category: 'streak' | 'mastery' | 'speed' | 'exploration';
  xpReward: number;
}

export interface Simulation {
  id: string;
  title: string;
  titleHi?: string;
  subject: Subject;
  conceptIds: string[];
  type: 'physics' | 'chemistry' | 'biology' | 'math';
  description: string;
  controls: { id: string; label: string; type: 'slider' | 'toggle' | 'select'; min?: number; max?: number; step?: number; options?: string[]; defaultValue: number | string | boolean }[];
}

export interface FoxyMessage {
  id: string;
  role: 'user' | 'foxy';
  content: string;
  timestamp: string;
  isTyping?: boolean;
}
