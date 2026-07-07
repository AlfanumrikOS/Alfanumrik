/**
 * /api/feature-flags/voice — Voice 2 frontend flag envelope.
 *
 * Why this exists:
 *   - The Voice 2 client decides BUCKET-LEVEL routing (Python Cloud Run vs.
 *     browser Web Speech) per student, based on the full `ff_python_voice_tts_v1`
 *     envelope (`enabled`, `kill_switch`, `rollout_pct`) — NOT just a boolean.
 *   - /api/feature-flags/check returns only `{ enabled: boolean }`; it can't
 *     surface kill_switch or rollout_pct.
 *   - We don't want the client computing the bucket on a stale local copy
 *     of the rollout_pct, so we expose the envelope and let the client hash
 *     its own student_id against the live percentage.
 *
 * Contract:
 *   GET /api/feature-flags/voice
 *     → 200 { enabled: boolean, killSwitch: boolean, rolloutPct: number }
 *
 *   Defaults on read failure: { enabled: false, killSwitch: false, rolloutPct: 0 }
 *   — safe default per P12; never accidentally enable on flag fetch error.
 *
 * Privacy / abuse posture:
 *   - No auth required; the rollout state is public knowledge (visible in
 *     super-admin and inferable from network traffic anyway).
 *   - Cached 60s on the edge; client SWR revalidates on focus.
 *   - No PII in the response.
 *
 * Owner: ai-engineer. Reviewer: ops (rollout control), architect (flag table read).
 */

import { NextResponse } from 'next/server';

// Server-only: read feature_flags directly via service-role REST so we get
// the full row including `metadata` (which the public RLS-restricted client
// cannot necessarily see). The fetch is bounded by a short timeout because a
// hung flag read would block the voice surface on first render.
const FLAG_NAME = 'ff_python_voice_tts_v1';
const FLAG_TIMEOUT_MS = 3_000;

interface VoiceFlagEnvelope {
  enabled: boolean;
  killSwitch: boolean;
  rolloutPct: number;
}

const SAFE_DEFAULT: VoiceFlagEnvelope = {
  enabled: false,
  killSwitch: false,
  rolloutPct: 0,
};

interface FeatureFlagRow {
  flag_name: string;
  is_enabled: boolean;
  rollout_percentage: number | null;
  metadata: Record<string, unknown> | null;
}

async function readVoiceFlag(): Promise<VoiceFlagEnvelope> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return SAFE_DEFAULT;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FLAG_TIMEOUT_MS);

  try {
    const res = await fetch(
      `${url}/rest/v1/feature_flags?flag_name=eq.${FLAG_NAME}&select=flag_name,is_enabled,rollout_percentage,metadata`,
      {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
        },
        signal: controller.signal,
      },
    );
    if (!res.ok) return SAFE_DEFAULT;
    const rows = (await res.json()) as FeatureFlagRow[];
    if (!Array.isArray(rows) || rows.length === 0) return SAFE_DEFAULT;
    const row = rows[0];

    const metadata = (row.metadata ?? {}) as Record<string, unknown>;
    // Precedence mirrors supabase/functions/_shared/python-ai-proxy.ts:readEnvelope.
    //   1. metadata.enabled === false  → disabled (explicit override)
    //   2. typeof metadata.enabled === 'boolean' → that value
    //   3. else → is_enabled column
    const metaEnabled = metadata.enabled;
    const enabled =
      typeof metaEnabled === 'boolean' ? metaEnabled : row.is_enabled === true;
    const killSwitch = metadata.kill_switch === true;

    let rolloutPct = 0;
    const metaPct = metadata.rollout_pct;
    if (typeof metaPct === 'number' && Number.isFinite(metaPct)) {
      rolloutPct = metaPct;
    } else if (typeof row.rollout_percentage === 'number' && Number.isFinite(row.rollout_percentage)) {
      rolloutPct = row.rollout_percentage;
    }
    // Clamp into [0, 100] so a corrupt metadata value never silently routes
    // 200% (i.e. every student) onto Cloud Run.
    rolloutPct = Math.max(0, Math.min(100, rolloutPct));

    return { enabled, killSwitch, rolloutPct };
  } catch {
    // Network failure, abort, or JSON-parse failure → safe default.
    return SAFE_DEFAULT;
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(): Promise<NextResponse> {
  const envelope = await readVoiceFlag();
  return NextResponse.json(envelope, {
    headers: {
      // 1-min edge cache; 5-min stale-while-revalidate window. Flag flips
      // propagate within 1 minute — acceptable given the worst-case impact
      // is a student staying on their current voice provider for that long.
      'Cache-Control': 'public, max-age=60, s-maxage=60, stale-while-revalidate=300',
    },
  });
}
