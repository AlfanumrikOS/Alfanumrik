'use client';

/**
 * /super-admin/enroll-mfa — TOTP second-factor enrollment for admin accounts.
 *
 * P1-10 (2026-09-02 launch audit). Standalone from the ff_admin_aal2_enforcement_v1
 * enforcement flag (packages/lib/src/admin-auth.ts) on purpose: this page lets an
 * admin enroll BEFORE enforcement is ever turned on, so the rollout can be
 * "everyone enrolls first, then we flip the flag" rather than a surprise lockout.
 * GoTrue-native (supabase.auth.mfa.*) — no custom backend, no new table.
 */

import { useEffect, useState } from 'react';
import AdminShell from '../_components/AdminShell';
import { supabase } from '@alfanumrik/lib/supabase-client';

interface EnrolledFactor {
  id: string;
  friendly_name?: string | null;
  status: string;
}

type Step = 'loading' | 'idle' | 'enrolling' | 'verifying' | 'done';

function EnrollMfaContent() {
  const [step, setStep] = useState<Step>('loading');
  const [factors, setFactors] = useState<EnrolledFactor[]>([]);
  const [currentAal, setCurrentAal] = useState<string | null>(null);
  const [qrCodeSvg, setQrCodeSvg] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refreshFactors() {
    const [{ data: factorsData, error: factorsErr }, { data: aalData }] = await Promise.all([
      supabase.auth.mfa.listFactors(),
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    ]);
    if (factorsErr) {
      setError(factorsErr.message);
    } else {
      setFactors((factorsData?.totp ?? []) as EnrolledFactor[]);
    }
    setCurrentAal(aalData?.currentLevel ?? null);
    setStep('idle');
  }

  useEffect(() => {
    void refreshFactors();
  }, []);

  async function startEnrollment() {
    setError(null);
    setBusy(true);
    try {
      const { data, error: enrollErr } = await supabase.auth.mfa.enroll({ factorType: 'totp' });
      if (enrollErr) throw enrollErr;
      setFactorId(data.id);
      setQrCodeSvg(data.totp.qr_code);
      setSecret(data.totp.secret);
      setStep('enrolling');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start enrollment.');
    } finally {
      setBusy(false);
    }
  }

  async function verifyEnrollment() {
    if (!factorId || code.trim().length === 0) return;
    setError(null);
    setBusy(true);
    try {
      const { data: challenge, error: challengeErr } = await supabase.auth.mfa.challenge({ factorId });
      if (challengeErr) throw challengeErr;
      const { error: verifyErr } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challenge.id,
        code: code.trim(),
      });
      if (verifyErr) throw verifyErr;
      setStep('done');
      setCode('');
      setQrCodeSvg(null);
      setSecret(null);
      await refreshFactors();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That code did not verify. Check the time on your device and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function removeFactor(id: string) {
    if (!window.confirm('Remove this authenticator? You will need to enroll again before AAL2 enforcement can be turned on.')) return;
    setError(null);
    setBusy(true);
    try {
      const { error: unenrollErr } = await supabase.auth.mfa.unenroll({ factorId: id });
      if (unenrollErr) throw unenrollErr;
      await refreshFactors();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove that factor.');
    } finally {
      setBusy(false);
    }
  }

  const verifiedFactors = factors.filter((f) => f.status === 'verified');

  return (
    <div style={{ maxWidth: 480 }}>
      <div style={{ marginBottom: 20 }}>
        <h1 className="text-xl font-bold text-foreground">Two-factor authentication</h1>
        <p style={{ fontSize: 13, color: '#9CA3AF', margin: 0 }}>
          Admin accounts will require a verified authenticator app once enforcement is turned on.
          Enroll now so you are not locked out later.
        </p>
      </div>

      {step === 'loading' && <p style={{ fontSize: 13, color: '#6B7280' }}>Loading your current status…</p>}

      {step !== 'loading' && (
        <div style={{ marginBottom: 20, padding: 14, border: '1px solid #E5E7EB', borderRadius: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
            Current session level: {currentAal === 'aal2' ? 'aal2 (verified)' : 'aal1 (password only)'}
          </div>
          {verifiedFactors.length === 0 ? (
            <div style={{ fontSize: 13, color: '#B45309' }}>No authenticator enrolled yet.</div>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: '#111827' }}>
              {verifiedFactors.map((f) => (
                <li key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span>{f.friendly_name || 'Authenticator app'}</span>
                  <button
                    onClick={() => void removeFactor(f.id)}
                    disabled={busy}
                    style={{ fontSize: 12, color: '#B91C1C', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && (
        <div style={{ marginBottom: 16, padding: 10, background: '#FEF2F2', color: '#B91C1C', fontSize: 13, borderRadius: 6 }}>
          {error}
        </div>
      )}

      {step === 'idle' && (
        <button
          onClick={() => void startEnrollment()}
          disabled={busy}
          style={{
            padding: '10px 18px', fontSize: 13, fontWeight: 600, color: '#fff',
            background: '#111827', border: 'none', borderRadius: 6, cursor: 'pointer',
          }}
        >
          {verifiedFactors.length > 0 ? 'Enroll another authenticator' : 'Enroll an authenticator app'}
        </button>
      )}

      {step === 'enrolling' && qrCodeSvg && (
        <div>
          <p style={{ fontSize: 13, marginBottom: 8 }}>
            Scan this with Google Authenticator, 1Password, or any TOTP app. Can&apos;t scan? Enter the code manually:
          </p>
          <code style={{ display: 'block', fontSize: 12, background: '#F3F4F6', padding: 8, borderRadius: 6, marginBottom: 12, wordBreak: 'break-all' }}>
            {secret}
          </code>
          <div
            style={{ width: 200, height: 200, marginBottom: 12 }}
            // Server-generated SVG from GoTrue's own enroll response — not
            // user-controlled input.
            dangerouslySetInnerHTML={{ __html: qrCodeSvg }}
          />
          <input
            type="text"
            inputMode="numeric"
            placeholder="6-digit code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            style={{ display: 'block', fontSize: 14, padding: '8px 10px', border: '1px solid #D1D5DB', borderRadius: 6, marginBottom: 10, width: 160 }}
          />
          <button
            onClick={() => void verifyEnrollment()}
            disabled={busy || code.trim().length === 0}
            style={{
              padding: '10px 18px', fontSize: 13, fontWeight: 600, color: '#fff',
              background: '#111827', border: 'none', borderRadius: 6, cursor: 'pointer',
            }}
          >
            Verify and enable
          </button>
        </div>
      )}

      {step === 'done' && (
        <div style={{ padding: 10, background: '#ECFDF5', color: '#065F46', fontSize: 13, borderRadius: 6 }}>
          Authenticator enrolled. Your next login will ask for a code from it.
        </div>
      )}
    </div>
  );
}

export default function EnrollMfaPage() {
  return (
    <AdminShell>
      <EnrollMfaContent />
    </AdminShell>
  );
}
