import { describe, it, expect, vi } from 'vitest'
import { POST } from '@/app/api/mol/feedback/route'

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 's1' } }) }) }) }),
      insert: async () => ({ error: null }),
    }),
  }),
}))
vi.mock('next/headers', () => ({ cookies: () => ({ get: () => ({ value: '' }) }) }))

describe('POST /api/mol/feedback', () => {
  it('returns 200 on valid payload', async () => {
    const req = new Request('http://test/api/mol/feedback', {
      method: 'POST',
      body: JSON.stringify({ request_id: 'r1', rating: 4 }),
      headers: { 'content-type': 'application/json' },
    }) as unknown as import('next/server').NextRequest
    const res = await POST(req)
    expect(res.status).toBe(200)
  })

  it('rejects invalid rating', async () => {
    const req = new Request('http://test/api/mol/feedback', {
      method: 'POST',
      body: JSON.stringify({ request_id: 'r1', rating: 99 }),
      headers: { 'content-type': 'application/json' },
    }) as unknown as import('next/server').NextRequest
    const res = await POST(req)
    expect(res.status).toBe(400)
  })
})
