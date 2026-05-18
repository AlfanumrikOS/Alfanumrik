// supabase/functions/_shared/mol/post-processor.ts

import type { TaskType } from './types.ts'

const MAX_LEN = 8000

const VENDOR_PATTERNS: RegExp[] = [
  /\bas an ai (language )?model[,.]?/gi,
  /\bi am an ai\b[^.]*\./gi,
  /\b(openai|anthropic|claude|gpt-\d+\w*|chatgpt|gpt|gemini)\b/gi,
]

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
const PHONE_PATTERN = /\+?\d[\d\s().-]{8,}\d/g

export function postProcess(text: string, task: TaskType): string {
  let out = text.trim()

  // Quiz/eval are strict JSON — don't touch.
  if (task !== 'quiz_generation' && task !== 'evaluation' && task !== 'ocr_extraction') {
    for (const p of VENDOR_PATTERNS) out = out.replace(p, '')
    out = out.replace(EMAIL_PATTERN, '[email]')
    out = out.replace(PHONE_PATTERN, '[number]')
    out = out.replace(/\n{3,}/g, '\n\n')
  }

  if (out.length > MAX_LEN) out = out.slice(0, MAX_LEN - 3) + '\n\n…'
  return out.trim()
}
