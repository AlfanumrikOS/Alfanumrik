// supabase/functions/_shared/mol/__tests__/post-processor.test.ts

import { describe, it, expect } from 'vitest'
import { postProcess } from '../post-processor.ts'

describe('postProcess', () => {
  it('strips leading/trailing whitespace', () => {
    expect(postProcess('  hello\n\n  ', 'explanation')).toBe('hello')
  })

  it('removes any leaked vendor name', () => {
    const out = postProcess('As an AI language model from OpenAI, I think...', 'explanation')
    expect(out).not.toMatch(/AI language model/i)
    expect(out).not.toMatch(/OpenAI/i)
    expect(out).not.toMatch(/Anthropic/i)
    expect(out).not.toMatch(/Claude/i)
    expect(out).not.toMatch(/GPT/i)
  })

  it('redacts apparent email addresses', () => {
    const out = postProcess('Contact me at student@example.com for help.', 'explanation')
    expect(out).not.toMatch(/student@example\.com/)
  })

  it('truncates if absurdly long', () => {
    const long = 'x'.repeat(20000)
    expect(postProcess(long, 'explanation').length).toBeLessThanOrEqual(8000)
  })

  it('preserves JSON for quiz_generation without prose stripping', () => {
    const json = '{"items":[{"stem":"What?","options":["a","b","c","d"],"correct_index":0,"explanation":"because","difficulty":"easy","ncert_chapter":"1"}]}'
    expect(postProcess(json, 'quiz_generation')).toBe(json)
  })
})
