'use client';

/**
 * EncourageButton — parent → child "Encourage" action (Consumer Minimalism
 * Wave D, "D-encourage"). Gated by `ff_parent_encourage_v1` at the call site
 * (ParentGlanceHome only mounts this when the flag is ON AND the parent is in
 * guardian-JWT mode). Lazy-loaded so its picker markup never enters the
 * flag-OFF first-paint bundle (P10).
 *
 * Behaviour:
 *   - Tapping "Encourage {child}" reveals a compact, inline preset picker.
 *   - The preset labels come straight from `CHEER_PRESETS` in
 *     src/lib/parent/cheer-catalog.ts (the SAME pure data module the backend
 *     route reads) — we IMPORT it, never duplicate the strings (P12: messages
 *     are fixed presets, never parent-authored free text).
 *   - Selecting a preset POSTs `{ student_id, message_key }` to
 *     /api/v2/parent/encourage with the parent's Supabase JWT in the
 *     Authorization header (same Bearer pattern WeeklyReport uses).
 *   - States: sending (disabled), success ("Sent!"), 429 (recently cheered),
 *     403/other (friendly bilingual error). All copy is bilingual via `isHi`
 *     (P7). No PII is logged — the component logs nothing (P13).
 */

import { useState } from 'react';
import { supabase } from '@alfanumrik/lib/supabase';
import { CHEER_PRESETS } from '@alfanumrik/lib/parent/cheer-catalog';
import { Alert } from '@alfanumrik/ui/ui/primitives';

// ─── Bilingual helper (P7) — matches the parent page's `t(isHi, en, hi)`. ───
const t = (isHi: boolean, en: string, hi: string) => (isHi ? hi : en);

type SendState =
  | { kind: 'idle' }
  | { kind: 'sending'; key: string }
  | { kind: 'success' }
  | { kind: 'rate_limited' }
  | { kind: 'error' };

interface EncourageButtonProps {
  /** The linked child to cheer. */
  studentId: string;
  childName: string;
  isHi: boolean;
}

// Stable ordering for the picker (object key order is insertion order, which
// matches the curated catalog ordering — kept explicit for clarity).
const PRESET_KEYS = Object.keys(CHEER_PRESETS);

export default function EncourageButton({ studentId, childName, isHi }: EncourageButtonProps) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<SendState>({ kind: 'idle' });

  const sending = state.kind === 'sending';

  async function send(messageKey: string) {
    if (sending) return;
    setState({ kind: 'sending', key: messageKey });
    try {
      // Reuse the same Bearer-auth pattern WeeklyReport uses for authed fetches:
      // attach the parent's Supabase JWT so the guardian-only route authorizes.
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;

      const res = await fetch('/api/v2/parent/encourage', {
        method: 'POST',
        headers,
        body: JSON.stringify({ student_id: studentId, message_key: messageKey }),
      });

      if (res.ok) {
        setState({ kind: 'success' });
        setOpen(false);
        return;
      }
      if (res.status === 429) {
        setState({ kind: 'rate_limited' });
        return;
      }
      // 400 / 403 / 5xx — friendly, generic message (no server text surfaced).
      setState({ kind: 'error' });
    } catch {
      // Network/parse failure — no PII to log; show a friendly error (P13).
      setState({ kind: 'error' });
    }
  }

  // ── Success: replace the affordance with a warm confirmation. ──
  if (state.kind === 'success') {
    return (
      <Alert tone="success">
        {t(isHi, `Sent to ${childName}! 🎉`, `${childName} को भेज दिया! 🎉`)}
      </Alert>
    );
  }

  return (
    <div>
      {/* Trigger — matches the other Action rows in ParentGlanceHome. */}
      <button
        onClick={() => {
          // Re-opening after an error clears the error so the picker is usable.
          if (state.kind === 'error' || state.kind === 'rate_limited') setState({ kind: 'idle' });
          setOpen((v) => !v);
        }}
        aria-expanded={open}
        className="flex min-h-[44px] w-full cursor-pointer items-center gap-3 rounded-xl border border-surface-3 bg-surface-1 px-4 py-3 text-left"
      >
        <span className="text-lg" aria-hidden="true">
          &#x1F44F;
        </span>
        <span className="flex-1 text-sm font-semibold text-foreground">
          {t(isHi, `Encourage ${childName}`, `${childName} को प्रोत्साहित करें`)}
        </span>
        <span className="text-lg text-primary" aria-hidden="true">
          {open ? '⌄' : '→'}
        </span>
      </button>

      {/* Inline preset picker — only mounted when open. */}
      {open && (
        <div
          className="mt-2 rounded-xl border border-surface-3 bg-surface-1 p-2"
          role="group"
          aria-label={t(isHi, 'Pick an encouragement', 'एक प्रोत्साहन चुनें')}
        >
          <p className="px-2 pb-1.5 pt-1 text-2xs uppercase tracking-wide text-muted-foreground">
            {t(isHi, 'Pick a cheer to send', 'भेजने के लिए एक प्रोत्साहन चुनें')}
          </p>
          <div className="flex flex-col gap-1">
            {PRESET_KEYS.map((key) => {
              const preset = CHEER_PRESETS[key];
              const isThisSending = state.kind === 'sending' && state.key === key;
              return (
                <button
                  key={key}
                  onClick={() => send(key)}
                  disabled={sending}
                  className="flex min-h-[44px] cursor-pointer items-center gap-2.5 rounded-lg border border-transparent bg-surface-2 px-2.5 py-2 text-left hover:bg-surface-3 disabled:cursor-default disabled:opacity-50"
                >
                  <span className="flex-shrink-0 text-base" aria-hidden="true">
                    {preset.icon}
                  </span>
                  <span className="flex-1 text-sm font-medium text-foreground">
                    {isHi ? preset.titleHi : preset.titleEn}
                  </span>
                  {isThisSending && (
                    <span
                      className="inline-block h-3.5 w-3.5 flex-shrink-0 animate-spin rounded-full border-2 border-surface-3 border-t-primary"
                      aria-hidden="true"
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Rate-limited (429) — already cheered within the 6h window. A polite
          status (not an assertive alert) — matches the original role="status". */}
      {state.kind === 'rate_limited' && (
        <div className="mt-2">
          <Alert tone="warning" role="status">
            {t(
              isHi,
              `You already cheered ${childName} recently — try again later.`,
              `आपने हाल ही में ${childName} को प्रोत्साहित किया — कृपया बाद में पुनः प्रयास करें।`,
            )}
          </Alert>
        </div>
      )}

      {/* Other errors (400 / 403 / network) — friendly, generic. */}
      {state.kind === 'error' && (
        <div className="mt-2">
          <Alert tone="danger">
            {t(
              isHi,
              "Couldn't send right now. Please try again in a moment.",
              'अभी भेजने में समस्या हुई। कृपया थोड़ी देर बाद पुनः प्रयास करें।',
            )}
          </Alert>
        </div>
      )}
    </div>
  );
}
