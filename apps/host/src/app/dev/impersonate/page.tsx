'use client';

/**
 * DEV-ONLY session-bypass picker. Blocked in production (see proxy.ts).
 *
 * `window.location.assign` on click, not a plain <a href> — the app's
 * global click-tracking/navigation wrappers (PostHogProvider, DemoModeWrapper,
 * StreamGate, etc. loaded in the root layout) intercept ordinary anchor
 * clicks for SPA-style soft navigation, which breaks for a target that is
 * an API route rather than a page. A forced `location.assign` always
 * produces a real, full top-level browser navigation, so the redirect chain
 * (GET /api/dev/impersonate?role=... -> 303 -> /auth/confirm -> role
 * dashboard) plays out exactly like clicking a real magic-link email would.
 */

const ROLES: Array<{ value: string; label: string }> = [
  { value: 'student', label: 'Student' },
  { value: 'teacher', label: 'Teacher' },
  { value: 'parent', label: 'Parent' },
  { value: 'institution_admin', label: 'School Admin' },
];

export default function DevImpersonatePage() {
  return (
    <div style={{ maxWidth: 420, margin: '80px auto', padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <p style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#999', marginBottom: 8 }}>
        Dev · Not In Nav · 404s in production
      </p>
      <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 8 }}>Impersonate a role</h1>
      <p style={{ fontSize: 14, color: '#666', marginBottom: 24 }}>
        Signs into a fixed, clearly-labeled dev account (
        <code>dev.impersonate.&lt;role&gt;@alfanumrik.demo</code>) via a real
        Supabase magic link — no password ever touched. Idempotent: safe to
        click repeatedly.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {ROLES.map((r) => (
          <button
            key={r.value}
            type="button"
            onClick={() => window.location.assign(`/api/dev/impersonate?role=${r.value}`)}
            style={{
              width: '100%',
              padding: '12px 16px',
              borderRadius: 8,
              border: '1px solid #ddd',
              background: '#fafafa',
              fontSize: 15,
              fontWeight: 600,
              textAlign: 'left',
              color: '#111',
              cursor: 'pointer',
            }}
          >
            {r.label} →
          </button>
        ))}
      </div>
    </div>
  );
}
