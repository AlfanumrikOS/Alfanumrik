/**
 * POST /api/school-admin/roster/validate — Track A.4 DRY-RUN
 *
 * Validate a day-1 roster payload WITHOUT writing anything. Returns row-level
 * errors (bad grade, malformed email, missing/unknown class, duplicate) plus a
 * seat-capacity preview (seats the import needs vs remaining headroom).
 *
 * Body (all keys optional; validate whichever are present):
 *   {
 *     classes?:  [{ grade, section, academic_year?, ... }, ...],
 *     students?: [{ name, email, grade, section?|class_ref?, roll_number?, ... }, ...],
 *     teachers?: [{ name, email, subjects_taught?, grades_taught?, class_refs? }, ...]
 *   }
 *
 * NO DB WRITES. Reads only the caller's own classes (to resolve class refs) and
 * the seat-capacity snapshot. Permission: institution.manage_students (the
 * import the dry-run gates). Tenant isolation: school_id from
 * authorizeSchoolAdmin ONLY. P5: grades are strings. P13: logs carry counts
 * only — never PII.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeSchoolAdmin } from '@alfanumrik/lib/school-admin-auth';
import { getSupabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import {
  MAX_BULK_ROWS,
  MAX_BULK_CLASSES,
  validateStudentRow,
  validateTeacherRow,
  validateClassRow,
  classKey,
  loadClassIndex,
  resolveClassId,
  probeSeatCapacity,
  type RowResult,
} from '@alfanumrik/lib/school-admin/bulk-roster';

const BodySchema = z.object({
  classes: z.array(z.record(z.string(), z.unknown())).max(MAX_BULK_CLASSES).optional(),
  students: z.array(z.record(z.string(), z.unknown())).max(MAX_BULK_ROWS).optional(),
  teachers: z.array(z.record(z.string(), z.unknown())).max(MAX_BULK_ROWS).optional(),
});

export async function POST(request: NextRequest) {
  const auth = await authorizeSchoolAdmin(request, 'institution.manage_students');
  if (!auth.authorized) return auth.errorResponse!;
  const schoolId = auth.schoolId!;
  const supabase = getSupabaseAdmin();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error:
          'Body must be { classes?, students?, teachers? } with each array within its row cap.',
      },
      { status: 400 },
    );
  }
  const { classes = [], students = [], teachers = [] } = parsed.data;

  // ── Existing classes (tenant-scoped) for ref resolution + class dedupe ──────
  const classIndex = await loadClassIndex(schoolId);
  const { data: existingClasses } = await supabase
    .from('classes')
    .select('grade, section, academic_year')
    .eq('school_id', schoolId)
    .is('deleted_at', null);
  const existingClassKeys = new Set<string>();
  for (const c of existingClasses ?? []) {
    const row = c as { grade: string; section: string | null; academic_year: string | null };
    existingClassKeys.add(
      classKey({ grade: row.grade, section: row.section ?? '', academic_year: row.academic_year ?? '' }),
    );
  }

  // ── Validate classes ───────────────────────────────────────────────────────
  const classRows: RowResult[] = [];
  const seenClassKeys = new Set<string>();
  // Sections that WOULD exist after this import (existing + newly-validated) so
  // student/teacher class refs can resolve against to-be-created sections too.
  const prospectiveSections = new Set<string>(classIndex.bySection.keys());
  for (let i = 0; i < classes.length; i++) {
    const v = validateClassRow(classes[i]);
    if (!v.ok) {
      classRows.push({ index: i, status: 'failed', code: v.code });
      continue;
    }
    const key = classKey(v.value);
    if (seenClassKeys.has(key)) {
      classRows.push({ index: i, status: 'skipped', code: 'duplicate_in_batch' });
      continue;
    }
    seenClassKeys.add(key);
    prospectiveSections.add(v.value.section.toUpperCase());
    if (existingClassKeys.has(key)) {
      classRows.push({ index: i, status: 'skipped', code: 'already_exists' });
    } else {
      classRows.push({ index: i, status: 'created', code: 'created' });
    }
  }

  const refResolves = (ref: string | null): boolean => {
    if (!ref) return true; // no ref is allowed (student created unenrolled)
    if (resolveClassId(ref, classIndex)) return true;
    return prospectiveSections.has(ref.toUpperCase());
  };

  // ── Validate students ──────────────────────────────────────────────────────
  const studentRows: RowResult[] = [];
  const seenStudentEmails = new Set<string>();
  let studentsNeedingSeat = 0; // rows that would enroll into a class
  for (let i = 0; i < students.length; i++) {
    const v = validateStudentRow(students[i]);
    if (!v.ok) {
      studentRows.push({ index: i, status: 'failed', code: v.code });
      continue;
    }
    if (seenStudentEmails.has(v.value.email)) {
      studentRows.push({ index: i, status: 'skipped', code: 'duplicate_in_batch' });
      continue;
    }
    seenStudentEmails.add(v.value.email);
    if (v.value.class_ref && !refResolves(v.value.class_ref)) {
      studentRows.push({ index: i, status: 'failed', code: 'class_not_found' });
      continue;
    }
    if (v.value.class_ref) studentsNeedingSeat++;
    studentRows.push({ index: i, status: 'created', code: 'created' });
  }

  // ── Validate teachers ──────────────────────────────────────────────────────
  const teacherRows: RowResult[] = [];
  const seenTeacherEmails = new Set<string>();
  let teachersNeedingSeat = 0;
  for (let i = 0; i < teachers.length; i++) {
    const v = validateTeacherRow(teachers[i]);
    if (!v.ok) {
      teacherRows.push({ index: i, status: 'failed', code: v.code });
      continue;
    }
    if (seenTeacherEmails.has(v.value.email)) {
      teacherRows.push({ index: i, status: 'skipped', code: 'duplicate_in_batch' });
      continue;
    }
    seenTeacherEmails.add(v.value.email);
    const badRef = v.value.class_refs.find((r) => !refResolves(r));
    if (badRef) {
      teacherRows.push({ index: i, status: 'failed', code: 'class_not_found' });
      continue;
    }
    teachersNeedingSeat++; // every new active teacher consumes a seat
    teacherRows.push({ index: i, status: 'created', code: 'created' });
  }

  // ── Seat-capacity preview (read-only) ──────────────────────────────────────
  const probe = await probeSeatCapacity(schoolId);
  const seatsNeeded = studentsNeedingSeat + teachersNeedingSeat;
  let seatPreview: {
    ceiling: number | null;
    used: number | null;
    remaining: number | null;
    seats_needed: number;
    will_exceed: boolean;
    available: boolean;
  };
  if (probe.ok) {
    seatPreview = {
      ceiling: probe.snapshot.ceiling,
      used: probe.snapshot.used,
      remaining: probe.snapshot.remaining,
      seats_needed: seatsNeeded,
      will_exceed: seatsNeeded > probe.snapshot.remaining,
      available: true,
    };
  } else if (probe.reason === 'at_ceiling') {
    seatPreview = {
      ceiling: null,
      used: null,
      remaining: 0,
      seats_needed: seatsNeeded,
      will_exceed: seatsNeeded > 0,
      available: true,
    };
  } else {
    seatPreview = {
      ceiling: null,
      used: null,
      remaining: null,
      seats_needed: seatsNeeded,
      will_exceed: false,
      available: false, // seat check couldn't run; surface honestly
    };
  }

  const countByStatus = (rows: RowResult[], s: RowResult['status']) =>
    rows.filter((r) => r.status === s).length;

  // P13: counts only — never the validated PII.
  logger.info('school_admin_roster_validate', {
    route: '/api/school-admin/roster/validate',
    classes: classes.length,
    students: students.length,
    teachers: teachers.length,
    seats_needed: seatsNeeded,
  });

  return NextResponse.json({
    success: true,
    data: {
      dry_run: true,
      classes: {
        total: classes.length,
        valid: countByStatus(classRows, 'created') + countByStatus(classRows, 'skipped'),
        errors: countByStatus(classRows, 'failed'),
        rows: classRows,
      },
      students: {
        total: students.length,
        valid: countByStatus(studentRows, 'created') + countByStatus(studentRows, 'skipped'),
        errors: countByStatus(studentRows, 'failed'),
        rows: studentRows,
      },
      teachers: {
        total: teachers.length,
        valid: countByStatus(teacherRows, 'created') + countByStatus(teacherRows, 'skipped'),
        errors: countByStatus(teacherRows, 'failed'),
        rows: teacherRows,
      },
      seat_preview: seatPreview,
    },
  });
}
