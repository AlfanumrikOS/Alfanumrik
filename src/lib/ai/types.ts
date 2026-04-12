/**
 * Shared types for the Alfanumrik AI layer.
 *
 * Used by: clients, prompts, retrieval, validation, workflows, tools, tracing.
 * No runtime dependencies — pure type definitions.
 */

// ─── Foxy Intent Classification ─────────────────────────────────────────────

export type FoxyIntent =
  | 'explain'      // Concept explanation
  | 'doubt'        // Specific doubt resolution
  | 'quiz'         // Generate quiz questions
  | 'revision'     // Revision/summary
  | 'homework'     // Homework help (Socratic only)
  | 'greeting'     // Student greeting/smalltalk
  | 'off_topic'    // Off-topic / inappropriate
  | 'unknown';     // Could not classify

export interface IntentClassification {
  intent: FoxyIntent;
  confidence: number;  // 0-1
  reasoning: string;
  extractedTopic?: string;
  extractedConcept?: string;
}

// ─── Chat Messages ──────────────────────────────────────────────────────────

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

// ─── Claude API ─────────────────────────────────────────────────────────────

export interface ClaudeRequestOptions {
  model?: string;
  systemPrompt: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}

export interface ClaudeResponse {
  content: string;
  model: string;
  tokensUsed: number;
  inputTokens: number;
  outputTokens: number;
  stopReason: string | null;
  latencyMs: number;
}

// ─── RAG / Retrieval ────────────────────────────────────────────────────────

export interface RetrievalQuery {
  query: string;
  subject: string;
  grade: string;       // P5: string "6"-"12"
  chapter?: string | null;
  board?: string;
  matchCount?: number;
  minQuality?: number;
}

export interface RetrievedChunk {
  id: string;
  content: string;
  subject: string;
  chapter?: string;
  pageNumber?: number;
  similarity: number;
  contentType?: string;
  mediaUrl?: string | null;
  mediaDescription?: string | null;
}

/** Diagram metadata surfaced alongside tutor responses */
export interface DiagramReference {
  url: string;
  title: string;
  pageNumber?: number;
  description: string;
}

export interface RetrievalResult {
  chunks: RetrievedChunk[];
  contextText: string;   // LLM-formatted string for injection into prompts
  error: string | null;
}

// ─── Workflow Results ───────────────────────────────────────────────────────

export interface WorkflowResult {
  response: string;
  intent: FoxyIntent;
  sources: RetrievedChunk[];
  tokensUsed: number;
  model: string;
  latencyMs: number;
  traceId: string;
  metadata: Record<string, unknown>;
}

// ─── Quiz Question (for AI-generated quizzes) ───────────────────────────────

export interface QuizQuestion {
  text: string;
  options: [string, string, string, string]; // exactly 4
  correctAnswerIndex: 0 | 1 | 2 | 3;
  explanation: string;
  difficulty: 'easy' | 'medium' | 'hard';
  bloomLevel: string;
  topic?: string;
  concept?: string;
}

export interface QuizGenerationResult {
  questions: QuizQuestion[];
  validationErrors: string[];
  metadata: {
    model: string;
    tokensUsed: number;
    latencyMs: number;
    questionsRequested: number;
    questionsValid: number;
  };
}

// ─── Validation ─────────────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  sanitizedContent?: string;
}

// ─── Student Context (for DB adapters) ──────────────────────────────────────

export interface StudentContext {
  studentId: string;
  grade: string;
  board: string;
  subscriptionPlan: string;
  academicGoal: string | null;
  accountStatus: string;
}

export interface SessionContext {
  sessionId: string;
  subject: string;
  grade: string;
  chapter: string | null;
  mode: string;
  history: ChatMessage[];
}

// ─── Tracing ────────────────────────────────────────────────────────────────

export type TraceStepType =
  | 'intent_classification'
  | 'retrieval'
  | 'prompt_build'
  | 'llm_call'
  | 'output_validation'
  | 'persist';

export interface TraceStep {
  type: TraceStepType;
  startMs: number;
  durationMs: number;
  metadata: Record<string, unknown>;
  error?: string;
}

export interface WorkflowTrace {
  traceId: string;
  workflow: string;
  startedAt: string;
  totalDurationMs: number;
  steps: TraceStep[];
  studentId?: string;
  sessionId?: string;
  intent?: FoxyIntent;
  model?: string;
  tokensUsed?: number;
  error?: string;
}

// ─── Config ─────────────────────────────────────────────────────────────────

export interface ModelConfig {
  name: string;
  maxTokens: number;
  temperature: number;
  timeoutMs: number;
}

export interface AIConfig {
  primaryModel: ModelConfig;
  fallbackModel: ModelConfig;
  apiKey: string;
  apiBaseUrl: string;
  apiVersion: string;
  voyageApiKey: string | null;
  embeddingModel: string;
  embeddingDimension: number;
  ragMatchCount: number;
  ragMinQuality: number;
  enableIntentRouter: boolean;
  enableOutputValidation: boolean;
  enableTracing: boolean;
}
