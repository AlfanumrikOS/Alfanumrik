// supabase/functions/_shared/mol/providers/base.ts

import type { ProviderResponse, TokenUsage } from '../types.ts'

export interface ProviderCallOptions {
  system_prompt: string
  user_messages: Array<{ role: 'user' | 'assistant'; content: string }>
  max_tokens: number
  temperature?: number
  timeout_ms?: number
  image_url?: string                    // for vision
}

export interface ModelProvider {
  readonly id: 'openai' | 'anthropic'
  readonly default_model: string
  isConfigured(): boolean
  call(model: string, opts: ProviderCallOptions): Promise<ProviderResponse>
}

export type ProviderCallResult = {
  ok: true
  response: ProviderResponse
} | {
  ok: false
  error: string
  status?: number
  retryable: boolean
}

export function emptyUsage(): TokenUsage {
  return { prompt: 0, completion: 0 }
}
