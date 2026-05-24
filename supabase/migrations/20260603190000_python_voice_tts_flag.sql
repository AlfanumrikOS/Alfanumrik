-- Voice 2 frontend wiring — Python STT+TTS rollout flag (2026-05-24, Phase 2).
--
-- The last piece of the original "Indian-accent voice" ask. Voice 1a/1b
-- shipped the FastAPI Whisper + Azure neural TTS endpoints on Cloud Run
-- (asia-south1 / Mumbai). Voice 2 wires src/lib/voice.ts to call those
-- endpoints from the browser instead of the Web Speech API, BEHIND this
-- flag, with the browser Web Speech path as the safety-net fallback.
--
-- Default: DISABLED on both staging + production (rollout_pct=0). The
--   browser Web Speech API continues to handle 100% of mic/speaker
--   traffic until ops manually bumps `metadata.rollout_pct`. The
--   frontend short-circuits to Web Speech when the flag is OFF, when
--   the kill switch is ON, when the per-student hash bucket misses,
--   OR when the Cloud Run call fails for any reason (network, 4xx, 5xx,
--   timeout, abort).
--
-- Ramp procedure: ops bumps `metadata.rollout_pct` per the Voice 2
--   rollout playbook in docs/PYTHON_AI_VOICE_2_FRONTEND.md — 10% → 25%
--   → 50% → 100% with 24-48h watch at each step. Watch the per-student
--   Cloud Run STT+TTS success rate via mol_request_logs.function='voice'
--   and the fallback-to-Web-Speech rate in posthog (voice_fallback
--   event, follow-up).
--
-- Kill switch contract (read by usePythonVoiceEnabled in
--   src/lib/voice-feature-flag.ts via /api/feature-flags/voice):
--     metadata.kill_switch === true                → Web Speech (never proxy)
--     metadata.enabled === false                    → Web Speech
--     hash(student_id) % 100 >= metadata.rollout_pct → Web Speech
--   On ANY flag-read failure the helper defaults to Web Speech — never
--   silently routes to Cloud Run when ops thinks the switch is off.
--   Same precedence as ff_python_bulk_question_gen_v1 + the other
--   Python-cutover flags so the ops mental model is uniform.
--
-- Hash bucket choice: this is a USER-FACING flag, so we bucket by
--   student_id (not request_id like the admin cutover proxies). The
--   same student should always have the same voice experience within a
--   session — otherwise students would hear different voices for
--   different messages, which is jarring.
--
-- Safety-net: src/lib/voice.ts catches every error from the Python
--   client and falls through to the browser Web Speech path. The Web
--   Speech path is NEVER deleted by this flag — even at 100% rollout,
--   a Cloud Run outage flips voice traffic back to Web Speech inside
--   the browser, with only a console.warn for ops visibility.
--
-- Frontend code paths gated by this flag:
--   src/lib/voice.ts            — startListening() / speak()
--   src/lib/voice-python-client.ts  — fetch wrappers (new file)
--   src/lib/voice-feature-flag.ts   — usePythonVoiceEnabled() hook (new file)
--   src/app/api/feature-flags/voice/route.ts — flag envelope endpoint (new)

insert into public.feature_flags (
  flag_name,
  is_enabled,
  rollout_percentage,
  target_environments,
  metadata,
  created_at,
  updated_at
) values (
  'ff_python_voice_tts_v1',
  false,
  0,
  array['staging', 'production'],
  jsonb_build_object(
    'enabled',     false,
    'kill_switch', false,
    'rollout_pct', 0,
    'phase',       'voice_2',
    'function',    'voice-tts-stt',
    'description', 'Per-student rollout flag for Python Cloud Run voice (Whisper STT + Azure neural TTS). When metadata.enabled=true AND hash(student_id) bucket < metadata.rollout_pct AND metadata.kill_switch is not true, the Foxy chat surfaces use Cloud Run instead of the browser Web Speech API. Default OFF until frontend deploy and synthetic smoke-tests green.',
    'owner',       'ai-engineer'
  ),
  now(),
  now()
)
on conflict (flag_name) do nothing;
