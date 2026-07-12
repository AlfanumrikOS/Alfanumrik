/**
 * Pure metric helpers for teacher-dashboard.
 *
 * Missing source values stay `null`: callers must not turn an absent signal
 * into a zero, because zero is a real (and pedagogically meaningful) value.
 * Kept free of Supabase/Deno dependencies so the provenance rules can be
 * exercised as runtime unit tests.
 */
export function finiteMetricOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' && value.trim() === '') return null
  if (typeof value !== 'number' && typeof value !== 'string') return null

  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizedText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized ? normalized : null
}

/**
 * Resolve the curriculum slice used by a class metric.
 *
 * Real classes own the grade and default subject. A caller may request another
 * subject for the heatmap (the existing subject switcher contract), but it may
 * never replace the class grade. Grade pseudo-classes derive their grade from
 * the authenticated, server-authorized synthetic id.
 */
export function resolveClassCurriculumScope(
  classId: string,
  classGrade: unknown,
  classSubject: unknown,
  requestedSubject?: unknown,
  allowedSubjects?: readonly unknown[],
): { grade: string | null; subjectCode: string | null } {
  const pseudoGrade = classId.startsWith('grade-')
    ? normalizedText(classId.slice('grade-'.length))
    : null
  const rawGrade = pseudoGrade ?? normalizedText(classGrade)
  const grade = rawGrade?.replace(/^grade\s+/i, '').trim() || null
  const normalizedClassSubject = normalizedText(classSubject)?.toLowerCase() ?? null
  const normalizedRequestedSubject = normalizedText(requestedSubject)?.toLowerCase() ?? null
  const normalizedAllowedSubjects = (allowedSubjects ?? [])
    .map((subject) => normalizedText(subject)?.toLowerCase() ?? null)
    .filter((subject): subject is string => subject !== null)
  const subjectCode = normalizedRequestedSubject
    ? normalizedRequestedSubject === normalizedClassSubject || normalizedAllowedSubjects.includes(normalizedRequestedSubject)
      ? normalizedRequestedSubject
      : null
    : normalizedClassSubject ?? (
      normalizedAllowedSubjects.length === 1 ? normalizedAllowedSubjects[0] : null
    )

  return { grade, subjectCode }
}

/** Average canonical 0..1 mastery samples and expose a rounded percentage. */
export function averageFractionsAsPercent(values: readonly unknown[]): number | null {
  const observed = values
    .map(finiteMetricOrNull)
    .filter((value): value is number => value !== null)

  if (observed.length === 0) return null
  return Math.round((observed.reduce((sum, value) => sum + value, 0) / observed.length) * 100)
}

/** Average already-normalised percentages while preserving an empty signal. */
export function averagePercentages(values: readonly unknown[]): number | null {
  const observed = values
    .map(finiteMetricOrNull)
    .filter((value): value is number => value !== null)

  if (observed.length === 0) return null
  return Math.round(observed.reduce((sum, value) => sum + value, 0) / observed.length)
}

export interface ScopedMasterySample {
  student_id: unknown
  topic_id: unknown
  p_know: unknown
}

/**
 * Average mastery only for the supplied roster and curriculum topic set.
 *
 * The database query is scoped too; this pure guard is defense in depth so a
 * broadened query or malformed response cannot silently turn an all-subject
 * lifetime average into a class metric.
 */
export function averageScopedMasteryByStudent(
  studentIds: readonly string[],
  topicIds: readonly string[],
  rows: readonly ScopedMasterySample[],
): Map<string, number | null> {
  const allowedStudents = new Set(studentIds)
  const allowedTopics = new Set(topicIds)
  const samples = new Map<string, number[]>()

  for (const row of rows) {
    const studentId = normalizedText(row.student_id)
    const topicId = normalizedText(row.topic_id)
    if (!studentId || !topicId) continue
    if (!allowedStudents.has(studentId) || !allowedTopics.has(topicId)) continue

    const pKnow = finiteMetricOrNull(row.p_know)
    if (pKnow === null || pKnow < 0 || pKnow > 1) continue
    const values = samples.get(studentId) ?? []
    values.push(pKnow)
    samples.set(studentId, values)
  }

  return new Map(
    studentIds.map((studentId) => [
      studentId,
      averageFractionsAsPercent(samples.get(studentId) ?? []),
    ]),
  )
}
