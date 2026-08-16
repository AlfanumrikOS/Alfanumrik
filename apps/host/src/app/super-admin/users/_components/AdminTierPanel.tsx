'use client';

/**
 * Change-admin-tier panel (PATCH /api/super-admin/users, table:'admin_users').
 *
 * Why a manual user_id entry instead of a picker: GET /api/super-admin/users
 * only maps the `role` query param to students/teachers/guardians (verified
 * in the route — any other role string either 400s or silently falls
 * through to the `students` table). There is no listing endpoint for
 * `admin_users` anywhere in the API surface today, so there's no contract to
 * back a searchable picker without inventing a new API call. This mirrors
 * the existing "Assign Role" flow directly above (also a manual
 * auth_user_id text entry) rather than introducing a new, different pattern.
 * Flagged to backend in the handoff — a listing endpoint would let this
 * become a proper picker.
 *
 * Confirmation tiers:
 *   - target level !== 'super_admin' → standard destructive confirm.
 *   - target level === 'super_admin' → type-to-confirm (grants the
 *     highest-privilege tier on the platform).
 * Server-side self-demotion / self-elevation / cross-super_admin guards are
 * surfaced verbatim (the API's error copy is already operator-friendly).
 */

import { useState } from 'react';
import { toast } from '@alfanumrik/ui/ui/toast';
import ConfirmActionDialog from './ConfirmActionDialog';
import TypedConfirmDialog from './TypedConfirmDialog';
import { readAdminJson } from '../../_components/AdminShell';

// Exact enum from the PATCH schema's `admin_level` field
// (apps/host/src/app/api/super-admin/users/route.ts). Keep in sync.
const ADMIN_LEVELS = ['support', 'analyst', 'content_manager', 'finance', 'admin', 'super_admin'] as const;
type AdminLevel = typeof ADMIN_LEVELS[number];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AdminTierPanelProps {
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
  isHi: boolean;
  /**
   * Fired right before either confirm dialog opens. The page uses this to
   * close the Users DetailDrawer if it happens to be open concurrently —
   * the shared `Dialog` primitive paints at a lower z-index (--z-modal: 60)
   * than DetailDrawer's hardcoded z-[1000], so a dialog opened while the
   * drawer is visible would render invisibly behind it. See
   * UserSessionsPanel.tsx for the full explanation.
   */
  onBeforeConfirmOpen?: () => void;
}

export default function AdminTierPanel({ apiFetch, isHi, onBeforeConfirmOpen }: AdminTierPanelProps) {
  const [adminUserId, setAdminUserId] = useState('');
  const [level, setLevel] = useState<AdminLevel>('support');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [typedConfirmOpen, setTypedConfirmOpen] = useState(false);

  const requestChange = () => {
    setError(null);
    if (!UUID_RE.test(adminUserId.trim())) {
      setError(isHi ? 'एक मान्य एडमिन user_id (UUID) दर्ज करें' : 'Enter a valid admin user_id (UUID)');
      return;
    }
    onBeforeConfirmOpen?.();
    if (level === 'super_admin') setTypedConfirmOpen(true);
    else setConfirmOpen(true);
  };

  const applyChange = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch('/api/super-admin/users', {
        method: 'PATCH',
        body: JSON.stringify({
          user_id: adminUserId.trim(),
          table: 'admin_users',
          updates: { admin_level: level },
        }),
      });
      const d = await readAdminJson<{ error?: string; success?: boolean }>(res).catch(() => ({}) as { error?: string });
      if (!res.ok) {
        // Server guard errors (self-demotion, self-elevation, cross-super_admin)
        // are already friendly copy — surface them verbatim.
        setError(d.error || (isHi ? 'बदलाव विफल रहा' : 'Change failed'));
        return;
      }
      toast.success(isHi ? 'एडमिन स्तर अपडेट हो गया' : 'Admin tier updated');
      setConfirmOpen(false);
      setTypedConfirmOpen(false);
      setAdminUserId('');
      setLevel('support');
    } catch {
      toast.error(isHi ? 'नेटवर्क त्रुटि — बदलाव सहेजा नहीं गया।' : 'Network error — the change was not saved.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mb-5 rounded-lg border border-surface-3 bg-surface-1 p-4" style={{ borderLeft: '3px solid #DC2626' }}>
      <h3 className="mb-1 text-sm font-bold text-foreground">
        {isHi ? 'एडमिन स्तर बदलें' : 'Change Admin Tier'}
      </h3>
      <p className="mb-3 text-[11px] text-muted-foreground">
        {isHi
          ? 'admin_users रिकॉर्ड का id (UUID) दर्ज करें। केवल super_admin ही यह बदल सकता है; सर्वर अपने खुद के स्तर में बदलाव को अस्वीकार करता है।'
          : "Enter the admin_users record's id (UUID). Only a super_admin can perform this — the server rejects self-edits of your own admin_level."}
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[240px] flex-1">
          <label htmlFor="admin-tier-user-id" className="mb-1 block text-[11px] text-muted-foreground">
            {isHi ? 'एडमिन user_id (UUID)' : 'Admin user_id (UUID)'}
          </label>
          <input
            id="admin-tier-user-id"
            value={adminUserId}
            onChange={(e) => setAdminUserId(e.target.value)}
            placeholder="00000000-0000-0000-0000-000000000000"
            disabled={saving}
            className="w-full rounded-md border border-surface-3 bg-surface-1 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
          />
        </div>
        <div>
          <label htmlFor="admin-tier-level" className="mb-1 block text-[11px] text-muted-foreground">
            {isHi ? 'नया स्तर' : 'New tier'}
          </label>
          <select
            id="admin-tier-level"
            value={level}
            onChange={(e) => setLevel(e.target.value as AdminLevel)}
            disabled={saving}
            className="cursor-pointer rounded-md border border-surface-3 bg-surface-1 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
          >
            {ADMIN_LEVELS.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={requestChange}
          disabled={saving || !adminUserId.trim()}
          aria-busy={saving}
          className="rounded-md bg-danger px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isHi ? 'स्तर बदलें' : 'Change Tier'}
        </button>
      </div>
      {error && <div role="alert" className="mt-2 text-xs font-medium text-danger">{error}</div>}

      <ConfirmActionDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={applyChange}
        isHi={isHi}
        titleEn={`Change admin tier to "${level}"?`}
        titleHi={`एडमिन स्तर को "${level}" में बदलें?`}
        descriptionEn="This changes what this platform admin can access and mutate across every super-admin surface."
        descriptionHi="इससे यह प्लेटफ़ॉर्म एडमिन जो कुछ भी एक्सेस और बदल सकता है, वह हर सुपर-एडमिन सतह पर बदल जाएगा।"
        confirmEn="Change Tier"
        confirmHi="स्तर बदलें"
        destructive
        loading={saving}
      />
      <TypedConfirmDialog
        open={typedConfirmOpen}
        onClose={() => setTypedConfirmOpen(false)}
        onConfirm={applyChange}
        isHi={isHi}
        titleEn="Grant super_admin access?"
        titleHi="super_admin एक्सेस दें?"
        descriptionEn="super_admin has unrestricted access to every super-admin surface, including payments, admin management, and destructive bulk actions — the highest-privilege tier on the platform."
        descriptionHi="super_admin के पास भुगतान, एडमिन प्रबंधन और विनाशकारी बल्क क्रियाओं सहित हर सुपर-एडमिन सतह तक असीमित पहुंच होती है — यह प्लेटफ़ॉर्म पर उच्चतम-विशेषाधिकार स्तर है।"
        confirmToken="SUPER_ADMIN"
        loading={saving}
      />
    </div>
  );
}
