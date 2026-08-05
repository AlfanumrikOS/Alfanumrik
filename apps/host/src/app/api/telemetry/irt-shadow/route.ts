/**
 * POST /api/telemetry/irt-shadow — Foxy North-Star Phase 3 (ai-engineer
 * shadow-selection instrumentation sink).
 *
 * The client-side IRT shadow selector (gated on ff_irt_shadow_v1) computes a
 * divergence reading between the live question-selection ranking and the
 * IRT-scored shadow ranking, then POSTs it here:
 *
 *   { theta, nCandidates, nCalibrated, spearmanRho, top5Overlap,
 *     top10Overlap, subject, grade }
 *
 * This route is a WRITE-ONLY telemetry sink:
 *   - authorizeRequest('progress.view_own', { requireStudentId: true }) —
 *     only an authenticated student writes their own reading.
 *   - zod validation: every numeric field must be finite and in range
 *     (NaN / Infinity / out-of-range → 400; zod's z.number() rejects
 *     NaN/Infinity by construction).
 *   - ff_irt_shadow_v1 is RE-CHECKED SERVER-SIDE — the client is not
 *     trusted to gate writes. Flag OFF → the reading is dropped (no write).
 *   - Sink: logSystemMetric('irt_shadow_divergence', value = spearmanRho,
 *     tags = UUIDs + numbers + short subject/grade codes only — P13).
 *   - Response is ALWAYS 204 once auth + validation pass, regardless of
 *     flag state or sink success — telemetry must never surface an error
 *     into the student's quiz flow.
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { isFeatureEnabled } from '@alfanumrik/lib/feature-flags';
import { logSystemMetric } from '@alfanumrik/lib/monitoring/log-event';
import { logger } from '@alfanumrik/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Server-side gate for the IRT shadow-selection telemetry lane. */
const IRT_SHADOW_FLAG = 'ff_irt_shadow_v1';

// z.number() already rejects NaN and ±Infinity; ranges bound the rest.
const RequestSchema = z.object({
  // IRT ability estimate — calibrated thetas live well inside ±6.
  theta: z.number().min(-6).max(6),
  nCandidates: z.number().int().min(0).max(100_000),
  nCalibrated: z.number().int().min(0).max(100_000),
  // Spearman rank correlation is bounded by definition.
  spearmanRho: z.number().min(-1).max(1),
  // Overlap ratios (0..1).
  top5Overlap: z.number().min(0).max(1),
  top10Overlap: z.number().min(0).max(1),
  subject: z.string().min(1).max(64),
  // P5: grades are strings "6".."12".
  grade: z.string().regex(/^(?:[6-9]|1[0-2])$/),
});

function noContent(): Response {
  return new Response(null, { status: 204 });
}

export async function POST(request: NextRequest): Promise<Response> {
  const auth = await authorizeRequest(request, 'progress.view_own', {
    requireStudentId: true,
  });
  if (!auth.authorized) return auth.errorResponse!;
  if (!auth.studentId) {
    return new Response(
      JSON.stringify({ success: false, error: 'no_student_profile' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } },
    );
  }

  let body: z.infer<typeof RequestSchema>;
  try {
    body = RequestSchema.parse(await request.json());
  } catch {
    return new Response(
      JSON.stringify({ success: false, error: 'invalid_body' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // SERVER-SIDE flag re-check — the client's own gate is not trusted for
  // writes. OFF → drop silently (still 204: telemetry is never an error).
  let flagOn = false;
  try {
    flagOn = await isFeatureEnabled(IRT_SHADOW_FLAG, {
      userId: auth.userId ?? undefined,
      role: 'student',
      environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
    });
  } catch {
    flagOn = false; // fail-closed: no write on flag-eval failure
  }
  if (!flagOn) return noContent();

  // Sink — fire-and-forget semantics: logSystemMetric never throws, and even
  // a pathological failure must not change the client-visible outcome.
  try {
    await logSystemMetric({
      metric_name: 'irt_shadow_divergence',
      value: body.spearmanRho,
      // P13: UUIDs + numbers + short curriculum codes ONLY — never names,
      // emails, phones, or free text.
      tags: {
        studentId: auth.studentId,
        subject: body.subject,
        grade: body.grade,
        nCandidates: body.nCandidates,
        nCalibrated: body.nCalibrated,
        top5Overlap: body.top5Overlap,
        top10Overlap: body.top10Overlap,
        theta: body.theta,
      },
    });
  } catch (err) {
    logger.warn('telemetry/irt-shadow: sink failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return noContent();
}
