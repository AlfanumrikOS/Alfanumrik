/**
 * Alfanumrik AI Layer — Public API
 *
 * This module provides a unified interface for all AI-powered features
 * in the Next.js layer. It consolidates what was previously 10+ separate
 * Claude API call implementations into a structured, validated, and
 * observable system.
 *
 * Architecture boundary: This module MAY ONLY orchestrate LLM-driven
 * workflows. It MUST NOT touch auth, payments, RBAC, admin, CMS,
 * dashboards, user profiles, billing, or sessions.
 *
 * Usage:
 *   import { classifyIntent, routeIntent, callClaude, retrieveNcertChunks } from '@/lib/ai';
 */

// ─── Client ─────────────────────────────────────────────────────────────────
export { callClaude, isCircuitBreakerOpen, getCircuitBreakerState } from './clients/claude';

// ─── Config ─────────────────────────────────────────────────────────────────
export { getAIConfig, normalizePlan, DAILY_QUOTA, DEFAULT_QUOTA } from './config';
export { VALID_GRADES, VALID_MODES, VALID_LANGUAGES } from './config';
export type { Grade, FoxyMode, Language } from './config';

// ─── Prompts ────────────────────────────────────────────────────────────────
export { buildFoxySystemPrompt } from './prompts/foxy-system';
export { buildNcertSolverPrompt } from './prompts/ncert-solver';
export { buildQuizGenPrompt } from './prompts/quiz-gen';
export { buildParentReportPrompt } from './prompts/parent-report';
export { buildSchoolContextPrompt, fetchSchoolContext } from './prompts/school-context';
export type { SchoolContext } from './prompts/school-context';

// ─── Retrieval ──────────────────────────────────────────────────────────────
export { retrieveNcertChunks, generateEmbedding } from './retrieval/ncert-retriever';

// ─── Validation ─────────────────────────────────────────────────────────────
export { validateOutput } from './validation/output-guard';
export { validateQuizQuestions } from './validation/quiz-validator';
export { validateContentScope } from './validation/content-guard';

// ─── Tools (DB Adapters) ────────────────────────────────────────────────────
export { getNcertChunks } from './tools/get-ncert-chunks';
export { getStudentContext, getSessionContext } from './tools/get-student-context';
export { saveTrace, flagContent } from './tools/save-trace';

// ─── Tracing ────────────────────────────────────────────────────────────────
export { TraceLogger, logTrace } from './tracing/trace-logger';

// ─── Workflows ──────────────────────────────────────────────────────────────
export { classifyIntent, routeIntent, runFoxyGraph } from './workflows/foxy-router';
export type { FoxyState } from './workflows/foxy-router';
export { runExplainWorkflow } from './workflows/explain';
export { runDoubtWorkflow } from './workflows/doubt-solve';
export { runQuizGenerateWorkflow } from './workflows/quiz-generate';
export { runRevisionWorkflow } from './workflows/revision';

// ─── Types (re-export for convenience) ──────────────────────────────────────
export type {
  FoxyIntent,
  IntentClassification,
  ChatMessage,
  ClaudeRequestOptions,
  ClaudeResponse,
  RetrievalQuery,
  RetrievedChunk,
  RetrievalResult,
  WorkflowResult,
  QuizQuestion,
  QuizGenerationResult,
  ValidationResult,
  StudentContext,
  SessionContext,
  TraceStep,
  TraceStepType,
  WorkflowTrace,
  ModelConfig,
  AIConfig,
} from './types';
