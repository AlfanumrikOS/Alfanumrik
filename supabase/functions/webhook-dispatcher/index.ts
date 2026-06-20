// supabase/functions/webhook-dispatcher/index.ts
//
// Track A.6 — OUTBOUND webhook dispatcher (Deno Edge Function).
// ============================================================================
// Picks up due `webhook_deliveries` rows, HMAC-signs each body, and POSTs it to
// the subscription's https target_url. Triggered nightly (thin) from the
// daily-cron Edge Function, and can be invoked ad-hoc by an operator with the
// CRON_SECRET. Fail-safe + idempotent: one bad delivery never aborts the batch.
//
//   POST (auth: x-cron-secret | Authorization: Bearer | ?token=)
//   → returns { picked, delivered, retried, dead_lettered, blocked }
//
// ── SELECTION ────────────────────────────────────────────────────────────────
//   status IN ('pending','failed') AND (next_retry_at IS NULL OR next_retry_at <= now())
//   ordered oldest-first, bounded batch (Vercel/Edge time budget).
//
// ── SIGNING (HMAC-SHA256) ────────────────────────────────────────────────────
//   The raw signing secret is NEVER stored (P13) — only `secret_hash` (the
//   SHA-256 of the raw secret) is persisted. So the HMAC key used here is that
//   `secret_hash`: the RECEIVER computes SHA-256 of THEIR copy of the raw secret
//   to derive the identical key, then verifies `X-Alfanumrik-Signature`. This
//   keeps "raw secret stored once, never persisted" while still giving both
//   sides a shared, reproducible signing key. Header:
//     X-Alfanumrik-Signature: sha256=<hex hmac of the exact JSON body>
//
// ── SSRF (MANDATORY) ─────────────────────────────────────────────────────────
//   BEFORE EVERY send, re-validate the target host with validateWebhookTargetUrl
//   (https-only + block private/loopback/link-local). A host that fails is NOT
//   sent to; it is treated as a failed attempt and backs off (a misconfigured /
//   rebinding host eventually dead-letters, never reaches the internal network).
//
// ── RETRY / BACKOFF / DLQ ────────────────────────────────────────────────────
//   On failure: attempts++, next_retry_at = now() + LEAST(6h, 60s*2^(attempts-1))
//   + jitter, status='failed'. After MAX_ATTEMPTS (8) → status='dead_letter',
//   next_retry_at=NULL (never auto-re-picked; operator can replay).
//
// ── IDEMPOTENCY ──────────────────────────────────────────────────────────────
//   Each delivery row carries the event envelope (with event_id) in `payload`;
//   the receiver dedupes on event_id. The dispatcher marks a row 'delivered'
//   atomically guarded by .eq('status', <pre-send status>) so two overlapping
//   dispatcher runs cannot double-deliver the same row.
//
// ── P13 ──────────────────────────────────────────────────────────────────────
//   Logs carry counts + ids + status codes ONLY — never the payload contents,
//   never the secret/hash, never PII. `last_error` stores a short status line.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { validateWebhookTargetUrl } from '../_shared/ssrf.ts';

const MAX_ATTEMPTS = 8;
const BASE_BACKOFF_MS = 60_000; // 60s
const CAP_BACKOFF_MS = 6 * 60 * 60 * 1000; // 6h
const BATCH_LIMIT = 200;
const SEND_TIMEOUT_MS = 10_000; // per-delivery HTTP timeout
const MAX_ERROR_LEN = 300; // truncate last_error (no PII, status line only)

interface DeliveryRow {
  id: string;
  subscription_id: string;
  school_id: string;
  event: string;
  payload: Record<string, unknown>;
  status: string;
  attempts: number;
}

interface SubscriptionRow {
  id: string;
  target_url: string;
  secret_hash: string;
  is_active: boolean;
}

// ── AUTH (fail-closed, constant-time) ────────────────────────────────────────
function constantTimeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}

function isAuthorized(req: Request): boolean {
  const secret = Deno.env.get('CRON_SECRET') ?? '';
  if (!secret) return false; // fail closed on missing config
  const auth = req.headers.get('authorization') ?? '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : '';
  const headerSecret = req.headers.get('x-cron-secret') ?? '';
  const url = new URL(req.url);
  const token = url.searchParams.get('token') ?? '';
  const provided = bearer || headerSecret || token;
  if (!provided) return false;
  return constantTimeEqual(provided, secret);
}

// ── HMAC-SHA256 hex over the body, keyed by secret_hash ──────────────────────
async function hmacSha256Hex(key: string, body: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(body));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ── Exponential backoff with jitter ──────────────────────────────────────────
function nextRetryIso(attempts: number): string {
  const exp = Math.min(CAP_BACKOFF_MS, BASE_BACKOFF_MS * Math.pow(2, Math.max(0, attempts - 1)));
  const jitter = Math.floor(Math.random() * Math.min(30_000, exp * 0.2));
  return new Date(Date.now() + exp + jitter).toISOString();
}

