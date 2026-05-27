import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

export interface WorkflowCognitiveContext {
  loSkills: Array<{ loCode: string; loStatement: string; pKnow: number; pSlip: number; theta: number }>;
  misconceptions: Array<{ code: string; label: string; count: number; remediationText: string }>;
}

export async function loadWorkflowCognitiveContext(
  studentId: string | undefined,
  subject: string,
  grade: string,
  chapter: string | null | undefined = null,
): Promise<WorkflowCognitiveContext> {
  if (!studentId) {
    return { loSkills: [], misconceptions: [] };
  }

  try {
    const { data: subjectRow } = await supabaseAdmin
      .from('subjects')
      .select('id')
      .ilike('code', subject)
      .maybeSingle();
    const subjectId = subjectRow?.id ?? null;

    let chapterId: string | null = null;
    if (chapter && subjectId) {
      try {
        const chapterNum = /^\d+$/.test(chapter) ? parseInt(chapter, 10) : null;
        let chQuery = supabaseAdmin
          .from('chapters')
          .select('id')
          .eq('subject_id', subjectId)
          .eq('grade', grade);
        if (chapterNum !== null) {
          chQuery = chQuery.eq('chapter_number', chapterNum);
        } else {
          chQuery = chQuery.ilike('title', chapter);
        }
        const { data: chRow } = await chQuery.limit(1).maybeSingle();
        chapterId = chRow?.id ?? null;
      } catch {
        // Non-fatal
      }
    }

    const [loSkillsRes, misconceptionsRes] = await Promise.all([
      (() => {
        let q = supabaseAdmin
          .from('student_skill_state')
          .select('p_know, p_slip, theta, learning_objectives!inner(code, statement, chapter_id, chapters!inner(subject_id))')
          .eq('student_id', studentId)
          .order('p_know', { ascending: true })
          .limit(50);
        if (chapterId) {
          q = q.eq('learning_objectives.chapter_id', chapterId);
        } else if (subjectId) {
          q = q.eq('learning_objectives.chapters.subject_id', subjectId);
        }
        return q;
      })(),

      supabaseAdmin
        .from('quiz_responses')
        .select('question_id, selected_option, is_correct, created_at, question_misconceptions!inner(misconception_code, misconception_label, distractor_index, remediation_chunk_id)')
        .eq('student_id', studentId)
        .eq('is_correct', false)
        .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
        .limit(200),
    ]);

    // Process loSkills
    type LoSkillRow = {
      p_know: number | string | null;
      p_slip: number | string | null;
      theta: number | string | null;
      learning_objectives:
        | {
            code: string;
            statement: string;
            chapter_id: string;
            chapters: { subject_id: string } | Array<{ subject_id: string }> | null;
          }
        | Array<{
            code: string;
            statement: string;
            chapter_id: string;
            chapters: { subject_id: string } | Array<{ subject_id: string }> | null;
          }>
        | null;
    };
    const loSkillsRaw = (loSkillsRes.data ?? []) as unknown as LoSkillRow[];
    const loSkills = loSkillsRaw
      .map((row) => {
        const lo = Array.isArray(row.learning_objectives)
          ? row.learning_objectives[0]
          : row.learning_objectives;
        if (!lo) return null;
        const chap = Array.isArray(lo.chapters) ? lo.chapters[0] : lo.chapters;
        return {
          row,
          loCode: lo.code,
          loStatement: lo.statement,
          chapterIdForRow: lo.chapter_id,
          subjectIdForRow: chap?.subject_id ?? null,
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      .filter((entry) => {
        if (chapterId) return entry.chapterIdForRow === chapterId;
        if (subjectId) return entry.subjectIdForRow === subjectId;
        return true;
      })
      .slice(0, 10)
      .map((entry) => ({
        loCode: entry.loCode,
        loStatement: entry.loStatement,
        pKnow: Number(entry.row.p_know ?? 0),
        pSlip: Number(entry.row.p_slip ?? 0),
        theta: Number(entry.row.theta ?? 0),
      }));

    // Process misconceptions
    type MisconceptionJoinRow = {
      question_id: string;
      selected_option: number | null;
      question_misconceptions:
        | {
            misconception_code: string;
            misconception_label: string;
            distractor_index: number;
            remediation_chunk_id: string | null;
          }
        | Array<{
            misconception_code: string;
            misconception_label: string;
            distractor_index: number;
            remediation_chunk_id: string | null;
          }>
        | null;
    };
    const misconceptionRaw = (misconceptionsRes.data ?? []) as unknown as MisconceptionJoinRow[];
    const misconceptionAgg: Record<string, { code: string; label: string; count: number; questionIds: Set<string> }> = {};
    for (const row of misconceptionRaw) {
      const qm = Array.isArray(row.question_misconceptions)
        ? row.question_misconceptions
        : (row.question_misconceptions ? [row.question_misconceptions] : []);
      for (const m of qm) {
        if (m.distractor_index !== row.selected_option) continue;
        if (!misconceptionAgg[m.misconception_code]) {
          misconceptionAgg[m.misconception_code] = {
            code: m.misconception_code,
            label: m.misconception_label,
            count: 0,
            questionIds: new Set<string>(),
          };
        }
        misconceptionAgg[m.misconception_code].count += 1;
        misconceptionAgg[m.misconception_code].questionIds.add(row.question_id);
      }
    }
    const topMisconceptions = Object.values(misconceptionAgg)
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);

    const misconceptions: Array<{ code: string; label: string; count: number; remediationText: string }> = [];
    for (const m of topMisconceptions) {
      let remediationText = '';
      try {
        const qIds = Array.from(m.questionIds);
        if (qIds.length > 0) {
          const { data: remRows } = await supabaseAdmin
            .from('wrong_answer_remediations')
            .select('remediation_text')
            .in('question_id', qIds)
            .limit(1);
          remediationText = remRows?.[0]?.remediation_text ?? '';
        }
      } catch {
        // non-fatal
      }
      misconceptions.push({
        code: m.code,
        label: m.label,
        count: m.count,
        remediationText: remediationText.slice(0, 200),
      });
    }

    return { loSkills, misconceptions };
  } catch (err) {
    logger.warn('workflow_cognitive_context_loader_failed', {
      error: err instanceof Error ? err.message : String(err),
      studentId,
    });
    return { loSkills: [], misconceptions: [] };
  }
}
