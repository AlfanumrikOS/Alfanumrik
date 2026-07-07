/**
 * School Context Prompt Builder for Foxy AI Tutor
 *
 * Builds additional system prompt context for B2B school students.
 * Appended to the base Foxy system prompt when the student belongs to a school.
 *
 * This enriches Foxy's responses with school-specific context:
 * - School identity and curriculum alignment
 * - Upcoming exam awareness for targeted revision
 * - School-specific content references (school_questions)
 *
 * Safety (P12): School context is ADDITIVE to the base prompt. It MUST NOT
 * override AI safety filters, curriculum scope, or persona rules. Only
 * structured fields are used — no arbitrary prompt injection from school
 * settings.
 *
 * Owner: ai-engineer
 * Review: assessment (curriculum scope, age-appropriateness)
 */

// ─── Types ─────────────────────────────────────────────────────────────────

export interface SchoolContext {
  schoolName: string;
  board: string;         // e.g., "CBSE"
  grade: string;         // P5: string "6"-"12"
  subject: string;
  upcomingExams: Array<{
    title: string;
    subject: string;
    date: string;
    daysUntil: number;
  }>;
  schoolSettings: {
    teaching_style?: string;    // e.g., "exam-focused", "conceptual", "balanced"
    emphasis_topics?: string[]; // school wants extra focus on these
  };
  hasCustomContent: boolean;    // school has uploaded school_questions
}

// ─── Teaching style mapping ────────────────────────────────────────────────
// Only allow a fixed set of teaching styles — no arbitrary string injection.

const TEACHING_STYLE_INSTRUCTIONS: Record<string, string> = {
  'exam-focused':
    'Focus on exam preparation, practice problems, and time management. Reference past paper patterns.',
  conceptual:
    'Prioritize deep conceptual understanding. Use analogies, visual explanations, and real-world connections.',
  balanced:
    'Balance conceptual depth with exam readiness. Cover both understanding and practice.',
};

// ─── Prompt builder ────────────────────────────────────────────────────────

/**
 * Build the school context prompt addition.
 * Returns empty string for B2C students (no school context).
 *
 * Safety: This output is appended to the system prompt. It uses only
 * structured fields from the SchoolContext interface — never raw
 * user/admin input strings.
 */
export function buildSchoolContextPrompt(ctx: SchoolContext | null): string {
  if (!ctx) return '';

  const lines: string[] = [
    '',
    '## School Context',
    `You are helping a student at ${sanitizeSchoolName(ctx.schoolName)} (${ctx.board} board, Grade ${ctx.grade}).`,
  ];

  // Teaching style — only allow known values
  if (ctx.schoolSettings.teaching_style) {
    const instruction =
      TEACHING_STYLE_INSTRUCTIONS[ctx.schoolSettings.teaching_style];
    if (instruction) {
      lines.push(`Teaching approach: ${instruction}`);
    }
  }

  // Emphasis topics — sanitize each topic name
  if (ctx.schoolSettings.emphasis_topics?.length) {
    const sanitized = ctx.schoolSettings.emphasis_topics
      .slice(0, 10) // cap at 10 to prevent prompt bloat
      .map(sanitizeTopicName)
      .filter(Boolean);
    if (sanitized.length > 0) {
      lines.push(
        `School emphasis: Focus extra on these topics when relevant: ${sanitized.join(', ')}`,
      );
    }
  }

  // Upcoming exams — show max 3, nearest first
  if (ctx.upcomingExams.length > 0) {
    lines.push('');
    lines.push('### Upcoming Exams');
    for (const exam of ctx.upcomingExams.slice(0, 3)) {
      const urgency = exam.daysUntil <= 7 ? ' (SOON)' : '';
      const title = sanitizeExamTitle(exam.title);
      lines.push(
        `- ${title} (${sanitizeTopicName(exam.subject)}) — in ${exam.daysUntil} day${exam.daysUntil === 1 ? '' : 's'}${urgency}`,
      );
    }
    lines.push(
      'If the student is studying a subject with an upcoming exam, prioritize exam-relevant topics and revision strategies.',
    );
  }

  // Custom content flag
  if (ctx.hasCustomContent) {
    lines.push('');
    lines.push(
      'Note: This school has custom question content. When generating practice questions, prefer school-specific questions when available.',
    );
  }

  return lines.join('\n');
}