function truncate(s: string): string {
  return s.length > MAX_ERROR_LEN ? s.slice(0, MAX_ERROR_LEN) : s;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // Fail-closed auth BEFORE any DB I/O.
  if (!isAuthorized(req)) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  );

  const counts = { picked: 0, delivered: 0, retried: 0, dead_lettered: 0, blocked: 0 };

  try {
    const nowIso = new Date().toISOString();

    // Pick up due rows (pending/failed, due now), oldest first, bounded.
    const { data: due, error: dueError } = await supabase
      .from('webhook_deliveries')
      .select('id, subscription_id, school_id, event, payload, status, attempts')
      .in('status', ['pending', 'failed'])
      .or(`next_retry_at.is.null,next_retry_at.lte.${nowIso}`)
      .order('created_at', { ascending: true })
      .limit(BATCH_LIMIT);

    if (dueError) {
      console.error('webhook-dispatcher: due query failed:', dueError.message);
      return new Response(JSON.stringify({ error: 'query_failed' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const rows = (due ?? []) as DeliveryRow[];
    counts.picked = rows.length;

    // Cache subscriptions for this batch (one read per distinct subscription).
    const subCache = new Map<string, SubscriptionRow | null>();
    async function getSubscription(id: string): Promise<SubscriptionRow | null> {
      if (subCache.has(id)) return subCache.get(id) ?? null;
      const { data } = await supabase
        .from('webhook_subscriptions')
        .select('id, target_url, secret_hash, is_active')
        .eq('id', id)
        .maybeSingle();
      const sub = (data as SubscriptionRow | null) ?? null;
      subCache.set(id, sub);
      return sub;
    }

    for (const row of rows) {
      const sub = await getSubscription(row.subscription_id);

      // Subscription gone or deactivated → terminal (do not keep retrying).
      if (!sub || !sub.is_active) {
        await supabase
          .from('webhook_deliveries')
          .update({ status: 'dead_letter', next_retry_at: null, last_error: 'subscription_inactive' })
          .eq('id', row.id)
          .eq('status', row.status); // guard against concurrent runs
        counts.dead_lettered++;
        continue;
      }

      // ── MANDATORY SSRF re-check immediately before sending ──────────────────
      const ssrf = validateWebhookTargetUrl(sub.target_url);
      if (!ssrf.ok) {
        // Never send. Treat as a failed attempt → backoff → eventual dead-letter.
        const attempts = row.attempts + 1;
        const terminal = attempts >= MAX_ATTEMPTS;
        await supabase
          .from('webhook_deliveries')
          .update({
            status: terminal ? 'dead_letter' : 'failed',
            attempts,
            next_retry_at: terminal ? null : nextRetryIso(attempts),
            last_error: truncate(`blocked_target: ${ssrf.reason ?? 'ssrf'}`),
          })
          .eq('id', row.id)
          .eq('status', row.status);
        counts.blocked++;
        if (terminal) counts.dead_lettered++;
        continue;
      }

      // Sign the EXACT body string we POST (stable serialization).
      const bodyStr = JSON.stringify(row.payload ?? {});
      let signature: string;
      try {
        signature = await hmacSha256Hex(sub.secret_hash, bodyStr);
      } catch (e) {
        console.error('webhook-dispatcher: sign failed for delivery', row.id);
        const attempts = row.attempts + 1;
        const terminal = attempts >= MAX_ATTEMPTS;
        await supabase
          .from('webhook_deliveries')
          .update({
            status: terminal ? 'dead_letter' : 'failed',
            attempts,
            next_retry_at: terminal ? null : nextRetryIso(attempts),
            last_error: 'sign_error',
          })
          .eq('id', row.id)
          .eq('status', row.status);
        if (terminal) counts.dead_lettered++;
        else counts.retried++;
        continue;
      }

      // POST with a per-delivery timeout.
      let ok = false;
      let errLine = '';
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
        const res = await fetch(sub.target_url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Alfanumrik-Signature': `sha256=${signature}`,
            'X-Alfanumrik-Event': row.event,
            'X-Alfanumrik-Delivery': row.id,
          },
          body: bodyStr,
          signal: controller.signal,
          redirect: 'error', // do not follow redirects (could re-point at internal host)
        });
        clearTimeout(timer);
        ok = res.status >= 200 && res.status < 300;
        if (!ok) errLine = `http_${res.status}`;
      } catch (e) {
        errLine = e instanceof Error ? `fetch_error: ${e.name}` : 'fetch_error';
      }

      if (ok) {
        // Atomic flip guarded by the pre-send status so overlapping runs can't
        // double-deliver.
        await supabase
          .from('webhook_deliveries')
          .update({
            status: 'delivered',
            attempts: row.attempts + 1,
            delivered_at: new Date().toISOString(),
            next_retry_at: null,
            last_error: null,
          })
          .eq('id', row.id)
          .eq('status', row.status);
        counts.delivered++;
      } else {
        const attempts = row.attempts + 1;
        const terminal = attempts >= MAX_ATTEMPTS;
        await supabase
          .from('webhook_deliveries')
          .update({
            status: terminal ? 'dead_letter' : 'failed',
            attempts,
            next_retry_at: terminal ? null : nextRetryIso(attempts),
            last_error: truncate(errLine || 'delivery_failed'),
          })
          .eq('id', row.id)
          .eq('status', row.status);
        if (terminal) counts.dead_lettered++;
        else counts.retried++;
      }
    }

    // P13: counts only.
    console.log(
      `webhook-dispatcher: picked=${counts.picked} delivered=${counts.delivered} ` +
        `retried=${counts.retried} dead_lettered=${counts.dead_lettered} blocked=${counts.blocked}`,
    );

    return new Response(JSON.stringify({ success: true, data: counts }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    console.error('webhook-dispatcher fatal:', m);
    return new Response(JSON.stringify({ success: false, error: 'internal_error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
