/**
 * Content Guard — lightweight heuristic checks for NCERT syllabus
 * scope violations and grade-appropriateness.
 *
 * Not a full content review — catches obvious mismatches only.
 */

import type { ValidationResult } from '../types';
import { VALID_GRADES } from '../config';

const NON_CBSE_BOARDS = ['icse', 'igcse', 'ib ', 'state board', 'cambridge', 'edexcel'];

/** Topics that should not appear for grades 6-8 */
const ADVANCED_TOPICS_LOWER: ReadonlySet<string> = new Set([
  'calculus', 'differential equations', 'integration', 'limits',
  'vectors', 'matrices', 'determinants', 'probability distribution',
  'organic chemistry', 'electrochemistry', 'thermodynamics',
  'electromagnetic induction', 'nuclear physics',
]);

/** Rough subject keyword sets for cross-subject detection */
const SUBJECT_KEYWORDS: Record<string, string[]> = {
  mathematics: ['equation', 'algebra', 'geometry', 'arithmetic', 'theorem', 'formula', 'graph'],
  science: ['atom', 'molecule', 'cell', 'organism', 'force', 'energy', 'reaction'],
  physics: ['velocity', 'acceleration', 'momentum', 'wave', 'optics', 'circuit'],
  chemistry: ['element', 'compound', 'bond', 'acid', 'base', 'salt', 'reaction'],
  biology: ['cell', 'dna', 'organism', 'photosynthesis', 'evolution', 'ecology'],
  english: ['grammar', 'literature', 'poem', 'essay', 'comprehension', 'vocabulary'],
  hindi: ['vyakaran', 'kavita', 'gadya', 'rachna', 'patra'],
  social_science: ['history', 'geography', 'civics', 'economics', 'constitution'],
};

export function validateContentScope(params: {
  grade: string;
  subject: string;
  content: string;
}): ValidationResult {
  const { grade, subject, content } = params;
  const errors: string[] = [];
  const warnings: string[] = [];
  const lower = content.toLowerCase();

  // 1. Grade references outside 6-12
  const gradeRefs = lower.match(/(?:grade|class|std)\s*(\d+)/gi) || [];
  for (const ref of gradeRefs) {
    const num = ref.match(/(\d+)/)?.[1];
    if (num && !VALID_GRADES.includes(num as typeof VALID_GRADES[number])) {
      warnings.push(`References grade ${num} which is outside supported range (6-12)`);
    }
  }

  // 2. Non-CBSE board references
  for (const board of NON_CBSE_BOARDS) {
    if (lower.includes(board)) {
      warnings.push(`References non-CBSE board/curriculum: "${board.trim()}"`);
    }
  }

  // 3. Advanced topics for lower grades
  const gradeNum = parseInt(grade, 10);
  if (gradeNum >= 6 && gradeNum <= 8) {
    for (const topic of ADVANCED_TOPICS_LOWER) {
      if (lower.includes(topic)) {
        errors.push(`Advanced topic "${topic}" inappropriate for grade ${grade}`);
      }
    }
  }

  // 4. Cross-subject mismatch warning
  const normalizedSubject = subject.toLowerCase().replace(/[\s_-]+/g, '_');
  const subjectKeys = Object.keys(SUBJECT_KEYWORDS).filter(k => k !== normalizedSubject);
  for (const otherSubject of subjectKeys) {
    const keywords = SUBJECT_KEYWORDS[otherSubject];
    const matchCount = keywords.filter(kw => lower.includes(kw)).length;
    const ownKeywords = SUBJECT_KEYWORDS[normalizedSubject] || [];
    const ownMatchCount = ownKeywords.filter(kw => lower.includes(kw)).length;
    if (matchCount >= 3 && ownMatchCount === 0) {
      warnings.push(`Content may belong to ${otherSubject} rather than ${subject}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    sanitizedContent: content,
  };
}
