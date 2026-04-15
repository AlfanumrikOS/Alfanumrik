import type { Subject, SubjectWriteError, SubjectCode, OkOr } from './subjects.types';

interface ServerCtx {
  supabase: {
    rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: any; error: any }>;
  };
}

type RawSubject = {
  code: string; name: string; name_hi: string | null;
  icon: string; color: string; subject_kind: 'cbse_core' | 'cbse_elective' | 'platform_elective';
  is_core: boolean; is_locked: boolean;
};

function toSubject(r: RawSubject): Subject {
  return {
    code: r.code,
    name: r.name,
    nameHi: r.name_hi ?? r.name,
    icon: r.icon,
    color: r.color,
    subjectKind: r.subject_kind,
    isCore: r.is_core,
    isLocked: r.is_locked,
  };
}

export async function getAllowedSubjectsForStudent(
  studentId: string,
  ctx: ServerCtx,
): Promise<Subject[]> {
  const { data, error } = await ctx.supabase.rpc('get_available_subjects', {
    p_student_id: studentId,
  });
  if (error) throw error;
  return ((data ?? []) as RawSubject[]).map(toSubject);
}

export async function validateSubjectWrite(
  studentId: string,
  subjectCode: SubjectCode,
  ctx: ServerCtx,
): Promise<OkOr<SubjectWriteError>> {
  const subjects = await getAllowedSubjectsForStudent(studentId, ctx);
  const match = subjects.find((s) => s.code === subjectCode);
  if (!match) {
    return { ok: false, error: { code: 'subject_not_allowed', subject: subjectCode, reason: 'grade', allowed: subjects.filter(s => !s.isLocked).map(s => s.code) } };
  }
  if (match.isLocked) {
    return { ok: false, error: { code: 'subject_not_allowed', subject: subjectCode, reason: 'plan', allowed: subjects.filter(s => !s.isLocked).map(s => s.code) } };
  }
  return { ok: true };
}

export async function validateSubjectsBulk(
  studentId: string,
  subjects: SubjectCode[],
  ctx: ServerCtx,
): Promise<OkOr<SubjectWriteError>> {
  const allowed = await getAllowedSubjectsForStudent(studentId, ctx);
  const allowedSet = new Set(allowed.filter(s => !s.isLocked).map(s => s.code));
  for (const s of subjects) {
    if (!allowedSet.has(s)) {
      const match = allowed.find(x => x.code === s);
      return {
        ok: false,
        error: {
          code: 'subject_not_allowed',
          subject: s,
          reason: match?.isLocked ? 'plan' : 'grade',
          allowed: Array.from(allowedSet),
        },
      };
    }
  }
  return { ok: true };
}
