import { NextRequest, NextResponse } from 'next/server';

/* ═══════════════════════════════════════════════════════════════
   ElevenLabs Text-to-Speech API Route
   Keeps API key server-side. Returns audio/mpeg stream.
   ═══════════════════════════════════════════════════════════════ */

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || '';

// Warm, friendly female voice — good for educational content
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL'; // "Sarah" — clear, warm, patient

const VOICE_SETTINGS = {
  stability: 0.65,
  similarity_boost: 0.78,
  style: 0.35,
  use_speaker_boost: true,
};

export async function POST(req: NextRequest) {
  if (!ELEVENLABS_API_KEY) {
    return NextResponse.json({ error: 'TTS not configured' }, { status: 503 });
  }

  try {
    const { text, language } = await req.json();

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
