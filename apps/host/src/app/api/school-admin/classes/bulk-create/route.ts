/**
 * POST /api/school-admin/classes/bulk-create — Track A.4
 *
 * Day-1 bulk class creation for a school admin. Two input modes:
 *
 *   1) Explicit list:
 *      { classes: [{ grade, section, academic_year?, name?, subject?, max_students? }, ...] }
 *
 *   2) Template preset (grades × sections grid):
 *      { template: { grades?: string[], sections?: string[], academic_year? } }
 *      Defaults: grades "6".."12", sections A–D → 28 classes.
 *
 * Idempotent: a class already present for (school_id, grade, section,
 * academic_year) is reported `skipped: already_exists` and never duplicated.
 *
 * Permission: class.manage (the closest existing class-management permission).
 * Tenant isolation: school_id comes ONLY from authorizeSchoolAdmin — never the
 * body. Grades are STRINGS (P5). Logs carry counts + indices + codes only (P13).
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeSchoolAdmin } from '@alfanumrik/lib/school-admin-auth';
import { getSupabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import { logSchoolAudit } from '@alfanumrik/lib/audit';
import {
  MAX_BULK_CLASSES,
  VALID_GRADES,
  TEMPLATE_SECTIONS,
  validateClassRow,
  classKey,
  type RowResult,
  type NormalizedClass,
} from '@alfanumrik/lib/school-admin/bulk-roster';

const ExplicitSchema = z.object({
  classes: z
    .array(z.record(z.string(), z.unknown()))
    .min(1)
    .max(MAX_BULK_CLASSES),
});

const TemplateSchema = z.object({
  template: z.object({
    grades: z.array(z.string()).optional(),
    sections: z.array(z.string()).optional(),
    academic_year: z.string().optional(),
  }),
});

export async function POST(request: NextRequest) {
  const auth = await authorizeSchoolAdmin(request, 'class.manage');
  if (!auth.authorized) return auth.errorResponse!;
  const schoolId = auth.schoolId!;
  const supabase = getSupabaseAdmin();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  // ── Resolve the requested class list (explicit OR template preset) ──────────
  let rawRows: Record<string, unknown>[];
  const tmpl = TemplateSchema.safeParse(body);
  const explicit = ExplicitSchema.safeParse(body);

  if (explicit.success) {
    rawRows = explicit.data.classes;
  } else if (tmpl.success) {
    const grades = (tmpl.data.template.grades && tmpl.data.template.grades.length > 0
      ? tmpl.data.template.grades
      : [...VALID_GRADES]
    ).map(String);
    const sections =
      tmpl.data.template.sections && tmpl.data.template.sections.length > 0
        ? tmpl.data.template.sections
        : [...TEMPLATE_SECTIONS];
    const academicYear = tmpl.data.template.academic_year || '2026-27';
    rawRows = [];
    for (const g of grades) {
      for (const s of sections) {
        rawRows.push({ grade: g, section: s, academic_year: academicYear });
      }
    }
  } else {
    return NextResponse.json(
      {
        success: false,
        error:
          'Provide either { classes: [...] } or { template: { grades?, sections?, academic_year? } }.',
      },
      { status: 400 },
    );
  }

  if (rawRows.length > MAX_BULK_CLASSES) {
    return NextResponse.json(
      {
        success: false,
        error: `Maximum ${MAX_BULK_CLASSES} classes per request. Split the request.`,
      },
      { status: 413 },
    );
  }

  // ── Validate every row first (no writes yet) ───────────────────────────────
  const normalized: Array<{ index: number; value: NormalizedClass } | { index: number; code: RowResult['code'] }> = [];
  for (let i = 0; i < rawRows.length; i++) {
    const v = validateClassRow(rawRows[i]);
    if (v.ok) normalized.push({ index: i, value: v.value });
    else normalized.push({ index: i, code: v.code });
  }

  // ── Load existing classes for idempotency dedupe (tenant-scoped) ───────────
  const { data: existing } = await supabase
    .from('classes')
    .select('id, grade, section, academic_year')
    .eq('school_id', schoolId)
    .is('deleted_at', null);

  const existingKeys = new Map<string, string>();
  for (const c of existing ?? []) {
    const row = c as { id: string; grade: string; section: string | null; academic_year: string | null };
    existingKeys.set(
      classKey({ grade: row.grade, section: row.section ?? '', academic_year: row.academic_year ?? '' }),
      row.id,
    );
  }

  const results: RowResult[] = [];
  const seenInBatch = new Set<string>();
  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const entry of normalized) {
    if (!('value' in entry)) {
      results.push({ index: entry.index, status: 'failed', code: entry.code });
      failed++;
      continue;
    }
    const cls = entry.value;
    const key = classKey(cls);

    // Dedupe within the same request.
    if (seenInBatch.has(key)) {
      results.push({ index: entry.index, status: 'skipped', code: 'duplicate_in_batch' });
      skipped++;
      continue;
    }
    seenInBatch.add(key);

    // Idempotent skip against existing rows.
    const existingId = existingKeys.get(key);
    if (existingId) {
      results.push({ index: entry.index, status: 'skipped', code: 'already_exists', id: existingId });
      skipped++;
      continue;
    }

    const autoCode = `${cls.grade}-${cls.section}-${cls.academic_year}`;
    const { data: inserted, error: insertErr } = await supabase
      .from('classes')
      .insert({
        school_id: schoolId,
        name: cls.name,
        grade: cls.grade, // P5: string
        section: cls.section,
        academic_year: cls.academic_year,
        subject: cls.subject,
        class_code: autoCode,
        max_students: cls.max_students,
        created_by: auth.userId,
        is_active: true,
      })
      .select('id')
      .single();

    if (insertErr || !inserted) {
      results.push({ index: entry.index, status: 'failed', code: 'create_failed' });
      failed++;
      continue;
    }
    existingKeys.set(key, inserted.id);
    results.push({ index: entry.index, status: 'created', code: 'created', id: inserted.id });
    created++;
  }

  // P13: counts + flags only — never the class names/sections in logs.
  logger.info('school_admin_classes_bulk_create', {
    route: '/api/school-admin/classes/bulk-create',
    total: rawRows.length,
    created,
    skipped,
    failed,
  });

  void logSchoolAudit({
    schoolId,
    actorId: auth.userId ?? 'unknown',
    action: 'class.created',
    resourceType: 'class',
    resourceId: 'bulk',
    metadata: { source: 'bulk_create', total: rawRows.length, created, skipped, failed },
    ipAddress: request.headers.get('x-forwarded-for') ?? undefined,
  });

  return NextResponse.json({
    success: true,
    data: { total: rawRows.length, created, skipped, failed, rows: results },
  });
}
