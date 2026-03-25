import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

/* ═══════════════════════════════════════════════════════════════
   ElevenLabs Text-to-Speech API Route
   Keeps API key server-side. Returns audio/mpeg stream.
   Per-student daily rate limiting via student_daily_usage table.
   ═══════════════════════════════════════════════════════════════ */

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || '';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

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

  try {
    const { text, language, studentId } = await req.json();

    // ── Per-student daily rate limiting ──
    if (studentId && SUPABASE_URL && SUPABASE_SERVICE_KEY) {
      const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
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
      const limit = plan === 'premium' ? 500 : plan === 'basic' ? 80 : FREE_TTS_DAILY_LIMIT;

      if (currentCount >= limit) {
        return NextResponse.json(
          { error: 'Daily TTS limit reached. Voice will use browser speech instead.', code: 'TTS_LIMIT' },
          { status: 429, headers: { 'X-TTS-Remaining': '0', 'X-TTS-Limit': String(limit) } },
        );
      }

      // Record usage (fire-and-forget)
      sb.rpc('increment_daily_usage', {
        p_student_id: studentId,
        p_feature: 'foxy_tts',
        p_usage_date: today,
      }).then(() => {});
    }

    if (!text || typeof text !== 'string') {
      return NextResponse.json({ error: 'text is required' }, { status: 400 });
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
    console.error('TTS route error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
