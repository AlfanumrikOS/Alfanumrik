import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import { getCorsHeaders } from '../_shared/cors.ts'

const MAX_SESSIONS = 2

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req.headers.get('origin'))
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
      const { data: existing, error: existingErr } = await supabase
        .from('user_active_sessions')
        .select('id')
        .eq('session_token_hash', hashHex)
        .eq('is_active', true)
        .limit(1)

      // supabase-js resolves rather than throws, so the outer catch never saw
      // this. Reading a failure as "not registered yet" would insert a SECOND
      // active row for the same token, inflating the device count and evicting
      // a legitimate device. Refuse instead — the client can retry.
      if (existingErr) {
        console.error('[session-guard] register: existing-session probe failed:', existingErr.code, existingErr.message)
        return json({ error: 'Session registry unavailable' }, 503)
      }

      if (existing && existing.length > 0) {
        // Update last_seen
        await supabase.from('user_active_sessions').update({ last_seen_at: new Date().toISOString() }).eq('id', existing[0].id)
        return json({ status: 'existing', session_id: existing[0].id })
      }

      // Count active sessions
      const { data: activeSessions, error: activeErr } = await supabase
        .from('user_active_sessions')
        .select('id, created_at, device_label')
        .eq('auth_user_id', user.id)
        .eq('is_active', true)
        .order('created_at', { ascending: true })

      // This count IS the MAX_SESSIONS enforcement. Reading a failure as "zero
      // active sessions" silently disables the 2-device limit for this request
      // — a security control failing open. Refuse instead.
      if (activeErr) {
        console.error('[session-guard] register: active-session count failed:', activeErr.code, activeErr.message)
        return json({ error: 'Session registry unavailable' }, 503)
      }

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
      const { data: newSession, error: newSessionErr } = await supabase
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

      // A failed insert previously still returned status 'registered' with an
      // undefined session_id — the caller believed it had a session that does
      // not exist. Report the failure instead.
      if (newSessionErr || !newSession) {
        console.error('[session-guard] register: session insert failed:', newSessionErr?.code, newSessionErr?.message)
        return json({ error: 'Could not register session' }, 503)
      }

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
      const { data: session, error: sessionErr } = await supabase
        .from('user_active_sessions')
        .select('id, is_active, revoked_at')
        .eq('session_token_hash', hashHex)
        .limit(1)
        .maybeSingle()

      // "We could not read the registry" is NOT "this session is not
      // registered". Returning the latter would log every user out on a
      // transient DB fault. Report the fault so the client can retry.
      if (sessionErr) {
        console.error('[session-guard] check: session read failed:', sessionErr.code, sessionErr.message)
        return json({ error: 'Session registry unavailable' }, 503)
      }

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
      const { data: sessions, error: sessionsErr } = await supabase
        .from('user_active_sessions')
        .select('id, device_label, created_at, last_seen_at, is_active')
        .eq('auth_user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(10)

      // An empty list here reads as "you have no other devices signed in",
      // which is exactly the wrong thing to tell a user auditing their
      // sessions. Report the failure rather than an empty list.
      if (sessionsErr) {
        console.error('[session-guard] list: session list read failed:', sessionsErr.code, sessionsErr.message)
        return json({ error: 'Session registry unavailable' }, 503)
      }

      return json({ sessions: sessions || [] })
    }

    return json({ error: 'Unknown action' }, 400)
  } catch (err) {
    return json({ error: err.message || 'Internal error' }, 500)
  }
})
