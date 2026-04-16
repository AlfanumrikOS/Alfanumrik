'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';
import {
  Card,
  Button,
  Input,
  Badge,
  Skeleton,
  EmptyState,
  SheetModal,
  BottomNav,
} from '@/components/ui';

/* -----------------------------------------------------------------
   BILINGUAL HELPER (P7)
----------------------------------------------------------------- */
function t(isHi: boolean, en: string, hi: string): string {
  return isHi ? hi : en;
}

/* -----------------------------------------------------------------
   TYPES
----------------------------------------------------------------- */
interface ApiKeyRecord {
  id: string;
  name: string;
  key_prefix: string;
  permissions: string[];
  last_used_at: string | null;
  expires_at: string | null;
  is_active: boolean;
  created_at: string;
}

/* -----------------------------------------------------------------
   AVAILABLE PERMISSIONS
----------------------------------------------------------------- */
const AVAILABLE_PERMISSIONS: { value: string; labelEn: string; labelHi: string }[] = [
  { value: 'students.read', labelEn: 'Read Students', labelHi: 'छात्र पढ़ें' },
  { value: 'reports.read', labelEn: 'Read Reports', labelHi: 'रिपोर्ट पढ़ें' },
  { value: 'classes.read', labelEn: 'Read Classes', labelHi: 'कक्षाएं पढ़ें' },
];

const EXPIRY_OPTIONS = [
  { value: '30', labelEn: '30 days', labelHi: '30 दिन' },
  { value: '90', labelEn: '90 days', labelHi: '90 दिन' },
  { value: '180', labelEn: '180 days', labelHi: '180 दिन' },
  { value: '365', labelEn: '365 days', labelHi: '365 दिन' },
  { value: '', labelEn: 'No expiry', labelHi: 'कोई समाप्ति नहीं' },
];

/* -----------------------------------------------------------------
   DATE HELPERS
----------------------------------------------------------------- */
function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt) < new Date();
}

/* -----------------------------------------------------------------
   SKELETON
----------------------------------------------------------------- */
function KeyCardSkeleton() {
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0 space-y-2">
          <Skeleton variant="title" height={18} width="50%" />
          <Skeleton variant="text" height={14} width="65%" />
        </div>
        <Skeleton variant="rect" height={24} width={64} rounded="rounded-full" />
      </div>
      <div className="mt-3 flex gap-2">
        <Skeleton variant="rect" height={24} width={80} rounded="rounded-full" />
        <Skeleton variant="rect" height={24} width={80} rounded="rounded-full" />
      </div>
    </Card>
  );
}

/* -----------------------------------------------------------------
   NEWLY GENERATED KEY DISPLAY
   Shows the full key ONCE with copy button and warning
----------------------------------------------------------------- */
interface NewKeyDisplayProps {
  fullKey: string;
  isHi: boolean;
}

function NewKeyDisplay({ fullKey, isHi }: NewKeyDisplayProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(fullKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // silently ignore clipboard errors
    }
  }

  return (
    <div
      className="rounded-2xl p-4 text-center mt-2 mb-3"
      style={{
        background: 'linear-gradient(135deg, #F0FDF4, #DCFCE7)',
        border: '1.5px solid #16A34A30',
      }}
    >
      <p className="text-xs font-semibold mb-2" style={{ color: '#16A34A' }}>
        {t(isHi, 'Key generated successfully!', 'कुंजी सफलतापूर्वक बनाई गई!')}
      </p>

      {/* Warning */}
      <div
        className="rounded-xl px-3 py-2 mb-3"
        style={{
          background: '#FEF3C730',
          border: '1px solid #F59E0B40',
        }}
      >
        <p className="text-xs font-semibold" style={{ color: '#B45309' }}>
          {t(
            isHi,
            'This key will not be shown again. Copy it now!',
            'यह कुंजी दोबारा नहीं दिखाई जाएगी। अभी कॉपी करें!'
          )}
        </p>
      </div>

      {/* Key display */}
      <p
        className="text-sm font-bold select-all break-all"
        style={{
          fontFamily: 'monospace',
          color: 'var(--text-1)',
          lineHeight: 1.5,
          padding: '8px',
          background: 'rgba(255,255,255,0.7)',
          borderRadius: '12px',
          border: '1px solid var(--border)',
        }}
      >
        {fullKey}
      </p>

      <button
        onClick={handleCopy}
        className="mt-3 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all active:scale-95"
        style={{
          background: copied ? '#16A34A' : 'var(--surface-1)',
          border: '1px solid var(--border)',
          color: copied ? '#fff' : 'var(--text-2)',
          minHeight: '42px',
        }}
      >
        {copied
          ? t(isHi, 'Copied!', 'कॉपी हो गया!')
          : t(isHi, 'Copy Key', 'कुंजी कॉपी करें')}
      </button>
    </div>
  );
}

