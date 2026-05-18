// src/app/api/mol/feedback/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

const BodySchema = z.object({
  request_id:    z.string().min(1).max(64),
  rating:        z.number().int().min(1).max(5),
  helpful:       z.boolean().optional(),
  time_spent_ms: z.number().int().min(0).max(86_400_000).optional(),
  completed:     z.boolean().optional(),
  notes:         z.string().max(500).optional(),
})

export async function POST(req: NextRequest) {
  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }) }

  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input', details: parsed.error.flatten() }, { status: 400 })

  const cookieStore = cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get: (n) => cookieStore.get(n)?.value } },
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data: student } = await supabase.from('students')
    .select('id').eq('auth_user_id', user.id).eq('is_active', true).maybeSingle()

  const { error } = await supabase.from('mol_feedback').insert({
    request_id:    parsed.data.request_id,
    student_id:    student?.id ?? null,
    rating:        parsed.data.rating,
    helpful:       parsed.data.helpful ?? null,
    time_spent_ms: parsed.data.time_spent_ms ?? null,
    completed:     parsed.data.completed ?? null,
    notes:         parsed.data.notes ?? null,
  })

  if (error) {
    console.error('mol_feedback insert failed:', error.message)
    return NextResponse.json({ error: 'persist_failed' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
