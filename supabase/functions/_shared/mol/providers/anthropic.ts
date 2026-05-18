// supabase/functions/_shared/mol/providers/anthropic.ts

import type { ModelProvider, ProviderCallOptions } from './base.ts'
import type { ProviderResponse } from '../types.ts'
import { withTimeout } from './shared.ts'

const ANTHROPIC_VERSION = '2023-06-01'
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'

export class AnthropicProvider implements ModelProvider {
  readonly id = 'anthropic' as const
  readonly default_model = 'claude-haiku-4-5-20251001'

  private apiKey(): string {
    return Deno.env.get('ANTHROPIC_API_KEY') || ''
  }

  isConfigured(): boolean {
    return this.apiKey().length > 0
  }

  async call(model: string, opts: ProviderCallOptions): Promise<ProviderResponse> {
    if (!this.isConfigured()) {
      throw new Error('AnthropicProvider not configured (ANTHROPIC_API_KEY missing)')
    }

    const timeout = opts.timeout_ms ?? 20_000

    // Enable Anthropic prompt caching on the system block when it's long enough.
    const sysBlock = opts.system_prompt.length >= 1024
      ? [{ type: 'text', text: opts.system_prompt, cache_control: { type: 'ephemeral' } }]
      : opts.system_prompt

    // Vision: when image_url is provided, attach to the latest user message.
    let messages = opts.user_messages
    if (opts.image_url) {
      const last = messages[messages.length - 1]
      const others = messages.slice(0, -1)
      messages = [
        ...others,
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'url', url: opts.image_url } },
            { type: 'text', text: last?.content ?? '' },
          ] as unknown as string,
        },
      ]
    }

    const body = {
      model,
      max_tokens: opts.max_tokens,
      system: sysBlock,
      messages,
      temperature: opts.temperature ?? 0.7,
    }

    const res = await withTimeout(
      (signal) =>
        fetch(ANTHROPIC_URL, {
          method: 'POST',
          headers: {
            'x-api-key': this.apiKey(),
            'anthropic-version': ANTHROPIC_VERSION,
            'content-type': 'application/json',
          },
          body: JSON.stringify(body),
          signal,
        }),
      timeout,
    )

    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      throw new Error(`Anthropic ${res.status}: ${txt.slice(0, 300)}`)
    }

    const data = await res.json() as {
      content: Array<{ type: string; text?: string }>
      usage: { input_tokens: number; output_tokens: number }
      stop_reason: string
    }

    const text = data.content
      .filter((b) => b.type === 'text' && b.text)
      .map((b) => b.text!)
      .join('\n')
      .trim()

    return {
      text,
      provider: 'anthropic',
      model,
      tokens: { prompt: data.usage.input_tokens, completion: data.usage.output_tokens },
      finish_reason: data.stop_reason,
      raw: data,
    }
  }
}
