import { NextRequest, NextResponse } from 'next/server';
import {
  authorizeAdmin,
  logAdminAudit,
  isValidUUID,
} from '../../../../../../lib/admin-auth';
import { supabaseAdmin } from '../../../../../../lib/supabase-admin';
import { z } from 'zod';

/**
 * Admin override of a student's subject enrollment.
 *
 * PATCH /api/super-admin/students/[id]/subjects
 *
 * Body:
 *   { subjects: string[],   // canonical subject codes
 *     preferred?: string,   // must be one of subjects
 *     reason: string,       // non-empty justification (>=10 chars normal, >=50 if force=true)
 *     force?: boolean }     // bypass trigger validation for emergency reinstatement
 *
 * Implementation:
 *   1. Validate input.
 *   2. Verify all subject codes exist in subjects table (422 if any unknown).
 *   3. Snapshot current enrollment for audit ("before").
 *   4. Try set_student_subjects RPC; if missing or force=true, fall back to
 *      direct upsert into student_subject_enrollment with source='admin'.
 *   5. Update students.selected_subjects + preferred_subject for backwards
 *      compatibility with the student-facing UI.
 *   6. Audit log: subject_enrollment.admin_edit (or _forced) with before/after.
 *
 * Phase E (Subject Governance) — backend.
 */

const SNAKE_CASE = /^[a-z][a-z0-9_]{1,63}$/;

const patchSchema = z
  .object({
    subjects: z
      .array(z.string().regex(SNAKE_CASE, 'subject code must be snake_case'))
      .min(1, 'At least one subject required')
      .max(20, 'No more than 20 subjects'),
    preferred: z.string().regex(SNAKE_CASE).optional(),
    reason: z.string().min(1),
    force: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.preferred && !data.subjects.includes(data.preferred)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'preferred must be one of subjects',
        path: ['preferred'],
      });
    }
    const minReason = data.force ? 50 : 10;
    if (data.reason.trim().length < minReason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `reason must be at least ${minReason} characters${
          data.force ? ' when force=true' : ''
        }`,
        path: ['reason'],
      });
    }
  });

async function verifySubjectsExist(codes: string[]): Promise<string[]> {
  if (codes.length === 0) return [];
  const { data } = await supabaseAdmin
    .from('subjects')
    .select('code, is_active')
    .in('code', codes);
  const known = new Set((data as Array<{ code: string; is_active: boolean }> | null)?.map((r) => r.code) || []);
  return codes.filter((c) => !known.has(c));
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  const { id: studentId } = await params;
  if (!isValidUUID(studentId)) {
    return NextResponse.json({ error: 'Invalid student ID' }, { status: 400 });
  }

  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid body', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { subjects, preferred, reason, force } = parsed.data;
    const dedupedSubjects = Array.from(new Set(subjects));

    // Verify student exists
    const { data: studentRow } = await supabaseAdmin
      .from('students')
      .select('id, grade, stream, selected_subjects, preferred_subject')
      .eq('id', studentId)
      .maybeSingle();

    if (!studentRow) {
      return NextResponse.json({ error: 'Student not found' }, { status: 404 });
    }

    // Verify subject codes exist
    const unknown = await verifySubjectsExist(dedupedSubjects);
    if (unknown.length > 0) {
      return NextResponse.json(
        { error: `Unknown subject_code(s): ${unknown.join(', ')}` },
        { status: 422 }
      );
    }

    // Snapshot before
    const { data: beforeEnrollment } = await supabaseAdmin
      .from('student_subject_enrollment')
      .select('subject_code, is_locked, source')
      .eq('student_id', studentId);

    const before = {
      enrollment: beforeEnrollment || [],
      selected_subjects: studentRow.selected_subjects || [],
      preferred_subject: studentRow.preferred_subject || null,
    };

    // Apply
    let appliedVia = 'rpc';
    if (!force) {
      const rpc = await supabaseAdmin.rpc('set_student_subjects' as never, {
        p_student_id: studentId,
        p_subjects: dedupedSubjects,
        p_preferred: preferred ?? null,
        p_source: 'admin',
      } as never);
      if (rpc.error) {
        appliedVia = 'direct';
      }
    } else {
      appliedVia = 'direct_force';
    }

    if (appliedVia.startsWith('direct')) {
      // Direct path: replace enrollment rows.
      // Delete then insert in a single batch.
      await supabaseAdmin
        .from('student_subject_enrollment')
        .delete()
        .eq('student_id', studentId);

      const inserts = dedupedSubjects.map((code) => ({
        student_id: studentId,
        subject_code: code,
        source: 'admin',
        is_locked: false,
      }));

      const { error: insertErr } = await supabaseAdmin
        .from('student_subject_enrollment')
        .insert(inserts);

      if (insertErr) {
        return NextResponse.json(
          { error: `Direct enrollment write failed: ${insertErr.message}` },
          { status: 500 }
        );
      }
    }

    // Always sync students.selected_subjects + preferred_subject for
    // backwards compatibility with the student-facing UI.
    const { error: profErr } = await supabaseAdmin
      .from('students')
      .update({
        selected_subjects: dedupedSubjects,
        preferred_subject: preferred ?? dedupedSubjects[0] ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', studentId);

    if (profErr) {
      return NextResponse.json(
        { error: `Profile sync failed: ${profErr.message}` },
        { status: 500 }
      );
    }

    // Snapshot after
    const { data: afterEnrollment } = await supabaseAdmin
      .from('student_subject_enrollment')
      .select('subject_code, is_locked, source')
      .eq('student_id', studentId);

    const after = {
      enrollment: afterEnrollment || [],
      selected_subjects: dedupedSubjects,
      preferred_subject: preferred ?? dedupedSubjects[0] ?? null,
    };

    await logAdminAudit(
      auth,
      force ? 'subject_enrollment.admin_edit_forced' : 'subject_enrollment.admin_edit',
      'student_subject_enrollment',
      studentId,
      { reason, force: !!force, applied_via: appliedVia, before, after }
    );

    return NextResponse.json({
      success: true,
      data: after,
      applied_via: appliedVia,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    );
  }
}
