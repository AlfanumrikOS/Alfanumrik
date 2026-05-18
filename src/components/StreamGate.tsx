'use client';

/**
 * StreamGate — global modal that forces grade 11/12 students with a NULL
 * `students.stream` to pick science/commerce/humanities before they can
 * navigate the app.
 *
 * Why this exists (2026-05-18):
 *   The dashboard already has an inline stream picker (PR #838), but
 *   students who land directly on /foxy, /learn, /quiz, etc. never saw it
 *   and the v1 RPC `get_available_subjects` returned every stream subject
 *   (because the stream filter is `stream IS NULL OR stream = s.stream OR
 *   s.stream IS NULL`). Clicking physics on the free plan then hit a 422
 *   from validateSubjectWrite ('plan') and rendered "Oops! Please try
 *   again." in Foxy. Forcing stream selection up front fixes the source.
 *
 *   Auth-only: nothing renders for logged-out visitors, teachers, parents,
 *   or grades 6-10. The picker only auto-opens when `student.stream` is
 *   nullish; the dashboard's "change stream" chip still drives its own
 *   local picker, so this component never blocks an intentional update.
 */

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { authHeader } from '@/lib/api/auth-header';

type StreamKey = 'science' | 'commerce' | 'humanities';

// DB enum value is `humanities`; UI label is "Arts" per CEO call (the two
// terms are used interchangeably across CBSE schools — keeping the DB
// canonical avoids cascading a rename through migrations, RPCs, demo
// personas, and tests).
const STREAM_OPTIONS: ReadonlyArray<{
  key: StreamKey;
  icon: string;
  label: string;
  labelHi: string;
  desc: string;
  color: string;
}> = [
  { key: 'science',    icon: '⚗️', label: 'Science',  labelHi: 'विज्ञान', desc: 'Physics · Chemistry · Biology · Math',     color: '#2563EB' },
  { key: 'commerce',   icon: '📊', label: 'Commerce', labelHi: 'वाणिज्य',  desc: 'Accountancy · Business · Economics',       color: '#D97706' },
  { key: 'humanities', icon: '🌍', label: 'Arts',     labelHi: 'मानविकी',  desc: 'History · Political Science · Geography', color: '#7C3AED' },
];

function needsStream(grade: string | null | undefined, stream: string | null | undefined): boolean {
  if (grade !== '11' && grade !== '12') return false;
  return stream !== 'science' && stream !== 'commerce' && stream !== 'humanities';
}

export default function StreamGate() {
  const { student, isLoggedIn, isHi, refreshStudent } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Hide UI on the very first render to avoid a flash before AuthContext
  // hydrates; we re-enable it once the auth state is known.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(true);
  }, []);

  if (!ready || !isLoggedIn || !student) return null;
  if (!needsStream(student.grade, student.stream)) return null;

  const pick = async (key: StreamKey) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      // Auth tokens live in localStorage in this app (no middleware syncs
      // them to cookies). Server route's authorizeRequest() relies on the
      // Authorization header; without it, every click 401s. See
      // src/lib/api/auth-header.ts.
      const res = await fetch('/api/student/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ action: 'set_stream', stream: key }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        // 409 stream_already_set means someone else (super-admin? race?) set
        // it between hydration and click. Refresh AuthContext so the gate
        // dismisses with the now-correct stream rather than showing an error.
        if (res.status === 409 && body?.error === 'stream_already_set') {
          await refreshStudent();
          return;
        }
        const reason = typeof body?.error === 'string' ? body.error : `HTTP ${res.status}`;
        setError(isHi ? `सहेजने में समस्या: ${reason}` : `Could not save: ${reason}`);
        return;
      }
      // refreshStudent() pulls the new stream out of AuthContext, which
      // dismisses this gate via needsStream(). No localStorage cache —
      // nothing reads it (the dashboard chip reads student.stream).
      await refreshStudent();
    } catch (e) {
      console.error('[stream-gate] persist failed:', e);
      setError(isHi ? 'नेटवर्क समस्या, फिर कोशिश करें' : 'Network error — please retry');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="stream-gate-title"
      className="fixed inset-0 z-[90] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)' }}
    >
      <div
        className="w-full max-w-sm rounded-3xl p-6 shadow-2xl"
        style={{ background: 'var(--warm-cream, #FFF9F0)', border: '1px solid var(--border)' }}
      >
        <div className="text-center mb-5">
          <div className="text-4xl mb-2" aria-hidden="true">🎓</div>
          <h2 id="stream-gate-title" className="font-bold text-xl" style={{ color: 'var(--text-1)' }}>
            {isHi ? 'अपनी स्ट्रीम चुनें' : 'Choose Your Stream'}
          </h2>
          <p className="text-sm mt-1" style={{ color: 'var(--text-2)' }}>
            {isHi ? `कक्षा ${student.grade} · CBSE` : `Class ${student.grade} · CBSE`}
          </p>
          <p className="text-xs mt-2" style={{ color: 'var(--text-3)' }}>
            {isHi
              ? 'इसके बिना विषय अनलॉक नहीं होंगे'
              : 'Subjects unlock based on this choice'}
          </p>
          {/* Stream is locked after the first pick (CEO requirement
              2026-05-18). Make that visible *before* the click so students
              don't tap through assuming it's reversible. */}
          <p
            className="text-[11px] mt-3 font-semibold px-3 py-1.5 rounded-lg inline-block"
            style={{
              background: 'rgba(217,119,6,0.10)',
              color: '#B45309',
              border: '1px solid rgba(217,119,6,0.30)',
            }}
          >
            {isHi
              ? '⚠️ यह चयन स्थायी है — सोच-समझ कर चुनें'
              : '⚠️ This choice is permanent — pick carefully'}
          </p>
        </div>

        {error && (
          <div
            role="alert"
            className="mb-3 text-xs px-3 py-2 rounded-lg"
            style={{ background: 'rgba(220,38,38,0.08)', color: '#B91C1C', border: '1px solid rgba(220,38,38,0.25)' }}
          >
            {error}
          </div>
        )}

        <div className="space-y-3">
          {STREAM_OPTIONS.map((st) => (
            <button
              key={st.key}
              onClick={() => pick(st.key)}
              disabled={busy}
              className="w-full flex items-center gap-4 p-4 rounded-2xl text-left transition-all hover:scale-[1.01] disabled:opacity-60 disabled:cursor-not-allowed"
              style={{ background: 'var(--surface-1)', border: `2px solid ${st.color}30` }}
            >
              <span className="text-3xl" aria-hidden="true">{st.icon}</span>
              <div>
                <p className="font-bold text-base" style={{ color: st.color }}>
                  {isHi ? st.labelHi : st.label}
                </p>
                <p className="text-xs" style={{ color: 'var(--text-2)' }}>
                  {st.desc}
                </p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
