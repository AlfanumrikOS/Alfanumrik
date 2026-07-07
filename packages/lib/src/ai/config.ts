/**
 * AI Layer Configuration
 *
 * Centralizes model names, API endpoints, timeouts, and feature flags
 * for all AI workflows. Server-side only (reads env vars).
 */

import type { AIConfig, ModelConfig } from './types';

// ─── Model Configurations ───────────────────────────────────────────────────

const HAIKU: ModelConfig = {
  name: 'claude-haiku-4-5-20251001',
  maxTokens: 1024,
  temperature: 0.3,
  timeoutMs: 30_000,
};

const SONNET: ModelConfig = {
  name: 'claude-sonnet-4-20250514',
  maxTokens: 2048,
  temperature: 0.3,
  timeoutMs: 45_000,
};

// ─── Build Config ───────────────────────────────────────────────────────────

export function getAIConfig(): AIConfig {
  return {
    primaryModel: HAIKU,
    fallbackModel: SONNET,
    apiKey: process.env.ANTHROPIC_API_KEY ?? '',
    // eslint-disable-next-line alfanumrik/no-direct-ai-calls -- TODO(phase-4-cleanup): remove legacy AI config once ff_foxy_grounded_only is removed; callers must use grounded-answer service.
    apiBaseUrl: 'https://api.anthropic.com/v1',
    apiVersion: '2023-06-01',
    voyageApiKey: process.env.VOYAGE_API_KEY ?? null,
    embeddingModel: 'voyage-3',
    embeddingDimension: 1024,
    ragMatchCount: 5,
    // Calibrated for the RRF (Reciprocal Rank Fusion) score returned by
    // match_rag_chunks_ncert. RRF score = 1/(60+rank_vec) + 1/(60+rank_fts),
    // capped near 0.0328 when a chunk ranks #1 in both lists. The pre-2026-05-10
    // value of 0.4 was for cosine similarity [0,1] and would filter EVERY
    // chunk on the legacy retrieval path — the same root cause behind PR #692
    // and PR #693 in the grounded-answer service. Using the SOFT floor here
    // because this retriever is the cold-path fallback for Foxy when
    // ff_grounded_ai_foxy is OFF (ai-outage-response runbook), and soft mode
    // prefers degraded answers to outright abstain. Audit 2026-05-10 P1 fix.
    ragMinQuality: 0.005,
    // Feature flags — these are local overrides. Production flags use
    // the DB-backed feature flag system (src/lib/feature-flags.ts).
    enableIntentRouter: process.env.AI_ENABLE_INTENT_ROUTER !== 'false', // ON by default
    enableOutputValidation: process.env.AI_ENABLE_OUTPUT_VALIDATION !== 'false', // on by default
    enableTracing: process.env.AI_ENABLE_TRACING !== 'false', // on by default
  };
}

// ─── Quota Limits (display-only — enforcement uses DB-derived values) ───────

export const DAILY_QUOTA: Record<string, number> = {
  free: 10,
  starter: 30,
  pro: 100,
  unlimited: 999_999,
};

export const DEFAULT_QUOTA = 10;

/**
 * Normalize raw plan codes from the DB to canonical keys.
 * Handles legacy aliases (basic->starter, premium->pro, ultimate->unlimited)
 * and strips monthly/yearly billing-cycle suffixes.
 */
export function normalizePlan(raw: string): string {
  return (raw || 'free')
    .replace(/_(monthly|yearly)$/, '')
    .replace(/^basic$/, 'starter')
    .replace(/^premium$/, 'pro')
    .replace(/^ultimate$/, 'unlimited');
}

// ─── Valid Input Constants ──────────────────────────────────────────────────

export const VALID_GRADES = ['6', '7', '8', '9', '10', '11', '12'] as const;
export const VALID_MODES = ['learn', 'explain', 'practice', 'revise', 'doubt', 'homework'] as const;
export const VALID_LANGUAGES = ['en', 'hi', 'hinglish'] as const;

export type Grade = (typeof VALID_GRADES)[number];
export type FoxyMode = (typeof VALID_MODES)[number];
export type Language = (typeof VALID_LANGUAGES)[number];

export const MAX_MESSAGE_LENGTH = 5000;
export const MAX_HISTORY_TURNS = 6;
export const SESSION_IDLE_MINUTES = 30;
