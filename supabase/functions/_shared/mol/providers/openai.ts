// supabase/functions/_shared/mol/providers/openai.ts

import type { ModelProvider, ProviderCallOptions } from './base.ts'
import type { ProviderResponse } from '../types.ts'
import { fetchWithTimeout } from '../../reliability.ts'

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'

export class OpenAIProvider implements ModelProvider {
  readonly id = 'openai' as const
  readonly default_model = 'gpt-4o-mini'

  private apiKey(): string {
    return Deno.env.get('OPENAI_API_KEY') || ''
  }

  isConfigured(): boolean {
    return this.apiKey().length > 0
  }

  async call(model: string, opts: ProviderCallOptions): Promise<ProviderResponse> {
    if (!this.isConfigured()) {
      throw new Error('OpenAIProvider not configured (OPENAI_API_KEY missing)')
    }

    const timeout = opts.timeout_ms ?? 20_000

    // OpenAI chat format. Vision via image_url content part on the last user msg.
    const chatMessages: Array<Record<string, unknown>> = [
      { role: 'system', content: opts.system_prompt },
    ]
    for (let i = 0; i < opts.user_messages.length; i++) {
      const m = opts.user_messages[i]
      const isLast = i === opts.user_messages.length - 1
      if (isLast && opts.image_url) {
        chatMessages.push({
          role: m.role,
          content: [
            { type: 'image_url', image_url: { url: opts.image_url } },
            { type: 'text', text: m.content },
          ],
        })
      } else {
        chatMessages.push({ role: m.role, content: m.content })
      }
    }

    const body = {
      model,
      messages: chatMessages,
      max_tokens: opts.max_tokens,
      temperature: opts.temperature ?? 0.7,
    }

    const res = await fetchWithTimeout(OPENAI_URL, {
          provider: 'openai',
          operation: 'mol_chat_completion',
          timeoutMs: timeout,
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey()}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        })

    if (!res.ok) {
      const raw = await res.text().catch(() => '')
      let typed = ''
      try {
        const j = JSON.parse(raw) as { error?: { type?: string; code?: string } }
        const tag = j?.error?.code || j?.error?.type
        if (tag) typed = ` (${tag})`
      } catch { /* not JSON */ }
      throw new Error(`OpenAI ${res.status}${typed}`)
    }

    const data = await res.json() as {
      choices: Array<{ message: { content: string }; finish_reason: string }>
      usage: { prompt_tokens: number; completion_tokens: number }
      model: string
    }

    const text = (data.choices[0]?.message?.content ?? '').trim()

    return {
      text,
      provider: 'openai',
      model: data.model || model,
      tokens: { prompt: data.usage.prompt_tokens, completion: data.usage.completion_tokens },
      finish_reason: data.choices[0]?.finish_reason ?? 'stop',
      raw: data,
    }
  }
}
