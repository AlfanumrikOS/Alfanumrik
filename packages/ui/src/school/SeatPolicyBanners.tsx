'use client';

/**
 * Phase 3B — Wave B: shared seat-policy UI bits for the school-admin provisioning
 * surfaces (enroll page, invite-codes page). ALL of these render ONLY when the
 * caller has already gated on `useSchoolProvisioning()` (flag ON). When the flag
 * is OFF these components are never mounted, so the provisioning pages stay
 * byte-identical to today.
 *
 * Boundary discipline (frontend):
 *   - 100% presentational. NO fetching, NO policy math — every number/date is
 *     rendered VERBATIM from the server response (backend owns the policy; the
 *     SQL is the single source of truth for grace_ceiling / 14-day window).
 *   - P7 bilingual via the `isHi` prop (date formatting is locale-only).
 *   - P13: callers pass counts + an ISO timestamp only; never PII.
 */

import type { SeatPolicyStatus } from '@alfanumrik/lib/school-admin/seat-enforcement';

function t(isHi: boolean, en: string, hi: string): string {
  return isHi ? hi : en;
}

/** Format an ISO date as a short human date (locale-aware, no time). */
function formatDate(iso: string | null | undefined, isHi: boolean): string {
  if (!iso) return t(isHi, 'soon', 'जल्द ही');
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return t(isHi, 'soon', 'जल्द ही');
  return d.toLocaleDateString(isHi ? 'hi-IN' : 'en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** Whole days from now until the ISO timestamp, clamped to >= 0. null when absent. */
function daysLeft(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const ms = d.getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

/* ─────────────────────────────────────────────────────────────
   GRACE WARNING BANNER (soft-allow: enrollment succeeded but the
   school is over its plan seats; a 14-day grace window is running).
───────────────────────────────────────────────────────────── */
interface GraceWarningBannerProps {
  /** ISO grace-window end from the server `warning.grace_expires_at`. */
  graceExpiresAt: string | null | undefined;
  /** Server `warning.grace_ceiling` — the floor(seats*1.10) hard cap. */
  graceCeiling?: number | null;
  isHi: boolean;
}

export function GraceWarningBanner({ graceExpiresAt, graceCeiling, isHi }: GraceWarningBannerProps) {
  const days = daysLeft(graceExpiresAt);
  const when = formatDate(graceExpiresAt, isHi);

  const daysPhraseEn =
    days == null
      ? 'a short grace window'
      : days === 1
        ? '1 day left in your grace window'
        : `${days} days left in your grace window`;
  const daysPhraseHi =
    days == null
      ? 'एक छोटी छूट अवधि'
      : days === 1
        ? 'आपकी छूट अवधि में 1 दिन शेष'
        : `आपकी छूट अवधि में ${days} दिन शेष`;

  const ceilingEn = graceCeiling != null ? ` (limit ${graceCeiling} seats)` : '';
  const ceilingHi = graceCeiling != null ? ` (सीमा ${graceCeiling} सीटें)` : '';

  return (
    <div
      role="status"
      className="rounded-2xl p-4"
      style={{ background: '#FFFBEB', border: '1px solid #FDE68A' }}
    >
      <div className="flex items-start gap-3">
        <span className="text-xl flex-shrink-0" aria-hidden="true">⚠️</span>
        <div className="min-w-0">
          <p className="text-sm font-bold" style={{ color: '#92400E' }}>
            {t(isHi, "You're over your plan seats", 'आप अपनी योजना की सीटों से अधिक हैं')}
          </p>
          <p className="text-xs mt-1" style={{ color: '#92400E' }}>
            {t(
              isHi,
              `${daysPhraseEn}${ceilingEn}. Upgrade your plan or remove students before ${when}, or new enrolments will be blocked.`,
              `${daysPhraseHi}${ceilingHi}। ${when} से पहले अपनी योजना अपग्रेड करें या छात्र हटाएं, अन्यथा नए नामांकन रोक दिए जाएंगे।`,
            )}
          </p>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   HARD-BLOCK MESSAGE (seat_cap_violation — grace_expired | over_ceiling).
   Enrollment / activation was refused. Show the plain blocking copy.
───────────────────────────────────────────────────────────── */
interface SeatCapBlockBannerProps {
  /** Server `status` from the 409 body (drives slightly different copy). */
  status?: SeatPolicyStatus | null;
  isHi: boolean;
  /** Optional dismiss handler — when present, renders a "Dismiss" affordance. */
  onDismiss?: () => void;
}

export function SeatCapBlockBanner({ status, isHi, onDismiss }: SeatCapBlockBannerProps) {
  // grace_expired and over_ceiling are both hard blocks; copy is intentionally
  // the same actionable sentence ("upgrade or free up seats").
  return (
    <div
      role="alert"
      className="rounded-2xl p-4"
      style={{ background: '#FEF2F2', border: '1px solid #FCA5A5' }}
    >
      <div className="flex items-start gap-3">
        <span className="text-xl flex-shrink-0" aria-hidden="true">🚫</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold" style={{ color: '#991B1B' }}>
            {t(isHi, 'Seat limit reached', 'सीट सीमा पूरी हो गई')}
          </p>
          <p className="text-xs mt-1" style={{ color: '#991B1B' }}>
            {status === 'grace_expired'
              ? t(
                  isHi,
                  'Your grace period has ended. Upgrade your plan or free up seats by deactivating students before adding more.',
                  'आपकी छूट अवधि समाप्त हो गई है। और जोड़ने से पहले अपनी योजना अपग्रेड करें या छात्रों को निष्क्रिय करके सीटें खाली करें।',
                )
              : t(
                  isHi,
                  'Upgrade your plan or free up seats by deactivating students before adding more.',
                  'और जोड़ने से पहले अपनी योजना अपग्रेड करें या छात्रों को निष्क्रिय करके सीटें खाली करें।',
                )}
          </p>
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              className="text-xs font-semibold mt-2"
              style={{ color: '#DC2626' }}
            >
              {t(isHi, 'Dismiss', 'बंद करें')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   INVITE-CODE SEAT-CAP NOTICE (max_uses_capped_to_seats).
   The generated code's uses were trimmed to the remaining seats.
───────────────────────────────────────────────────────────── */
interface InviteCapNoticeProps {
  /** Server `remaining_seats` available when the code was minted. */
  remainingSeats: number;
  isHi: boolean;
}

export function InviteCapNotice({ remainingSeats, isHi }: InviteCapNoticeProps) {
  return (
    <div
      role="status"
      className="rounded-xl p-3"
      style={{ background: '#EFF6FF', border: '1px solid #BFDBFE' }}
    >
      <p className="text-xs" style={{ color: '#1E40AF' }}>
        {t(
          isHi,
          `This code's uses were capped to your ${remainingSeats} remaining seat${remainingSeats === 1 ? '' : 's'}. Upgrade your plan to invite more students.`,
          `इस कोड के उपयोग आपकी ${remainingSeats} शेष सीट${remainingSeats === 1 ? '' : 'ों'} तक सीमित कर दिए गए। और छात्रों को आमंत्रित करने के लिए अपनी योजना अपग्रेड करें।`,
        )}
      </p>
    </div>
  );
}