// ─── Data fetcher ──────────────────────────────────────────────────────────

/**
 * Fetch school context for a student's Foxy session.
 * Returns null for B2C students (no school_id).
 *
 * Uses supabaseAdmin (service role) since this runs server-side in the
 * API route. The student's school_id is already validated by RLS on the
 * students table lookup in the parent route.
 *
 * P13: No PII is included in the returned context — only school name,
 * board, settings, and aggregate counts.
 */
export async function fetchSchoolContext(
  studentId: string,
  subject: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseAdmin: any,
): Promise<SchoolContext | null> {
  // Step 1: Get student's school association.
  // Note: schools.settings is a JSONB column that may not exist yet.
  // We select it defensively — if the column is missing, the join
  // still succeeds and the field is undefined.
  const { data: student, error: studentError } = await supabaseAdmin
    .from('students')
    .select('school_id, grade, schools(name, board, settings)')
    .eq('id', studentId)
    .single();

  if (studentError || !student?.school_id) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const school = student.schools as any;
  const grade = student.grade as string; // P5: string

  // Step 2: Upcoming exams for this school (parallel with custom content check)
  const [examsResult, contentResult] = await Promise.all([
    supabaseAdmin
      .from('school_exams')
      .select('title, subject, start_time')
      .eq('school_id', student.school_id)
      .in('status', ['scheduled', 'active'])
      .gt('start_time', new Date().toISOString())
      .order('start_time', { ascending: true })
      .limit(5),

    // Check if school has approved custom content (count only, no data transfer)
    supabaseAdmin
      .from('school_questions')
      .select('id', { count: 'exact', head: true })
      .eq('school_id', student.school_id)
      .eq('approved', true),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const upcomingExams = (examsResult.data || []).map((e: any) => ({
    title: e.title,
    subject: e.subject,
    date: e.start_time,
    daysUntil: Math.ceil(
      (new Date(e.start_time).getTime() - Date.now()) / 86_400_000,
    ),
  }));

  // Parse settings defensively — may be null, undefined, or missing column
  const rawSettings =
    typeof school?.settings === 'object' && school.settings !== null
      ? school.settings
      : {};

  const schoolSettings: SchoolContext['schoolSettings'] = {
    teaching_style:
      typeof rawSettings.teaching_style === 'string'
        ? rawSettings.teaching_style
        : undefined,
    emphasis_topics: Array.isArray(rawSettings.emphasis_topics)
      ? rawSettings.emphasis_topics.filter(
          (t: unknown) => typeof t === 'string',
        )
      : undefined,
  };

  return {
    schoolName: school?.name || 'School',
    board: school?.board || 'CBSE',
    grade, // P5: string from DB
    subject,
    upcomingExams,
    schoolSettings,
    hasCustomContent: (contentResult.count || 0) > 0,
  };
}

// ─── Sanitizers ────────────────────────────────────────────────────────────
// Prevent prompt injection by stripping control characters and limiting length.
// These are defense-in-depth — the data comes from admin-controlled DB fields,
// but we still sanitize before injecting into Claude's system prompt.

function sanitizeSchoolName(name: string): string {
  return name
    .replace(/[\n\r\t]/g, ' ')
    .replace(/[#*_`~<>[\]{}|\\]/g, '')
    .trim()
    .slice(0, 100);
}

function sanitizeTopicName(topic: string): string {
  return topic
    .replace(/[\n\r\t]/g, ' ')
    .replace(/[#*_`~<>[\]{}|\\]/g, '')
    .trim()
    .slice(0, 80);
}

function sanitizeExamTitle(title: string): string {
  return title
    .replace(/[\n\r\t]/g, ' ')
    .replace(/[#*_`~<>[\]{}|\\]/g, '')
    .trim()
    .slice(0, 120);
}