/* -----------------------------------------------------------------
   API KEY CARD
----------------------------------------------------------------- */
interface KeyCardProps {
  apiKey: ApiKeyRecord;
  isHi: boolean;
  onRevoke: (id: string) => void;
  revokingId: string | null;
}

function KeyCard({ apiKey, isHi, onRevoke, revokingId }: KeyCardProps) {
  const expired = isExpired(apiKey.expires_at);
  const isRevoking = revokingId === apiKey.id;

  const statusLabel = !apiKey.is_active
    ? t(isHi, 'Revoked', 'रद्द')
    : expired
      ? t(isHi, 'Expired', 'समाप्त')
      : t(isHi, 'Active', 'सक्रिय');

  const statusColor = !apiKey.is_active
    ? '#7D7264'
    : expired
      ? '#DC2626'
      : '#16A34A';

  const permissionLabelMap: Record<string, string> = {
    'students.read': t(isHi, 'Students', 'छात्र'),
    'reports.read': t(isHi, 'Reports', 'रिपोर्ट'),
    'classes.read': t(isHi, 'Classes', 'कक्षाएं'),
  };

  const canRevoke = apiKey.is_active && !expired;

  return (
    <Card>
      {/* Header row: name + status */}
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-[var(--text-1)] truncate">
            {apiKey.name}
          </p>
          <p
            className="text-xs mt-0.5"
            style={{
              fontFamily: 'monospace',
              color: 'var(--text-3)',
            }}
          >
            sk_school_{apiKey.key_prefix}...****
          </p>
        </div>
        <Badge color={statusColor}>{statusLabel}</Badge>
      </div>

      {/* Permissions */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {apiKey.permissions.map((perm) => (
          <Badge key={perm} color="var(--purple)" size="sm">
            {permissionLabelMap[perm] ?? perm}
          </Badge>
        ))}
      </div>

      {/* Meta info */}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
        <p className="text-xs" style={{ color: 'var(--text-3)' }}>
          {t(isHi, 'Created:', 'बनाया गया:')}{' '}
          {formatDate(apiKey.created_at)}
        </p>
        {apiKey.expires_at && (
          <p className="text-xs" style={{ color: expired ? '#DC2626' : 'var(--text-3)' }}>
            {t(isHi, 'Expires:', 'समाप्ति:')}{' '}
            {formatDate(apiKey.expires_at)}
          </p>
        )}
        {apiKey.last_used_at && (
          <p className="text-xs" style={{ color: 'var(--text-3)' }}>
            {t(isHi, 'Last used:', 'अंतिम उपयोग:')}{' '}
            {formatDate(apiKey.last_used_at)}
          </p>
        )}
        {!apiKey.last_used_at && apiKey.is_active && (
          <p className="text-xs" style={{ color: 'var(--text-3)' }}>
            {t(isHi, 'Never used', 'कभी उपयोग नहीं किया')}
          </p>
        )}
      </div>

      {/* Revoke button */}
      {canRevoke && (
        <div className="mt-3">
          <button
            onClick={() => onRevoke(apiKey.id)}
            disabled={isRevoking}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all active:scale-95"
            style={{
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              color: '#DC2626',
              minHeight: '36px',
              opacity: isRevoking ? 0.6 : 1,
              cursor: isRevoking ? 'not-allowed' : 'pointer',
            }}
            aria-label={t(isHi, 'Revoke API key', 'API कुंजी रद्द करें')}
          >
            {isRevoking ? '...' : t(isHi, 'Revoke Key', 'कुंजी रद्द करें')}
          </button>
        </div>
      )}
    </Card>
  );
}

/* -----------------------------------------------------------------
   GENERATE KEY FORM (inside SheetModal)
----------------------------------------------------------------- */
interface GenerateFormProps {
  isHi: boolean;
  onSubmit: (values: {
    name: string;
    permissions: string[];
    expiryDays: number | null;
  }) => Promise<void>;
  submitting: boolean;
  newKey: string | null;
}

function GenerateForm({ isHi, onSubmit, submitting, newKey }: GenerateFormProps) {
  const [name, setName] = useState('');
  const [selectedPerms, setSelectedPerms] = useState<Set<string>>(new Set());
  const [expiryDays, setExpiryDays] = useState<string>('90');

  function togglePermission(perm: string) {
    setSelectedPerms((prev) => {
      const next = new Set(prev);
      if (next.has(perm)) {
        next.delete(perm);
      } else {
        next.add(perm);
      }
      return next;
    });
  }

  async function handleSubmit() {
    if (!name.trim() || selectedPerms.size === 0) return;
    await onSubmit({
      name: name.trim(),
      permissions: Array.from(selectedPerms),
      expiryDays: expiryDays ? parseInt(expiryDays, 10) : null,
    });
  }

  const canSubmit = name.trim().length > 0 && selectedPerms.size > 0 && !submitting;

  return (
    <div className="space-y-4 pb-2">
      {/* Show newly generated key */}
      {newKey && <NewKeyDisplay fullKey={newKey} isHi={isHi} />}

      {/* Name */}
      <Input
        label={t(isHi, 'Key Name', 'कुंजी का नाम')}
        placeholder={t(isHi, 'e.g., ERP Integration', 'जैसे, ERP इंटीग्रेशन')}
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={100}
      />

      {/* Permissions checkboxes */}
      <div>
        <p
          className="text-xs font-semibold mb-2"
          style={{ color: 'var(--text-2)' }}
        >
          {t(isHi, 'Permissions', 'अनुमतियां')}
        </p>
        <div className="space-y-2">
          {AVAILABLE_PERMISSIONS.map((perm) => {
            const checked = selectedPerms.has(perm.value);
            return (
              <button
                key={perm.value}
                type="button"
                onClick={() => togglePermission(perm.value)}
                className="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 transition-all active:scale-[0.98]"
                style={{
                  background: checked ? 'rgba(124, 58, 237, 0.08)' : 'var(--surface-2)',
                  border: checked ? '1.5px solid var(--purple)' : '1px solid var(--border)',
                  minHeight: '44px',
                }}
                role="checkbox"
                aria-checked={checked}
                aria-label={isHi ? perm.labelHi : perm.labelEn}
              >
                {/* Custom checkbox indicator */}
                <span
                  className="flex items-center justify-center rounded-md"
                  style={{
                    width: '20px',
                    height: '20px',
                    background: checked ? 'var(--purple)' : 'transparent',
                    border: checked ? 'none' : '2px solid var(--border)',
                    color: '#fff',
                    fontSize: '12px',
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  {checked ? '\u2713' : ''}
                </span>
                <span
                  className="text-sm font-medium"
                  style={{ color: checked ? 'var(--text-1)' : 'var(--text-2)' }}
                >
                  {isHi ? perm.labelHi : perm.labelEn}
                </span>
                <span
                  className="text-xs ml-auto"
                  style={{ color: 'var(--text-3)', fontFamily: 'monospace' }}
                >
                  {perm.value}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Expiry selector */}
      <div>
        <p
          className="text-xs font-semibold mb-2"
          style={{ color: 'var(--text-2)' }}
        >
          {t(isHi, 'Expiry', 'समाप्ति')}
        </p>
        <div className="flex flex-wrap gap-2">
          {EXPIRY_OPTIONS.map((opt) => {
            const selected = expiryDays === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setExpiryDays(opt.value)}
                className="px-3 py-2 rounded-xl text-xs font-semibold transition-all active:scale-95"
                style={{
                  background: selected ? 'var(--purple)' : 'var(--surface-2)',
                  border: selected ? 'none' : '1px solid var(--border)',
                  color: selected ? '#fff' : 'var(--text-2)',
                  minHeight: '36px',
                }}
              >
                {isHi ? opt.labelHi : opt.labelEn}
              </button>
            );
          })}
        </div>
      </div>

      {/* Submit */}
      <Button
        variant="primary"
        fullWidth
        size="lg"
        onClick={handleSubmit}
        disabled={!canSubmit}
      >
        {submitting
          ? t(isHi, 'Generating...', 'बना रहे हैं...')
          : t(isHi, 'Generate Key', 'कुंजी बनाएं')}
      </Button>
    </div>
  );
}

/* -----------------------------------------------------------------
   MAIN PAGE
----------------------------------------------------------------- */
export default function SchoolAdminApiKeysPage() {
  const router = useRouter();
  const { authUserId, isLoading: authLoading, isHi, setLanguage } = useAuth();

  /* State */
  const [schoolId, setSchoolId] = useState<string | null>(null);
  const [keys, setKeys] = useState<ApiKeyRecord[]>([]);
  const [loadingPage, setLoadingPage] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  /* Auth guard */
  useEffect(() => {
    if (!authLoading && !authUserId) {
      router.replace('/login');
    }
  }, [authLoading, authUserId, router]);

  /* Bootstrap: verify school admin + load keys */
  const bootstrap = useCallback(async () => {
    if (!authUserId) return;

    setLoadingPage(true);
    setPageError(null);

    try {
      // Verify this user is a school admin
      const { data: adminRecord, error: adminErr } = await supabase
        .from('school_admins')
        .select('school_id')
        .eq('auth_user_id', authUserId)
        .eq('is_active', true)
        .maybeSingle();

      if (adminErr) throw new Error(adminErr.message);

      if (!adminRecord) {
        router.replace('/login');
        return;
      }

      setSchoolId(adminRecord.school_id);

      // Fetch API keys via the API route (server-side permission check)
      const res = await fetch('/api/school-admin/api-keys', {
        headers: { 'Content-Type': 'application/json' },
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || `HTTP ${res.status}`);
      }

      const resBody = await res.json();
      setKeys((resBody.data?.keys ?? []) as ApiKeyRecord[]);
    } catch (err: unknown) {
      setPageError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoadingPage(false);
    }
  }, [authUserId, router]);

  useEffect(() => {
    if (!authLoading && authUserId) {
      bootstrap();
    }
  }, [authLoading, authUserId, bootstrap]);

  /* Generate key handler */
  async function handleGenerate(values: {
    name: string;
    permissions: string[];
    expiryDays: number | null;
  }) {
    setSubmitting(true);
    setNewKey(null);

    try {
      const payload: Record<string, unknown> = {
        name: values.name,
        permissions: values.permissions,
      };
      if (values.expiryDays) {
        payload.expires_in_days = values.expiryDays;
      }

      const res = await fetch('/api/school-admin/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const resBody = await res.json();

      if (!res.ok) {
        setPageError(resBody.error || `HTTP ${res.status}`);
        return;
      }

      // Show the full key ONCE
      setNewKey(resBody.data?.key ?? null);

      // Refresh the key list
      await bootstrap();
    } catch (err: unknown) {
      setPageError(err instanceof Error ? err.message : 'Failed to generate key');
    } finally {
      setSubmitting(false);
    }
  }

  /* Revoke key handler */
  async function handleRevoke(keyId: string) {
    const confirmed = window.confirm(
      isHi
        ? 'क्या आप इस API कुंजी को रद्द करना चाहते हैं? यह कार्रवाई पूर्ववत नहीं की जा सकती।'
        : 'Revoke this API key? This action cannot be undone.'
    );
    if (!confirmed) return;

    setRevokingId(keyId);

    try {
      const res = await fetch('/api/school-admin/api-keys', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: keyId }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        setPageError(errBody.error || `HTTP ${res.status}`);
        return;
      }

      // Optimistic update
      setKeys((prev) =>
        prev.map((k) => (k.id === keyId ? { ...k, is_active: false } : k))
      );
    } catch (err: unknown) {
      setPageError(err instanceof Error ? err.message : 'Failed to revoke key');
    } finally {
      setRevokingId(null);
    }
  }

  /* Loading state */
  if (authLoading || loadingPage) {
    return (
      <div
        className="min-h-dvh font-['Plus_Jakarta_Sans',system-ui,sans-serif]"
        style={{ background: 'var(--bg)' }}
      >
        <div
          className="sticky top-0 z-10 px-4 py-3 flex items-center gap-3"
          style={{
            background: 'rgba(251,248,244,0.92)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <Skeleton variant="rect" height={36} width={36} rounded="rounded-xl" />
          <Skeleton variant="title" height={22} width="45%" />
        </div>
        <div className="max-w-2xl mx-auto px-4 pt-4 pb-24 space-y-3">
          {[1, 2, 3].map((i) => (
            <KeyCardSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  /* Error state */
  if (pageError) {
    return (
      <div
        className="min-h-dvh flex items-center justify-center px-4 font-['Plus_Jakarta_Sans',system-ui,sans-serif]"
        style={{ background: 'var(--bg)' }}
      >
        <Card className="max-w-xs w-full text-center py-8">
          <div className="text-4xl mb-3">Warning</div>
          <p className="text-sm text-[var(--text-2)] mb-4">{pageError}</p>
          <Button
            variant="primary"
            onClick={() => {
              setPageError(null);
              bootstrap();
            }}
          >
            {t(isHi, 'Retry', 'दोबारा कोशिश करें')}
          </Button>
        </Card>
      </div>
    );
  }

  /* Active vs all keys */
  const activeKeys = keys.filter(
    (k) => k.is_active && !isExpired(k.expires_at)
  );
  const inactiveKeys = keys.filter(
    (k) => !k.is_active || isExpired(k.expires_at)
  );

  /* Main render */
  return (
    <div
      className="min-h-dvh font-['Plus_Jakarta_Sans',system-ui,sans-serif]"
      style={{ background: 'var(--bg)' }}
    >
      {/* ---- STICKY HEADER ---- */}
      <header
        className="sticky top-0 z-10 px-4 py-3 flex items-center gap-3"
        style={{
          background: 'rgba(251,248,244,0.92)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        {/* Back button */}
        <button
          onClick={() => router.push('/school-admin')}
          className="rounded-xl flex items-center justify-center transition-all active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--orange)] focus-visible:ring-offset-2"
          style={{
            width: '40px',
            height: '40px',
            minWidth: '40px',
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            fontSize: '18px',
          }}
          aria-label={t(isHi, 'Back to dashboard', 'डैशबोर्ड पर वापस जाएं')}
        >
          &larr;
        </button>

        {/* Title */}
        <div className="flex-1 min-w-0">
          <h1
            className="text-base font-bold text-[var(--text-1)] truncate"
            style={{ fontFamily: 'Sora, system-ui, sans-serif' }}
          >
            {t(isHi, 'API Keys', 'API कुंजियाँ')}
          </h1>
        </div>

        {/* Language toggle */}
        <button
          onClick={() => setLanguage && setLanguage(isHi ? 'en' : 'hi')}
          className="px-3 py-1.5 rounded-xl text-xs font-semibold transition-all active:scale-95"
          style={{
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            color: 'var(--text-2)',
            minHeight: '36px',
          }}
          aria-label={isHi ? 'Switch to English' : 'Switch to Hindi'}
        >
          {isHi ? 'EN' : '\u0939\u093F'}
        </button>

        {/* Generate new key CTA */}
        <button
          onClick={() => {
            setNewKey(null);
            setModalOpen(true);
          }}
          className="btn-primary rounded-xl px-3 py-2 text-xs font-semibold transition-all active:scale-95 flex items-center gap-1.5"
          style={{ minHeight: '40px' }}
          aria-label={t(isHi, 'Generate new API key', 'नई API कुंजी बनाएं')}
        >
          <span aria-hidden="true">+</span>
          {t(isHi, 'New Key', 'नई कुंजी')}
        </button>
      </header>

      {/* ---- PAGE BODY ---- */}
      <main className="max-w-2xl mx-auto px-4 pt-4 pb-24">

        {/* No keys at all */}
        {keys.length === 0 && (
          <EmptyState
            icon="@"
            title={t(isHi, 'No API keys yet', 'अभी कोई API कुंजी नहीं')}
            description={t(
              isHi,
              'Generate an API key to integrate with your ERP or SIS.',
              'अपने ERP या SIS के साथ एकीकरण के लिए API कुंजी बनाएं।'
            )}
            action={
              <Button
                variant="primary"
                onClick={() => {
                  setNewKey(null);
                  setModalOpen(true);
                }}
              >
                {t(isHi, '+ Generate Key', '+ कुंजी बनाएं')}
              </Button>
            }
          />
        )}

        {/* Active keys section */}
        {activeKeys.length > 0 && (
          <section aria-label={t(isHi, 'Active API keys', 'सक्रिय API कुंजियाँ')}>
            <p
              className="text-xs font-bold uppercase tracking-wider mb-3"
              style={{ color: 'var(--text-3)' }}
            >
              {t(isHi, 'Active', 'सक्रिय')} ({activeKeys.length})
            </p>
            <div className="space-y-3">
              {activeKeys.map((k) => (
                <KeyCard
                  key={k.id}
                  apiKey={k}
                  isHi={isHi}
                  onRevoke={handleRevoke}
                  revokingId={revokingId}
                />
              ))}
            </div>
          </section>
        )}

        {/* Inactive / expired keys section */}
        {inactiveKeys.length > 0 && (
          <section
            aria-label={t(isHi, 'Inactive API keys', 'निष्क्रिय API कुंजियाँ')}
            className={activeKeys.length > 0 ? 'mt-6' : ''}
          >
            <p
              className="text-xs font-bold uppercase tracking-wider mb-3"
              style={{ color: 'var(--text-3)' }}
            >
              {t(isHi, 'Inactive / Expired', 'निष्क्रिय / समाप्त')} ({inactiveKeys.length})
            </p>
            <div className="space-y-3">
              {inactiveKeys.map((k) => (
                <KeyCard
                  key={k.id}
                  apiKey={k}
                  isHi={isHi}
                  onRevoke={handleRevoke}
                  revokingId={revokingId}
                />
              ))}
            </div>
          </section>
        )}
      </main>

      {/* ---- GENERATE KEY SHEET MODAL ---- */}
      <SheetModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={t(isHi, 'Generate API Key', 'API कुंजी बनाएं')}
      >
        <GenerateForm
          isHi={isHi}
          onSubmit={handleGenerate}
          submitting={submitting}
          newKey={newKey}
        />
      </SheetModal>

      {/* ---- BOTTOM NAV ---- */}
      <BottomNav />
    </div>
  );
}
