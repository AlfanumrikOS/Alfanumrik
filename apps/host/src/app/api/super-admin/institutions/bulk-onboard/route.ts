/**
 * POST /api/super-admin/institutions/bulk-onboard
 *
 * Super-admin endpoint for bulk-provisioning trial schools from a CSV.
 *
 * Body:
 *   {
 *     csv: string,           // raw CSV text including header row
 *     dry_run: boolean,      // when true, validate + duplicate-check only
 *     csv_filename?: string, // surfaced in audit log + per-row events
 *   }
 *
 * Expected columns (case-insensitive, order-independent):
 *   school_name, principal_name, principal_email, phone, board, city, state,
 *   grade_range_min, grade_range_max, admin_email
 *
 * Behaviour:
 *   - All-or-nothing: NO. Each row is processed independently; partial
 *     successes are returned to the operator.
 *   - Duplicates (school email already in `schools`) are reported as
 *     `skipped: 'already_exists'`, NEVER `failed` — so re-running with the
 *     same CSV is safe.
 *   - Hard cap of 200 rows per CSV — larger uploads must be split (or wait
 *     for the future Edge-Function async path, tracked as backlog).
 *   - `dry_run === true` fires NO email and writes NO database rows; it
 *     reports the would-be outcomes only. Invite emails fire only on the
 *     real commit path because `provisionTrialSchool` is called with
 *     `sendEmail: false` during dry-run (and not called at all for skips).
 *   - Audit: writes `super_admin.bulk_onboard_started` + `_completed` for
 *     the overall operation, and `school.bulk_onboarded` per created row.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, logAdminAudit } from '@alfanumrik/lib/admin-auth';
import { getSupabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import {
  provisionTrialSchool,
  validateEmail,
} from '@alfanumrik/lib/school-provisioning';
import { MAX_ROWS_PER_CSV, type RowStatus } from './constants';

// ─── Constants ────────────────────────────────────────────────────────

const REQUIRED_COLUMNS = [
  'school_name',
  'principal_name',
  'principal_email',
] as const;

const OPTIONAL_COLUMNS = [
  'phone',
  'board',
  'city',
  'state',
  'grade_range_min',
  'grade_range_max',
  'admin_email',
] as const;

interface RowOutcome {
  row_index: number;
  status: RowStatus;
  school_id?: string;
  reason?: string; // for skipped (e.g. 'already_exists')
  error?: string;  // for failed
}

interface BulkOnboardResponse {
  total: number;
  created: number;
  skipped: number;
  failed: number;
  rows: RowOutcome[];
  dry_run: boolean;
}

// ─── CSV parsing (header-aware, quote-aware) ──────────────────────────

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result.map((s) => s.trim());
}

interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
}

function parseCsv(text: string): ParsedCsv | { error: string } {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/^﻿/, '')) // strip BOM
    .filter((l) => l.trim().length > 0);

  if (lines.length < 2) {
    return { error: 'CSV must include a header row and at least one data row.' };
  }

  const headers = parseCSVLine(lines[0]).map((h) => h.toLowerCase());
  const missing = REQUIRED_COLUMNS.filter((c) => !headers.includes(c));
  if (missing.length > 0) {
    return { error: `Missing required columns: ${missing.join(', ')}` };
  }

  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCSVLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = (cells[idx] ?? '').trim();
    });
    rows.push(row);
  }
  return { headers, rows };
}

// ─── Per-row validation (mirrors provisionTrialSchool but reported early) ──

function preValidateRow(row: Record<string, string>): string | null {
  if (!row.school_name || row.school_name.length < 2) {
    return 'school_name is required (min 2 chars).';
  }
  if (row.school_name.length > 200) {
    return 'school_name exceeds 200 character maximum.';
  }
  if (!row.principal_name || row.principal_name.length < 2) {
    return 'principal_name is required (min 2 chars).';
  }
  if (row.principal_name.length > 100) {
    return 'principal_name exceeds 100 character maximum.';
  }
  if (!row.principal_email) {
    return 'principal_email is required.';
  }
  if (row.principal_email.length > 254 || !validateEmail(row.principal_email)) {
    return 'principal_email is not a valid email address.';
  }
  if (row.admin_email && !validateEmail(row.admin_email)) {
    return 'admin_email is not a valid email address.';
  }
  // grade_range bounds — strict 6..12 to match Alfanumrik scope
  if (row.grade_range_min || row.grade_range_max) {
    const min = Number(row.grade_range_min);
    const max = Number(row.grade_range_max);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min < 6 || max > 12 || min > max) {
      return 'grade_range_min / grade_range_max must be integers in 6..12 with min <= max.';
    }
  }
  return null;
}

// ─── Pre-flight duplicate scan (one query per email) ──────────────────

async function emailAlreadyTaken(email: string): Promise<boolean> {
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from('schools')
    .select('id')
    .eq('email', email.toLowerCase())
    .maybeSingle();
  return Boolean(data);
}

// ─── POST handler ─────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // Bulk-creates up to 200 trial schools per call. Matches /provision's gate.
  const auth = await authorizeAdmin(request, 'super_admin');
  if (!auth.authorized) return auth.response;

  let body: { csv?: unknown; dry_run?: unknown; csv_filename?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON body. Expected { csv: string, dry_run: boolean }.' },
      { status: 400 },
    );
  }

  if (typeof body.csv !== 'string' || body.csv.trim().length === 0) {
    return NextResponse.json(
      { success: false, error: 'csv (string) is required.' },
      { status: 400 },
    );
  }
  const dryRun = body.dry_run === true; // default false; only the explicit boolean opts in
  const csvFilename =
    typeof body.csv_filename === 'string' && body.csv_filename.trim().length > 0
      ? body.csv_filename.trim()
      : 'inline.csv';

  const parsed = parseCsv(body.csv);
  if ('error' in parsed) {
    return NextResponse.json({ success: false, error: parsed.error }, { status: 400 });
  }

  if (parsed.rows.length === 0) {
    return NextResponse.json(
      { success: false, error: 'CSV contained a header but no data rows.' },
      { status: 400 },
    );
  }
  if (parsed.rows.length > MAX_ROWS_PER_CSV) {
    return NextResponse.json(
      {
        success: false,
        error: `Maximum ${MAX_ROWS_PER_CSV} rows per CSV. Split the file and re-upload.`,
        rate_limit_reason: 'csv_row_cap',
      },
      { status: 413 },
    );
  }

  // Audit start (best-effort). Includes filename + row count + dry_run flag.
  await logAdminAudit(
    auth,
    'super_admin.bulk_onboard_started',
    'bulk_onboard',
    csvFilename,
    {
      csv_filename: csvFilename,
      row_count: parsed.rows.length,
      dry_run: dryRun,
    },
    request.headers.get('x-forwarded-for') || undefined,
  );

  const outcomes: RowOutcome[] = [];
  let created = 0;
  let skipped = 0;
  let failed = 0;

  // Track within-batch duplicates so two rows with the same email don't both
  // attempt to create the same school (the second would get a unique-violation
  // failure from the DB — that's noise; we'd rather report 'already_exists').
  const seenEmails = new Set<string>();

  for (let i = 0; i < parsed.rows.length; i++) {
    const row = parsed.rows[i];
    const rowIndex = i + 2; // +2 because row 1 = header; humans count from 1

    // 1. Pre-validate before any DB call
    const validationError = preValidateRow(row);
    if (validationError) {
      outcomes.push({ row_index: rowIndex, status: 'failed', error: validationError });
      failed++;
      continue;
    }

    const email = row.principal_email.toLowerCase();

    // 2. Detect duplicates inside the same CSV
    if (seenEmails.has(email)) {
      outcomes.push({
        row_index: rowIndex,
        status: 'skipped',
        reason: 'duplicate_in_csv',
      });
      skipped++;
      continue;
    }
    seenEmails.add(email);

    // 3. Detect duplicates already in the schools table
    try {
      if (await emailAlreadyTaken(email)) {
        outcomes.push({
          row_index: rowIndex,
          status: 'skipped',
          reason: 'already_exists',
        });
        skipped++;
        continue;
      }
    } catch (err) {
      // Treat lookup failures as a row-level failure rather than aborting the
      // batch — operators can re-run after the DB is healthy and the
      // idempotency check above will skip anything that did make it through.
      outcomes.push({
        row_index: rowIndex,
        status: 'failed',
        error: err instanceof Error ? err.message : 'duplicate-check failed',
      });
      failed++;
      continue;
    }

    // 4. Dry-run: stop here and report as would-be-created
    if (dryRun) {
      outcomes.push({ row_index: rowIndex, status: 'created' });
      created++;
      continue;
    }

    // 5. Real provisioning. sendEmail defaults to true on the helper — the
    //    transactional email fires here, NEVER on the dry-run path above.
    try {
      const result = await provisionTrialSchool({
        school_name: row.school_name,
        principal_name: row.principal_name,
        principal_email: row.principal_email,
        board: row.board || null,
        city: row.city || null,
        state: row.state || null,
        phone: row.phone || null,
        sendEmail: true,
        // Attribute the principal's school_admins link to the super-admin actor.
        invitedBy: auth.userId,
      });

      if (result.status === 'created') {
        outcomes.push({
          row_index: rowIndex,
          status: 'created',
          school_id: result.school_id,
        });
        created++;

        // Per-row audit so the audit log shows which schools came from which
        // CSV. Done sequentially to keep ordering predictable; if this proves
        // too slow on 200-row uploads we can move to Promise.all.
        await logAdminAudit(
          auth,
          'school.bulk_onboarded',
          'school',
          result.school_id,
          {
            csv_filename: csvFilename,
            row_index: rowIndex,
            actor_id: auth.adminId,
            slug: result.slug,
          },
        );
      } else if (result.status === 'already_exists') {
        // Race: another concurrent caller created the same school between our
        // pre-check and the helper's. Still report as skipped.
        outcomes.push({
          row_index: rowIndex,
          status: 'skipped',
          reason: 'already_exists',
        });
        skipped++;
      } else if (result.status === 'validation_error') {
        outcomes.push({ row_index: rowIndex, status: 'failed', error: result.error });
        failed++;
      } else {
        outcomes.push({ row_index: rowIndex, status: 'failed', error: result.error });
        failed++;
      }
    } catch (err) {
      logger.error('bulk_onboard_row_unexpected_error', {
        error: err instanceof Error ? err : new Error(String(err)),
        rowIndex,
      });
      outcomes.push({
        row_index: rowIndex,
        status: 'failed',
        error: err instanceof Error ? err.message : 'Unexpected provisioning error.',
      });
      failed++;
    }
  }

  // Audit end
  await logAdminAudit(
    auth,
    'super_admin.bulk_onboard_completed',
    'bulk_onboard',
    csvFilename,
    {
      csv_filename: csvFilename,
      row_count: parsed.rows.length,
      created,
      skipped,
      failed,
      dry_run: dryRun,
    },
  );

  const response: BulkOnboardResponse = {
    total: parsed.rows.length,
    created,
    skipped,
    failed,
    rows: outcomes,
    dry_run: dryRun,
  };

  return NextResponse.json({ success: true, data: response });
}
