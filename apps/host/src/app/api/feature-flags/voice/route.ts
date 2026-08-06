/**
 * /api/feature-flags/voice — Voice 2 frontend flag envelope.
 *
 * P2-12 remediation (audit 2026-08-06): Replaced service_role raw REST fetch
 * with SECURITY DEFINER RPC get_feature_flag_envelope(), called via the
 * authenticated Supabase client. No service_role key exposure risk.
 *
 * Contract:
 *   GET /api/feature-flags/voice
 *     → 200 { enabled: boolean, killSwitch: boolean, rolloutPct: number }
 *
 * Owner: ai-engineer. Reviewer: ops, data-platform.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const FLAG_NAME = 'ff_python_voice_tts_v1';

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

async function readVoiceFlag(): Promise<VoiceFlagEnvelope> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return SAFE_DEFAULT;

  const supabase = createClient(url, anonKey, {
    auth: { persistSession: false },
  });

  const { data, error } = await supabase.rpc('get_feature_flag_envelope', {
    p_flag_name: FLAG_NAME,
  });

  if (error || !data) return SAFE_DEFAULT;

  return data as unknown as VoiceFlagEnvelope;
}

export async function GET(): Promise<NextResponse> {
  const envelope = await readVoiceFlag();
  return NextResponse.json(envelope, {
    headers: {
      'Cache-Control': 'public, max-age=60, s-maxage=60, stale-while-revalidate=300',
    },
  });
}
