/**
 * Observability event writer for Deno Edge Functions.
 *
 * Writes structured events to the ops_events table via PostgREST
 * (service role key — bypasses RLS).
 *
 * Behavior mirrors the Next.js helper (src/lib/ops-events.ts):
 * - severity=error|critical: awaited (guaranteed delivery)
 * - severity=info|warning: fire-and-forget (no request latency impact)
 * - Never throws — fetch failures are logged to console.warn
 * - PII is redacted before insert (P13 compliance)
 *
 * Usage:
 *   import { logOpsEvent } from '../_shared/ops-events.ts';
 *   await logOpsEvent({
 *     category: 'ai',
 *     source: 'foxy-tutor',
 *     severity: 'error',
 *     message: 'Claude API timeout',
 *     context: { model: 'haiku', latencyMs: 12000 },
 *   });
 */

import { redactPII } from './redact-pii.ts';

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
  const url = `${Deno.env.get('SUPABASE_URL')}/rest/v1/ops_events`;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

  const body = JSON.stringify({
    occurred_at: (input.occurredAt ?? new Date()).toISOString(),
    category: input.category,
    source: input.source,
    severity: input.severity,
    subject_type: input.subjectType ?? null,
    subject_id: input.subjectId ?? null,
    message: input.message,
    context: redactPII(input.context ?? {}),
    request_id: input.requestId ?? null,
    environment: Deno.env.get('SUPABASE_ENV') ?? 'production',
  });

  let write: Promise<void>;
  try {
    write = fetch(url, {
      method: 'POST',
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body,
    })
      .then((r) => { if (!r.ok) console.warn('[ops-events] insert failed', r.status, r.statusText); })
      .catch((err) => { console.warn('[ops-events] writer threw', String(err)); });
  } catch (err) {
    console.warn('[ops-events] writer threw (sync)', String(err));
    return;
  }

  if (input.severity === 'error' || input.severity === 'critical') {
    await write;
  }
}