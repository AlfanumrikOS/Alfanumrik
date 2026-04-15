/**
 * ALFANUMRIK — Ops Events Helper
 *
 * Writes to the append-only `ops_events` table (see migration
 * 20260411120000_observability_console_1a.sql). This is the canonical
 * channel for payment/system/auth signals that super-admin observability
 * reads from.
 *
 * Behavior:
 * - severity=error|critical: awaited (guaranteed delivery)
 * - severity=info|warning:   fire-and-forget (no request latency impact)
 * - Never throws — DB failures are logged to console.warn
 * - PII is redacted before insert (P13 compliance)
 *
 * Usage (server-only — uses service role):
 *   import { logOpsEvent } from '@/lib/ops-events';
 *   await logOpsEvent({
 *     category: 'payment',
 *     severity: 'critical',
 *     source: 'webhook/route.ts',
 *     message: 'webhook student_unresolved',
 *     context: { event_type, rz_sub_id },
 *   });
 *
 * P13: context MUST NOT contain raw email, phone, or other PII.
 * If a PII value is needed for correlation, hash it with hashPII() first.
 */
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';

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

/** PII keys that should never land in ops_events.context raw. */
const PII_KEYS = new Set([
  'email', 'phone', 'password', 'token', 'authorization', 'cookie',
  'api_key', 'apikey', 'secret', 'access_token', 'refresh_token',
  'service_role_key',
]);

function redactContext(ctx: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ctx)) {
    const lower = k.toLowerCase();
    if (PII_KEYS.has(lower) || PII_KEYS.has(lower.replace(/_/g, ''))) {
      out[k] = '[REDACTED]';
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = redactContext(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** Hash a PII value for correlation without exposing the raw value. */
export function hashPII(value: string): string {
  return createHash('sha256').update(value).digest('hex').substring(0, 16);
}

export async function logOpsEvent(input: OpsEventInput): Promise<void> {
  const doWrite = async (): Promise<void> => {
    try {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!url || !serviceKey) {
        console.warn('[ops-events] missing env, skipping', { category: input.category });
        return;
      }

      const admin = createClient(url, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      const row = {
        occurred_at: (input.occurredAt ?? new Date()).toISOString(),
        category: input.category,
        source: input.source,
        severity: input.severity,
        subject_type: input.subjectType ?? null,
        subject_id: input.subjectId ?? null,
        message: input.message,
        context: redactContext(input.context ?? {}),
        request_id: input.requestId ?? null,
        environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'production',
      };

      const { error } = await admin.from('ops_events').insert(row);
      if (error) {
        console.warn('[ops-events] insert failed', {
          error: error.message,
          category: input.category,
          source: input.source,
        });
      }
    } catch (err) {
      console.warn('[ops-events] writer threw', { err: String(err) });
    }
  };

  if (input.severity === 'error' || input.severity === 'critical') {
    await doWrite();
  } else {
    // Fire-and-forget; swallow all errors.
    void doWrite();
  }
}
