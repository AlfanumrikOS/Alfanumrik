import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';

const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY;
const VOYAGE_ENDPOINT = 'https://api.voyageai.com/v1/embeddings';

export async function POST(request: NextRequest) {
  // Auth guard: only authenticated users may call Voyage API via this proxy.
  // Prevents external callers from burning Voyage quota.
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { text } = await request.json();

    if (!text || typeof text !== 'string') {
      return NextResponse.json({ error: 'text is required' }, { status: 400 });
    }

    if (!VOYAGE_API_KEY) {
      // No API key — return null embedding, RPC will use keyword-only fallback
      return NextResponse.json({ embedding: null });
    }

    const response = await fetch(VOYAGE_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${VOYAGE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'voyage-3',
        input: [text.slice(0, 32000)], // Safety truncation
        output_dimension: 1024,
      }),
    });

    if (!response.ok) {
      console.warn(`Voyage API error: ${response.status}`);
      return NextResponse.json({ embedding: null });
    }

    const data = await response.json();
    const embedding = data?.data?.[0]?.embedding;

    if (!embedding || !Array.isArray(embedding) || embedding.length !== 1024) {
      return NextResponse.json({ embedding: null });
    }

    return NextResponse.json({ embedding });
  } catch {
    return NextResponse.json({ embedding: null });
  }
}
