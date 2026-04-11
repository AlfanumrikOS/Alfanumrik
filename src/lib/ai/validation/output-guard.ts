/**
 * Output Guard — validates LLM output before it reaches students.
 *
 * Enforces AI safety (P12): age-appropriate, no leaked errors,
 * no prompt injection artifacts, no hallucination markers.
 */

import type { ValidationResult } from '../types';

const BLOCKLIST = [
  'damn', 'hell', 'shit', 'fuck', 'bastard', 'ass', 'bitch', 'crap',
  'kill yourself', 'suicide', 'self-harm', 'murder', 'weapon',
  'drug abuse', 'alcohol', 'gambling', 'porn', 'sex',
];

const HALLUCINATION_MARKERS = [
  'as an ai language model',
  'as a large language model',
  "i don't have access to",
  "i cannot browse the internet",
  'i was trained by',
  "i'm an ai",
  'my training data',
  'my knowledge cutoff',
];

const PROMPT_LEAK_MARKERS = [
  'system prompt',
  'you are a helpful assistant',
  'instructions:',
  '<system>',
  '</system>',
  '<<SYS>>',
  '[INST]',
];

const ERROR_MARKERS = [
  'stack trace',
  'error:',
  'exception:',
  'traceback',
  'at line ',
  'syntaxerror',
  'typeerror',
  'referenceerror',
  'unhandled rejection',
  'ECONNREFUSED',
  'ETIMEDOUT',
];

const MIN_LENGTH = 10;
const MAX_LENGTH = 10_000;

export function validateOutput(
  content: string,
  context?: { grade?: string; subject?: string },
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  let sanitized = content;

  // 1. Non-empty
  if (!content || content.trim().length === 0) {
    return { valid: false, errors: ['Empty response'], warnings, sanitizedContent: '' };
  }

  const lower = content.toLowerCase();

  // 2. Error / stack trace leaks
  for (const marker of ERROR_MARKERS) {
    if (lower.includes(marker)) {
      errors.push(`Leaked error marker: "${marker}"`);
      sanitized = sanitized.replace(new RegExp(marker, 'gi'), '[removed]');
    }
  }

  // 3. Inappropriate content
  for (const word of BLOCKLIST) {
    if (lower.includes(word)) {
      errors.push(`Inappropriate content detected: "${word}"`);
      sanitized = sanitized.replace(new RegExp(word, 'gi'), '***');
    }
  }

  // 4. Hallucination markers
  for (const marker of HALLUCINATION_MARKERS) {
    if (lower.includes(marker)) {
      warnings.push(`Hallucination marker: "${marker}"`);
    }
  }

  // 5. Prompt injection / system prompt leaks
  for (const marker of PROMPT_LEAK_MARKERS) {
    if (lower.includes(marker)) {
      errors.push(`Prompt leak detected: "${marker}"`);
      sanitized = sanitized.replace(new RegExp(marker, 'gi'), '[removed]');
    }
  }

  // 6. Length sanity
  const trimmed = content.trim();
  if (trimmed.length < MIN_LENGTH) {
    warnings.push(`Response too short (${trimmed.length} chars, min ${MIN_LENGTH})`);
  }
  if (trimmed.length > MAX_LENGTH) {
    warnings.push(`Response too long (${trimmed.length} chars, max ${MAX_LENGTH})`);
    sanitized = sanitized.slice(0, MAX_LENGTH) + '...';
  }

  // Context-aware warnings
  if (context?.grade) {
    const gradeNum = parseInt(context.grade, 10);
    if (gradeNum <= 8 && lower.includes('calculus')) {
      warnings.push('Advanced topic (calculus) mentioned for grade <= 8');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    sanitizedContent: sanitized,
  };
}
