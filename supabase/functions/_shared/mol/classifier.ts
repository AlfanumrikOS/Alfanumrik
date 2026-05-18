// supabase/functions/_shared/mol/classifier.ts

import type { GenerateRequest, TaskType } from './types.ts'

const KEYWORDS = {
  step_by_step: /\b(step[\s-]?by[\s-]?step|solve.*step|derive|show your work|show the steps|prove)\b/i,
  reasoning: /\b(why .* and why|prove that|derive|justify|compare and contrast|critically)\b/i,
  evaluation: /\b(grade (my|this)|evaluate (my|this)|is this correct|check my (answer|work)|mark this)\b/i,
  explanation: /\b(explain|what is|define|describe|tell me about|kya hai|कैसे|क्या है)\b/iu,
  doubt_solving: /\b(i don'?t understand|i'm confused|why does|how do i|samajh nahi|समझ नहीं)\b/iu,
  quiz_generation: /\b(generate|create|make).*(quiz|questions?|mcqs?|test)\b/i,
}

/**
 * Lightweight rule-based classifier. Returns a TaskType.
 * Priority order matters: more specific signals checked first.
 */
export function classify(req: GenerateRequest): TaskType {
  if (req.task_type) return req.task_type

  // Vision = OCR
  if (req.input.image_url) return 'ocr_extraction'

  // Surface hint short-circuits
  const surface = req.config?.surface
  if (surface === 'quiz') return 'quiz_generation'
  if (surface === 'ocr') return 'ocr_extraction'

  const text = (req.input.question || req.input.instruction || req.input.topic || '').trim()

  // Multi-part "why ... how" → doubt_solving
  const hasWhy = /\bwhy\b/i.test(text)
  const hasHow = /\bhow\b/i.test(text)
  if (hasWhy && hasHow && text.length > 40) return 'doubt_solving'

  if (KEYWORDS.evaluation.test(text)) return 'evaluation'
  if (KEYWORDS.quiz_generation.test(text)) return 'quiz_generation'
  if (KEYWORDS.step_by_step.test(text)) return 'step_by_step'
  if (KEYWORDS.doubt_solving.test(text)) return 'doubt_solving'
  if (KEYWORDS.reasoning.test(text)) return 'reasoning'
  if (KEYWORDS.explanation.test(text)) return 'explanation'

  // Default — student-facing surfaces are usually teaching
  return 'explanation'
}

export function gradeTier(grade: string): 'junior' | 'middle' | 'senior' {
  const g = parseInt(grade, 10) || 0
  if (g <= 8) return 'junior'
  if (g <= 10) return 'middle'
  return 'senior'
}
