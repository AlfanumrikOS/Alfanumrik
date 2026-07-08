/**
 * /api/super-admin/readiness-rubric
 *
 * Phase 4 of "Exam-Ready 360°". Lets super-admins read and update the
 * rubric thresholds + score weights without a migration. Backed by the
 * `readiness_rubric_config` table (single-row, id=1).
 *
 *   GET   — return current config + defaults (for the tuning UI)
 *   PATCH — update one or more fields; CHECK constraints in the table
 *           enforce monotone tiers + weights summing to 1.0.
 *
 * Auth: super-admin only via authorizeAdmin. Every PATCH is audit-logged
 * with the diff so changes are traceable.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, logAdminAudit } from '@alfanumrik/lib/admin-auth';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';

interface RubricConfig {
  ready_mastered_ratio: number;
  ready_quiz_avg: number;
  ready_spaced_reviews: number;
  almost_mastered_ratio: number;
  almost_quiz_avg: number;
  almost_spaced_reviews: number;
  building_mastered_ratio: number;
  building_quiz_count: number;
  weight_mastery: number;
  weight_recent_quiz: number;
  weight_spaced_reviews: number;
  updated_at?: string;
  updated_by?: string | null;
}

// Defaults shipped in the migration. Returned alongside the current row so
// the tuning UI can render a "reset to defaults" button.
const DEFAULTS: RubricConfig = {
  ready_mastered_ratio: 0.85,
  ready_quiz_avg: 80,
  ready_spaced_reviews: 3,
  almost_mastered_ratio: 0.70,
  almost_quiz_avg: 60,
  almost_spaced_reviews: 1,
  building_mastered_ratio: 0.40,
  building_quiz_count: 1,
  weight_mastery: 0.50,
  weight_recent_quiz: 0.30,
  weight_spaced_reviews: 0.20,
};

const FIELD_NAMES = Object.keys(DEFAULTS) as Array<keyof typeof DEFAULTS>;

// ─── GET ────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const auth = await authorizeAdmin(request, 'support');
  if (!auth.authorized) return auth.response;

  try {
    const { data, error } = await supabaseAdmin
      .from('readiness_rubric_config')
      .select('*')
      .eq('id', 1)
      .single();

    if (error) {
      logger.error('readiness-rubric: GET failed', { error: error.message });
      return NextResponse.json(
        { success: false, error: 'Failed to load rubric config' },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        config: data as RubricConfig,
        defaults: DEFAULTS,
      },
    });
  } catch (err) {
    logger.error('readiness-rubric: GET unhandled', {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 },
    );
  }
}

// ─── PATCH ──────────────────────────────────────────────────────────────────

export async function PATCH(request: NextRequest) {
  const auth = await authorizeAdmin(request, 'support');
  if (!auth.authorized) return auth.response;

  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON body' },
        { status: 400 },
      );
    }

    // Allowlist incoming fields; reject anything not in DEFAULTS.
    const updates: Partial<RubricConfig> = {};
    for (const key of FIELD_NAMES) {
      if (key in body) {
        const v = body[key];
        if (typeof v !== 'number' || !Number.isFinite(v)) {
          return NextResponse.json(
            { success: false, error: `Field ${key} must be a finite number` },
            { status: 400 },
          );
        }
        // Type-narrow: every entry in DEFAULTS is a number. Cast through
        // unknown to keep TS happy without a per-field switch.
        (updates as Record<string, number>)[key] = v;
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { success: false, error: 'No valid fields to update' },
        { status: 400 },
      );
    }

    // Load existing row for diff (audit log).
    const { data: before } = await supabaseAdmin
      .from('readiness_rubric_config')
      .select('*')
      .eq('id', 1)
      .single();

    const { data: updated, error } = await supabaseAdmin
      .from('readiness_rubric_config')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
        updated_by: auth.userId,
      })
      .eq('id', 1)
      .select('*')
      .single();

    if (error) {
      // CHECK constraints surface here — the message includes the constraint
      // name (chk_tier_monotone_ratio etc.) which is useful client-side.
      const isConstraintError =
        typeof error.message === 'string' &&
        (error.message.includes('chk_') || error.message.includes('check constraint'));
      logger.warn('readiness-rubric: PATCH validation failed', {
        error: error.message,
        adminId: auth.adminId,
        constraint: isConstraintError,
      });
      return NextResponse.json(
        {
          success: false,
          error: isConstraintError
            ? 'Update violates a tier or weight constraint'
            : 'Failed to update rubric config',
          detail: error.message,
        },
        { status: isConstraintError ? 422 : 500 },
      );
    }

    // Audit log: capture before/after of the changed fields only (keeps
    // the audit row small and the diff legible).
    const diff: Record<string, { from: unknown; to: unknown }> = {};
    for (const key of Object.keys(updates) as Array<keyof RubricConfig>) {
      diff[key] = {
        from: before ? (before as RubricConfig)[key] : undefined,
        to: (updated as RubricConfig)[key],
      };
    }

    await logAdminAudit(
      auth,
      'readiness_rubric_updated',
      'readiness_rubric_config',
      '1',
      { diff },
      request.headers.get('x-forwarded-for') ?? undefined,
    );

    return NextResponse.json({
      success: true,
      data: {
        config: updated as RubricConfig,
        defaults: DEFAULTS,
      },
    });
  } catch (err) {
    logger.error('readiness-rubric: PATCH unhandled', {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 },
    );
  }
}
