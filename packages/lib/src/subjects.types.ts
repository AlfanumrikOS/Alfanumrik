export type SubjectCode = string;
export type Stream = 'science' | 'commerce' | 'humanities' | null;
export type PlanCode = 'free' | 'starter' | 'pro' | 'unlimited';

export interface Subject {
  code: SubjectCode;
  name: string;
  nameHi: string;
  icon: string;
  color: string;
  subjectKind: 'cbse_core' | 'cbse_elective' | 'platform_elective';
  isCore: boolean;
  isLocked: boolean;
}

export type SubjectWriteErrorReason =
  | 'grade' | 'stream' | 'plan' | 'inactive' | 'unknown' | 'max_subjects';

export interface SubjectWriteError {
  code: 'subject_not_allowed';
  subject: string;
  reason: SubjectWriteErrorReason;
  allowed: SubjectCode[];
}

export type OkOr<E> = { ok: true } | { ok: false; error: E };
