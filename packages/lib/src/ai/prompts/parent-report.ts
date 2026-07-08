/**
 * Parent Progress Report — System Prompt Template
 *
 * Builds the system prompt for generating parent-readable student
 * progress reports. Produces warm, encouraging summaries with
 * actionable study suggestions.
 *
 * Used by: parent portal report generation workflows
 *
 * Owner: ai-engineer
 * Review: assessment (metric interpretation, study suggestions)
 */

// ─── Parameters ─────────────────────────────────────────────────────────────

export interface ParentReportMetrics {
  scoreAverage: number;          // 0-100
  quizzesCompleted: number;
  topicsCovered: string[];
  weakAreas: string[];
  strongAreas: string[];
  studyTimeMinutes?: number;
  improvementTrend?: 'improving' | 'stable' | 'declining';
  masteryLevel?: string;         // e.g. "Developing", "Proficient", "Advanced"
}

export interface ParentReportPromptParams {
  studentName: string;
  grade: string;                 // P5: string "6"-"12"
  subject: string;
  metrics: ParentReportMetrics;
  language: 'en' | 'hi';        // P7: bilingual support
}

// ─── Builder ────────────────────────────────────────────────────────────────

/**
 * Builds the system prompt for generating a parent progress report.
 *
 * The prompt instructs Claude to produce a warm, structured report
 * that Indian parents can understand and act upon. Supports English
 * and Hindi output (P7).
 *
 * Safety: keeps language age-appropriate, avoids negative framing,
 * never shares raw scores without context (P12, P13).
 */
export function buildParentReportPrompt(
  params: ParentReportPromptParams,
): string {
  const { studentName, grade, subject, metrics, language } = params;

  const languageInstruction =
    language === 'hi'
      ? 'Write the entire report in Hindi (Devanagari script). Use simple Hindi that parents can easily understand.'
      : 'Write the report in simple, clear English. Avoid jargon.';

  const trendLabel = metrics.improvementTrend === 'improving'
    ? 'showing improvement'
    : metrics.improvementTrend === 'declining'
      ? 'needs more attention'
      : 'steady';

  const weakAreasText =
    metrics.weakAreas.length > 0
      ? metrics.weakAreas.join(', ')
      : 'No significant weak areas identified';

  const strongAreasText =
    metrics.strongAreas.length > 0
      ? metrics.strongAreas.join(', ')
      : 'Building foundation across all topics';

  const studyTimeNote = metrics.studyTimeMinutes != null
    ? `Study time this period: approximately ${metrics.studyTimeMinutes} minutes.`
    : '';

  return `You are a caring academic counselor at an Indian CBSE school. Generate a progress report for a parent about their child's performance.

## Student Details
- Name: ${studentName}
- Grade: ${grade}
- Subject: ${subject}

## Performance Data
- Average Score: ${metrics.scoreAverage}%
- Quizzes Completed: ${metrics.quizzesCompleted}
- Topics Covered: ${metrics.topicsCovered.join(', ') || 'None yet'}
- Strong Areas: ${strongAreasText}
- Areas for Improvement: ${weakAreasText}
- Overall Trend: ${trendLabel}
${metrics.masteryLevel ? `- Mastery Level: ${metrics.masteryLevel}` : ''}
${studyTimeNote}

## Report Structure
1. **Greeting**: Address the parent warmly.
2. **Highlights**: Start with what the student is doing well. Be specific about strong topics.
3. **Progress Summary**: Summarize overall performance with context (e.g., "${metrics.scoreAverage}% average means...").
4. **Areas to Focus**: Frame weak areas constructively — "areas where more practice will help" not "areas where the student is failing."
5. **Study Suggestions**: Give 2-3 specific, actionable study tips the parent can help with at home. Reference NCERT textbook activities or exercises when possible.
6. **Encouragement**: End on a positive, motivating note.

## Tone Guidelines
- Be warm and respectful — Indian parents deeply care about their child's education.
- Never be discouraging or use negative language about the student.
- Frame challenges as opportunities for growth.
- Acknowledge the parent's role in supporting learning.
- Use language appropriate for discussing a Grade ${grade} student.
- Keep the report concise: 200-300 words.

## Language
${languageInstruction}

## Rules
- Do not invent performance data beyond what is provided above.
- Do not compare the student to other students.
- Do not suggest external tutoring or coaching classes — focus on self-study and NCERT resources.
- Do not include any technical jargon (Bloom's taxonomy, IRT, BKT, etc.).
- Keep all suggestions within the CBSE Grade ${grade} ${subject} curriculum scope.`;
}
