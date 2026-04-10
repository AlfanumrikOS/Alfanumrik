import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const MAX_SESSIONS = 2

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Auth required' }, 401)

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error } = await supabase.auth.getUser(token)
    if (error || !user) return json({ error: 'Invalid token' }, 401)

    const body = await req.json()
    const action = body.action

    // Hash token for storage (don't store raw tokens)
    const tokenHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
    const hashHex = Array.from(new Uint8Array(tokenHash)).map(b => b.toString(16).padStart(2, '0')).join('')

    // ── REGISTER SESSION ──
    if (action === 'register') {
      const deviceLabel = (body.device_label || req.headers.get('user-agent') || 'unknown').slice(0, 200)
      const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'

      // Check if this token is already registered
      const { data: existing } = await supabase
        .from('user_active_sessions')
        .select('id')
        .eq('session_token_hash', hashHex)
        .eq('is_active', true)
        .limit(1)

      if (existing && existing.length > 0) {
        // Update last_seen
        await supabase.from('user_active_sessions').update({ last_seen_at: new Date().toISOString() }).eq('id', existing[0].id)
        return json({ status: 'existing', session_id: existing[0].id })
      }

      // Count active sessions
      const { data: activeSessions } = await supabase
        .from('user_active_sessions')
        .select('id, created_at, device_label')
        .eq('auth_user_id', user.id)
        .eq('is_active', true)
        .order('created_at', { ascending: true })

      const active = activeSessions || []

      // If at limit, revoke oldest
      if (active.length >= MAX_SESSIONS) {
        const toRevoke = active.slice(0, active.length - MAX_SESSIONS + 1)
        for (const s of toRevoke) {
          await supabase.from('user_active_sessions').update({
            is_active: false, revoked_at: new Date().toISOString()
          }).eq('id', s.id)

          await supabase.from('identity_events').insert({
            auth_user_id: user.id,
            event_type: 'session_revoked_by_limit',
            metadata: { revoked_session: s.id, device: s.device_label, reason: `Exceeded ${MAX_SESSIONS} device limit` },
          })
        }
      }

      // Register new session
      const { data: newSession } = await supabase
        .from('user_active_sessions')
        .insert({
          auth_user_id: user.id,
          session_token_hash: hashHex,
          device_label: deviceLabel,
          ip_address: ip,
          user_agent: deviceLabel,
        })
        .select('id')
        .single()

      await supabase.from('identity_events').insert({
        auth_user_id: user.id,
        event_type: 'session_registered',
        metadata: { device: deviceLabel, ip },
      })

      return json({
        status: 'registered',
        session_id: newSession?.id,
        sessions_revoked: Math.max(0, (active.length || 0) - MAX_SESSIONS + 1),
      })
    }

    // ── CHECK SESSION ──
    if (action === 'check') {
      const { data: session } = await supabase
        .from('user_active_sessions')
        .select('id, is_active, revoked_at')
        .eq('session_token_hash', hashHex)
        .limit(1)
        .maybeSingle()

      if (!session) return json({ valid: false, reason: 'Session not registered' })
      if (!session.is_active) return json({ valid: false, reason: 'Session was ended because you logged in on another device.' })

      // Update last_seen
      await supabase.from('user_active_sessions').update({ last_seen_at: new Date().toISOString() }).eq('id', session.id)

      return json({ valid: true, session_id: session.id })
    }

    // ── LOGOUT ──
    if (action === 'logout') {
      await supabase.from('user_active_sessions').update({
        is_active: false, revoked_at: new Date().toISOString()
      }).eq('session_token_hash', hashHex)

      await supabase.from('identity_events').insert({
        auth_user_id: user.id,
        event_type: 'session_logout',
        metadata: {},
      })

      return json({ status: 'logged_out' })
    }

    // ── LIST SESSIONS ──
    if (action === 'list') {
      const { data: sessions } = await supabase
        .from('user_active_sessions')
        .select('id, device_label, created_at, last_seen_at, is_active')
        .eq('auth_user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(10)

      return json({ sessions: sessions || [] })
    }

    return json({ error: 'Unknown action' }, 400)
  } catch (err) {
    return json({ error: err.message || 'Internal error' }, 500)
  }
})
