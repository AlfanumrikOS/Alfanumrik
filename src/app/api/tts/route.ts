import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { createServerClient } from '@supabase/ssr';
import { logger } from '@/lib/logger';
import { isValidUUID } from '@/lib/sanitize';

/* ═══════════════════════════════════════════════════════════════
   ElevenLabs Text-to-Speech API Route
   Keeps API key server-side. Returns audio/mpeg stream.
   Per-student daily rate limiting via student_daily_usage table.
   Requires authenticated Supabase session.
   ═══════════════════════════════════════════════════════════════ */

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || '';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';

// Warm, friendly female voice — good for educational content
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL'; // "Sarah" — clear, warm, patient

const VOICE_SETTINGS = {
  stability: 0.65,
  similarity_boost: 0.78,
  style: 0.35,
  use_speaker_boost: true,
};

const FREE_TTS_DAILY_LIMIT = 20;

export async function POST(req: NextRequest) {
  if (!ELEVENLABS_API_KEY) {
    return NextResponse.json({ error: 'TTS not configured' }, { status: 503 });
  }

  // ── Auth check: require valid Supabase session ──
  let authUserId: string | null = null;
  if (SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    const supabaseAuth = createServerClient(
      SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      { cookies: { getAll: () => req.cookies.getAll(), setAll: () => {} } },
    );
    const { data: { user } } = await supabaseAuth.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    authUserId = user.id;
  }

  try {
    const { text, language, studentId } = await req.json();

    if (!text || typeof text !== 'string') {
      return NextResponse.json({ error: 'text is required' }, { status: 400 });
    }

    // Validate studentId format to prevent injection into Supabase queries
    if (studentId && !isValidUUID(studentId)) {
      return NextResponse.json({ error: 'Invalid studentId' }, { status: 400 });
    }

    // Verify studentId belongs to authenticated user (prevent quota theft / data leak)
    if (studentId && authUserId) {
      const sb = supabaseAdmin;
      const { data: studentOwner } = await sb
        .from('students')
        .select('auth_user_id')
        .eq('id', studentId)
        .maybeSingle();
      if (!studentOwner || studentOwner.auth_user_id !== authUserId) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 });
      }
    }

    // ── Per-student daily rate limiting ──
    if (studentId) {
      const sb = supabaseAdmin;
      const today = new Date().toISOString().slice(0, 10);

      const { data: usageRow } = await sb
        .from('student_daily_usage')
        .select('usage_count')
        .eq('student_id', studentId)
        .eq('feature', 'foxy_tts')
        .eq('usage_date', today)
        .maybeSingle();

      const currentCount = usageRow?.usage_count ?? 0;

      // Check subscription plan for limit
      const { data: studentRow } = await sb
        .from('students')
        .select('subscription_plan')
        .eq('id', studentId)
        .maybeSingle();

      const plan = studentRow?.subscription_plan || 'free';
      // Plan limits aligned with usage.ts and subscription_plans table
      const TTS_LIMITS: Record<string, number> = {
        free: 3, starter: 15, basic: 15, pro: 50, premium: 50, unlimited: 999999,
      };
      const limit = TTS_LIMITS[plan] ?? TTS_LIMITS.free;

      if (currentCount >= limit) {
        return NextResponse.json(
          { error: 'Daily TTS limit reached. Voice will use browser speech instead.', code: 'TTS_LIMIT' },
          { status: 429, headers: { 'X-TTS-Remaining': '0', 'X-TTS-Limit': String(limit) } },
        );
      }

      // Record usage BEFORE processing — fail closed to prevent TOCTOU bypass.
      // The increment_daily_usage RPC uses INSERT ON CONFLICT (atomic),
      // so concurrent requests will each correctly increment the counter.
      const { error: incErr } = await sb.rpc('increment_daily_usage', {
        p_student_id: studentId,
        p_feature: 'foxy_tts',
        p_usage_date: today,
      });
      if (incErr) {
        // Fail closed: if we can't record usage, deny the request to prevent
        // unlimited TTS calls when the DB is down or rate limit table is unavailable
        logger.error('tts_usage_increment_failed', { error: new Error(incErr.message), route: '/api/tts' });
        return NextResponse.json(
          { error: 'Usage tracking unavailable, please try again', code: 'USAGE_ERROR' },
          { status: 503 },
        );
      }
    }

    // Clean text for speech — remove markdown artifacts, tags, etc.
    const cleanText = text
      .replace(/\[KEY:\s*([^\]]+)\]/g, '$1')
      .replace(/\[ANS:\s*([^\]]+)\]/g, 'The answer is $1.')
      .replace(/\[FORMULA:\s*([^\]]+)\]/g, '$1')
      .replace(/\[TIP:\s*([^\]]+)\]/g, 'Exam tip: $1.')
      .replace(/\[MARKS:\s*([^\]]+)\]/g, '')
      .replace(/\[DIAGRAM:\s*([^\]]+)\]/g, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/^#{1,4}\s+/gm, '')
      .replace(/\n+/g, '. ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleanText) {
      return NextResponse.json({ error: 'No speakable text' }, { status: 400 });
    }

    // Truncate to ~5000 chars to stay within ElevenLabs limits
    const truncated = cleanText.length > 5000 ? cleanText.slice(0, 5000) + '...' : cleanText;

    // Use multilingual v2 model for Hindi/Hinglish support
    const modelId = language === 'hi' || language === 'hinglish'
      ? 'eleven_multilingual_v2'
      : 'eleven_turbo_v2_5';

    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/stream`, {
      method: 'POST',
      headers: {
        'xi-api-key': ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify({
        text: truncated,
        model_id: modelId,
        voice_settings: VOICE_SETTINGS,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => 'Unknown');
      console.error('ElevenLabs error:', res.status, errText);

      if (res.status === 429) {
        return NextResponse.json({ error: 'Rate limited, try again shortly' }, { status: 429 });
      }
      return NextResponse.json({ error: 'TTS generation failed' }, { status: 502 });
    }

    // Stream audio back
    const headers = new Headers({
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'private, max-age=3600',
      'Transfer-Encoding': 'chunked',
    });

    return new NextResponse(res.body, { status: 200, headers });
  } catch (err) {
    logger.error('tts_generation_failed', { error: err instanceof Error ? err : new Error(String(err)), route: '/api/tts' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
