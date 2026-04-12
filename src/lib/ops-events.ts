/**
 * Observability event writer for Next.js server-side code.
 *
 * Writes structured events to the ops_events table via supabaseAdmin
 * (service role — bypasses RLS, server-only).
 *
 * Behavior:
 * - severity=error|critical: awaited (guaranteed delivery)
 * - severity=info|warning: fire-and-forget (no request latency impact)
 * - Never throws — DB failures are logged to console.warn
 * - PII is redacted before insert (P13 compliance)
 *
 * Usage:
 *   import { logOpsEvent } from '@/lib/ops-events';
 *   await logOpsEvent({
 *     category: 'ai',
 *     source: 'foxy-route.ts',
 *     severity: 'error',
 *     message: 'Claude API timeout',
 *     context: { model: 'haiku', latencyMs: 12000 },
 *   });
 */

import { supabaseAdmin } from '@/lib/supabase-admin';
import { redactPII } from '@/lib/ops-events-redactor';

export type OpsSeverity = 'info' | 'warning' | 'error' | 'critical';

export interface OpsEventInput {
  category: string;
  source: string;
  severity: OpsSeverity;
  message: string;
  subjectType?: string;
  subjectId?: string;
  context?: Record<string, unknown>;
  requestId?: string;
  occurredAt?: Date;
}

export async function logOpsEvent(input: OpsEventInput): Promise<void> {
  const row = {
    occurred_at: (input.occurredAt ?? new Date()).toISOString(),
    category: input.category,
    source: input.source,
    severity: input.severity,
    subject_type: input.subjectType ?? null,
    subject_id: input.subjectId ?? null,
    message: input.message,
    context: redactPII(input.context ?? {}),
    request_id: input.requestId ?? null,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development',
  };

  let write: Promise<void>;
  try {
    write = Promise.resolve(supabaseAdmin.from('ops_events').insert(row))
      .then((res: { error: { message: string } | null }) => {
        if (res && res.error) {
          console.warn('[ops-events] insert failed', { error: res.error.message, category: input.category, source: input.source });
        }
      })
      .catch((err: unknown) => {
        console.warn('[ops-events] writer threw', { err: String(err) });
      });
  } catch (err) {
    console.warn('[ops-events] writer threw', { err: String(err) });
    return;
  }

  if (input.severity === 'error' || input.severity === 'critical') {
    await write;
  }
}
