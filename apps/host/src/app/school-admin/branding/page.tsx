'use client';

/**
 * /school-admin/branding — White-label branding management page.
 *
 * Lets a tenant admin (with `school.manage_branding`) configure:
 *   - Logo URL (hosted image)
 *   - Primary / secondary brand colors (hex)
 *   - Tagline (≤200 chars, public-facing)
 *   - Billing email (where invoices go)
 *   - Typography: font_heading, font_body (≤200 chars, CSS font stacks)
 *   - Border radius (0–32 px, applied via --tenant-radius CSS var)
 *
 * Read-only:
 *   - `tenant_type` (school | coaching | corporate | government). Changing it
 *     alters default modules + copy + billing assumptions; that's super-admin
 *     scope (a separate /api/super-admin/institutions PATCH path). Surfacing
 *     it here read-only lets admins SEE their type without owning the change.
 *
 * Backed by GET / PUT /api/school-admin/branding (#563).
 *
 * No migration needed — every column referenced was added by the Phase B
 * migration already in prod (20260507000004).
 */

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { authedFetch } from '@alfanumrik/lib/school-admin/authed-fetch';
import { Card, Button, Input, Skeleton } from '@alfanumrik/ui/ui';

// ─── Bilingual helper ─────────────────────────────────────────────────
function t(isHi: boolean, en: string, hi: string): string {
  return isHi ? hi : en;
}

// ─── Types ────────────────────────────────────────────────────────────
interface BrandingResponse {
  id: string;
  slug: string | null;
  logo_url: string | null;
  primary_color: string | null;
  secondary_color: string | null;
  tagline: string | null;
  custom_domain: string | null;
  domain_verified: boolean | null;
  billing_email: string | null;
  tenant_type: 'school' | 'coaching' | 'corporate' | 'government';
  font_heading: string | null;
  font_body: string | null;
  border_radius_px: number | null;
}

interface FormState {
  logoUrl: string;
  primaryColor: string;
  secondaryColor: string;
  tagline: string;
  billingEmail: string;
  fontHeading: string;
  fontBody: string;
  borderRadiusPx: string; // text input — coerced to number on save
}

const TENANT_TYPE_LABELS: Record<BrandingResponse['tenant_type'], { en: string; hi: string }> = {
  school:     { en: 'School',             hi: 'स्कूल' },
  coaching:   { en: 'Coaching Institute', hi: 'कोचिंग संस्थान' },
  corporate:  { en: 'Corporate',          hi: 'कॉर्पोरेट' },
  government: { en: 'Government',         hi: 'सरकारी' },
};

// ─── Validators (match server-side rules from #563) ───────────────────
const HEX_RE = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;

function isValidHex(v: string): boolean {
  return v === '' || HEX_RE.test(v);
}

