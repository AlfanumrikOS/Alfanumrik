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

// ─── Content Blocks (Anthropic API) ─────────────────────────────────────────

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown };

export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

// ─── Chat Messages ──────────────────────────────────────────────────────────

export interface ChatMessage {
  role: 'user' | 'assistant';
  /**
   * String for legacy single-shot calls. ContentBlock[] when echoing an
   * assistant tool_use response back. ToolResultBlock[] when feeding tool
   * outputs back to the model in an agent loop.
   */
  content: string | ContentBlock[] | ToolResultBlock[];
}

// ─── Claude API ─────────────────────────────────────────────────────────────

export interface ClaudeToolSchema {
  name: string;
  description: string;
  input_schema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
}

export type ClaudeToolChoice =
  | { type: 'auto' }
  | { type: 'any' }
  | { type: 'tool'; name: string };

export interface ClaudeRequestOptions {
  model?: string;
  systemPrompt: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  /** Optional tool schemas for agent loops. */
  tools?: ClaudeToolSchema[];
  /** Optional tool choice. Default: { type: 'auto' } when tools are present. */
  toolChoice?: ClaudeToolChoice;
}

export interface ClaudeResponse {
  /** Concatenated text from all `text` content blocks. Empty string if response had only tool_use blocks. */
  content: string;
  /** Full content blocks from the API response, including `tool_use` blocks. */
  contentBlocks: ContentBlock[];
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
  /** Goal-Adaptive Phase 4: when ff_goal_aware_rag is on, this triggers a post-RPC rerank. Optional - omit to preserve legacy ordering. */
  academicGoal?: string | null;
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
  /** Goal-Adaptive Phase 4: source pack of the chunk (e.g. ncert_2025, pyq, jee_archive). Optional. */
  source?: string | null;
  /** Goal-Adaptive Phase 4: exam-relevance tags (e.g. CBSE, CBSE_BOARD, JEE, NEET, OLYMPIAD). Optional. */
  examRelevance?: ReadonlyArray<string> | null;
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