function isValidEmail(v: string): boolean {
  return v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

function isValidRadius(v: string): boolean {
  if (v === '') return true;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 32;
}

// ─── Page ─────────────────────────────────────────────────────────────
export default function BrandingPage() {
  const { isHi } = useAuth() as { isHi?: boolean };
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [data, setData] = useState<BrandingResponse | null>(null);
  const [form, setForm] = useState<FormState>({
    logoUrl: '',
    primaryColor: '',
    secondaryColor: '',
    tagline: '',
    billingEmail: '',
    fontHeading: '',
    fontBody: '',
    borderRadiusPx: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authedFetch('/api/school-admin/branding');
      const body = await res.json();
      if (!res.ok || !body.success) {
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const d = body.data as BrandingResponse;
      setData(d);
      setForm({
        logoUrl: d.logo_url ?? '',
        primaryColor: d.primary_color ?? '',
        secondaryColor: d.secondary_color ?? '',
        tagline: d.tagline ?? '',
        billingEmail: d.billing_email ?? '',
        fontHeading: d.font_heading ?? '',
        fontBody: d.font_body ?? '',
        borderRadiusPx: d.border_radius_px != null ? String(d.border_radius_px) : '',
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const validate = (): string | null => {
    if (!isValidHex(form.primaryColor)) return t(!!isHi, 'Primary color must be a valid hex (e.g. #7C3AED)', 'प्राथमिक रंग वैध हेक्स होना चाहिए (जैसे #7C3AED)');
    if (!isValidHex(form.secondaryColor)) return t(!!isHi, 'Secondary color must be a valid hex', 'द्वितीयक रंग वैध हेक्स होना चाहिए');
    if (form.tagline.length > 200) return t(!!isHi, 'Tagline must be 200 characters or less', 'टैगलाइन 200 अक्षरों या उससे कम होनी चाहिए');
    if (!isValidEmail(form.billingEmail)) return t(!!isHi, 'Billing email must be a valid email', 'बिलिंग ईमेल वैध होना चाहिए');
    if (form.fontHeading.length > 200) return t(!!isHi, 'Heading font stack must be 200 characters or less', 'हेडिंग फ़ॉन्ट स्टैक 200 अक्षरों या उससे कम');
    if (form.fontBody.length > 200) return t(!!isHi, 'Body font stack must be 200 characters or less', 'बॉडी फ़ॉन्ट स्टैक 200 अक्षरों या उससे कम');
    if (!isValidRadius(form.borderRadiusPx)) return t(!!isHi, 'Border radius must be an integer 0–32', 'बॉर्डर रेडियस 0–32 का पूर्णांक होना चाहिए');
    return null;
  };

  const onSave = async () => {
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // Send only changed/non-empty fields. Empty string → null on server side
      // for all string fields per the route's existing semantics. Border
      // radius coerced to integer (or null when blank).
      const body: Record<string, unknown> = {
        logo_url: form.logoUrl.trim() || null,
        primary_color: form.primaryColor.trim() || null,
        secondary_color: form.secondaryColor.trim() || null,
        tagline: form.tagline.trim() || null,
        billing_email: form.billingEmail.trim() || null,
        font_heading: form.fontHeading.trim() || null,
        font_body: form.fontBody.trim() || null,
        border_radius_px: form.borderRadiusPx.trim() === '' ? null : parseInt(form.borderRadiusPx, 10),
      };
      const res = await authedFetch('/api/school-admin/branding', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!res.ok || !j.success) {
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      setSavedAt(new Date().toLocaleTimeString());
      // Re-load to capture canonical server state (and trim/lowercase normalisation).
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="app-container py-6">
        <Skeleton variant="title" height={28} width="40%" />
        <div className="mt-4 space-y-3">
          <Skeleton variant="rect" height={100} />
          <Skeleton variant="rect" height={100} />
          <Skeleton variant="rect" height={100} />
        </div>
      </div>
    );
  }

  return (
    <div className="app-container py-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">{t(!!isHi, 'Branding & Theme', 'ब्रांडिंग और थीम')}</h1>
        {data && (
          <p className="text-sm text-[color:var(--text-2)] mt-1">
            {t(!!isHi, 'Tenant type', 'टेनेंट प्रकार')}:{' '}
            <strong>{TENANT_TYPE_LABELS[data.tenant_type][isHi ? 'hi' : 'en']}</strong>
            <span className="ml-2 text-xs text-[color:var(--text-3)]">
              ({t(!!isHi, 'read-only — contact support to change', 'केवल पढ़ने के लिए — बदलने हेतु सहायता से संपर्क करें')})
            </span>
          </p>
        )}
      </header>

      {error && (
        <Card className="p-4 mb-4 border-l-4 border-l-[color:var(--red)]">
          <p className="text-sm text-[color:var(--red)]">{error}</p>
        </Card>
      )}

      {savedAt && !error && (
        <Card className="p-4 mb-4 border-l-4 border-l-[color:var(--green)]">
          <p className="text-sm text-[color:var(--green)]">
            {t(!!isHi, `Saved at ${savedAt}`, `${savedAt} पर सहेजा गया`)}
          </p>
        </Card>
      )}

      {/* Identity */}
      <Card className="p-5 mb-4">
        <h2 className="text-lg font-semibold mb-4">{t(!!isHi, 'Identity', 'पहचान')}</h2>
        <div className="space-y-4">
          <Input
            label={t(!!isHi, 'Logo URL', 'लोगो URL')}
            placeholder="https://cdn.example.com/logo.png"
            value={form.logoUrl}
            onChange={e => setForm({ ...form, logoUrl: e.target.value })}
          />
          <Input
            label={t(!!isHi, 'Tagline', 'टैगलाइन')}
            placeholder={t(!!isHi, 'A short school motto', 'स्कूल का छोटा आदर्श वाक्य')}
            maxLength={200}
            value={form.tagline}
            onChange={e => setForm({ ...form, tagline: e.target.value })}
          />
          <Input
            label={t(!!isHi, 'Billing email', 'बिलिंग ईमेल')}
            placeholder="billing@school.edu"
            value={form.billingEmail}
            onChange={e => setForm({ ...form, billingEmail: e.target.value })}
          />
        </div>
      </Card>

      {/* Colors */}
      <Card className="p-5 mb-4">
        <h2 className="text-lg font-semibold mb-4">{t(!!isHi, 'Colors', 'रंग')}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            label={t(!!isHi, 'Primary color (hex)', 'प्राथमिक रंग (हेक्स)')}
            placeholder="#7C3AED"
            value={form.primaryColor}
            onChange={e => setForm({ ...form, primaryColor: e.target.value })}
          />
          <Input
            label={t(!!isHi, 'Secondary color (hex)', 'द्वितीयक रंग (हेक्स)')}
            placeholder="#F97316"
            value={form.secondaryColor}
            onChange={e => setForm({ ...form, secondaryColor: e.target.value })}
          />
        </div>
        {form.primaryColor && form.secondaryColor && isValidHex(form.primaryColor) && isValidHex(form.secondaryColor) && (
          <div className="mt-4 flex gap-3">
            <div className="h-10 w-10 rounded" style={{ background: form.primaryColor }} aria-label="primary preview" />
            <div className="h-10 w-10 rounded" style={{ background: form.secondaryColor }} aria-label="secondary preview" />
          </div>
        )}
      </Card>

      {/* Typography (Phase B) */}
      <Card className="p-5 mb-4">
        <h2 className="text-lg font-semibold mb-1">{t(!!isHi, 'Typography', 'टाइपोग्राफी')}</h2>
        <p className="text-sm text-[color:var(--text-3)] mb-4">
          {t(
            !!isHi,
            'CSS font stacks. Falls back to Alfanumrik defaults when blank.',
            'CSS फ़ॉन्ट स्टैक। खाली होने पर Alfanumrik डिफ़ॉल्ट पर वापस।',
          )}
        </p>
        <div className="space-y-4">
          <Input
            label={t(!!isHi, 'Heading font stack', 'हेडिंग फ़ॉन्ट स्टैक')}
            placeholder="Inter, system-ui, sans-serif"
            maxLength={200}
            value={form.fontHeading}
            onChange={e => setForm({ ...form, fontHeading: e.target.value })}
          />
          <Input
            label={t(!!isHi, 'Body font stack', 'बॉडी फ़ॉन्ट स्टैक')}
            placeholder="system-ui, -apple-system, sans-serif"
            maxLength={200}
            value={form.fontBody}
            onChange={e => setForm({ ...form, fontBody: e.target.value })}
          />
          <Input
            label={t(!!isHi, 'Border radius (0–32 px)', 'बॉर्डर रेडियस (0–32 px)')}
            placeholder="8"
            type="number"
            min={0}
            max={32}
            value={form.borderRadiusPx}
            onChange={e => setForm({ ...form, borderRadiusPx: e.target.value })}
          />
        </div>
      </Card>

      <div className="flex justify-end gap-3 pt-2">
        <Button variant="ghost" onClick={load} disabled={saving}>
          {t(!!isHi, 'Reset', 'रीसेट')}
        </Button>
        <Button variant="primary" onClick={onSave} disabled={saving}>
          {saving ? t(!!isHi, 'Saving…', 'सहेज रहे हैं…') : t(!!isHi, 'Save changes', 'परिवर्तन सहेजें')}
        </Button>
      </div>
    </div>
  );
}
