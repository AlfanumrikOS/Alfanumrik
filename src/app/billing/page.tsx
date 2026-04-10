'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';
import Link from 'next/link';
import { BottomNav } from '@/components/ui';

interface SubStatus {
  plan_code: string;
  plan_name: string;
  status: string;
  billing_cycle: string | null;
  auto_renew: boolean;
  is_recurring: boolean;
  price_inr: number;
  current_period_start: string | null;
  current_period_end: string | null;
  next_billing_at: string | null;
  is_in_grace: boolean;
  grace_period_end: string | null;
  is_cancel_scheduled: boolean;
  cancelled_at: string | null;
  renewal_attempts: number;
}

export default function BillingPage() {
  const { isLoggedIn, student, isLoading: authLoading, isHi } = useAuth();
  const [sub, setSub] = useState<SubStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    setError(null);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setLoading(false); return; }

    try {
      const res = await fetch('/api/payments/status', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.ok) {
        setSub(await res.json());
      } else {
        setError(isHi ? 'बिलिंग जानकारी लोड नहीं हो सकी' : 'Could not load billing info');
      }
    } catch {
      setError(isHi ? 'नेटवर्क त्रुटि। कृपया फिर से कोशिश करें।' : 'Network error. Please try again.');
    }
    setLoading(false);
  }, [isHi]);

  useEffect(() => {
    if (isLoggedIn) fetchStatus();
  }, [isLoggedIn, fetchStatus]);

  const handleCancel = async () => {
    setCancelLoading(true);
    setMessage(null);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    try {
      const res = await fetch('/api/payments/cancel', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ immediate: false, reason: 'User cancelled from billing page' }),
      });

      const data = await res.json();
      if (res.ok) {
        setMessage(data.message);
        setCancelConfirm(false);
        await fetchStatus();
      } else {
        setMessage(data.error || (isHi ? 'रद्द करने में विफल' : 'Cancellation failed'));
      }
    } catch {
      setMessage(isHi ? 'नेटवर्क त्रुटि' : 'Network error');
    }
    setCancelLoading(false);
  };

  // Auth loading state
  if (authLoading) {
    return (
      <div style={page}>
        <div style={card}>
          <div className="animate-pulse space-y-3">
            <div className="h-4 rounded" style={{ background: 'var(--surface-2)', width: '60%' }} />
            <div className="h-8 rounded" style={{ background: 'var(--surface-2)', width: '40%' }} />
            <div className="h-3 rounded" style={{ background: 'var(--surface-2)', width: '80%' }} />
          </div>
        </div>
      </div>
    );
  }

  // Not logged in
  if (!isLoggedIn) {
    return (
      <div style={page}>
        <div style={card}>
          <p style={{ color: '#888' }}>
            {isHi ? 'बिलिंग देखने के लिए लॉग इन करें।' : 'Please log in to view billing.'}
          </p>
          <Link href="/login" style={linkBtn}>
            {isHi ? 'लॉग इन करें' : 'Log In'}
          </Link>
        </div>
      </div>
    );
  }

  // Data loading
  if (loading) {
    return (
      <div style={page}>
        <div style={{ maxWidth: 600, width: '100%' }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 24 }}>
            {isHi ? 'बिलिंग और सब्सक्रिप्शन' : 'Billing & Subscription'}
          </h1>
          <div style={card}>
            <div className="animate-pulse space-y-4">
              <div className="flex justify-between">
                <div>
                  <div className="h-3 rounded mb-2" style={{ background: 'var(--surface-2)', width: 80 }} />
                  <div className="h-6 rounded" style={{ background: 'var(--surface-2)', width: 120 }} />
                </div>
                <div className="h-6 rounded-lg" style={{ background: 'var(--surface-2)', width: 60 }} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                {[1, 2, 3, 4].map(i => (
                  <div key={i}>
                    <div className="h-3 rounded mb-1" style={{ background: 'var(--surface-2)', width: '50%' }} />
                    <div className="h-4 rounded" style={{ background: 'var(--surface-2)', width: '70%' }} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        <BottomNav />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div style={page}>
        <div style={{ maxWidth: 600, width: '100%' }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 24 }}>
            {isHi ? 'बिलिंग और सब्सक्रिप्शन' : 'Billing & Subscription'}
          </h1>
          <div style={{ ...card, textAlign: 'center' as const }}>
            <p style={{ fontSize: 14, color: '#DC2626', marginBottom: 16 }}>{error}</p>
            <button onClick={fetchStatus} style={primaryBtn}>
              {isHi ? 'फिर से कोशिश करो' : 'Try Again'}
            </button>
          </div>
        </div>
        <BottomNav />
      </div>
    );
  }

  const isFree = !sub || sub.plan_code === 'free';
  const isActive = sub?.status === 'active';
  const isPastDue = sub?.status === 'past_due';
  const isCancelled = sub?.status === 'cancelled' || sub?.is_cancel_scheduled;

  return (
    <div style={page}>
      <div style={{ maxWidth: 600, width: '100%' }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 24 }}>
          {isHi ? 'बिलिंग और सब्सक्रिप्शन' : 'Billing & Subscription'}
        </h1>

        {message && (
          <div style={{ ...card, background: '#f0fdf4', border: '1px solid #16a34a40', marginBottom: 16 }}>
            <p style={{ fontSize: 14, color: '#16a34a' }}>{message}</p>
          </div>
        )}

        {/* Current Plan Card */}
        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
            <div>
              <p style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>
                {isHi ? 'वर्तमान योजना' : 'Current Plan'}
              </p>
              <h2 style={{ fontSize: 24, fontWeight: 700 }}>{sub?.plan_name || 'Explorer'}</h2>
            </div>
            <span style={{
              fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 8,
              background: isActive ? '#16a34a15' : isPastDue ? '#f59e0b15' : '#ef444415',
              color: isActive ? '#16a34a' : isPastDue ? '#f59e0b' : '#ef4444',
            }}>
              {isActive
                ? (isHi ? 'सक्रिय' : 'Active')
                : isPastDue
                  ? (isHi ? 'भुगतान लंबित' : 'Past Due')
                  : isCancelled
                    ? (isHi ? 'रद्द' : 'Cancelled')
                    : sub?.status || (isHi ? 'मुफ्त' : 'Free')}
            </span>
          </div>

          {!isFree && (
            <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <InfoRow
                label={isHi ? 'कीमत' : 'Price'}
                value={`₹${sub!.price_inr}/${sub!.billing_cycle === 'yearly' ? (isHi ? 'वर्ष' : 'year') : (isHi ? 'महीना' : 'month')}`}
              />
              <InfoRow
                label={isHi ? 'बिलिंग' : 'Billing'}
                value={sub!.is_recurring ? (isHi ? 'ऑटो-रिन्यू' : 'Auto-renew') : (isHi ? 'एक बार' : 'One-time')}
              />
              {sub!.current_period_end && (
                <InfoRow
                  label={isCancelled ? (isHi ? 'एक्सेस तक' : 'Access Until') : (isHi ? 'रिन्यू होगा' : 'Renews On')}
                  value={formatDate(sub!.current_period_end)}
                />
              )}
              {sub!.is_recurring && sub!.next_billing_at && !isCancelled && (
                <InfoRow
                  label={isHi ? 'अगला चार्ज' : 'Next Charge'}
                  value={formatDate(sub!.next_billing_at)}
                />
              )}
            </div>
          )}

          {/* Empty state for free plan */}
          {isFree && (
            <div style={{ marginTop: 16, padding: 16, borderRadius: 12, background: 'rgba(232,88,28,0.04)', border: '1px dashed rgba(232,88,28,0.2)' }}>
              <p style={{ fontSize: 13, color: '#888', lineHeight: 1.6 }}>
                {isHi
                  ? 'आप Explorer (मुफ्त) योजना पर हैं। Foxy AI ट्यूटर, अनलिमिटेड क्विज़ और अधिक सुविधाओं के लिए अपग्रेड करें।'
                  : 'You\'re on the Explorer (free) plan. Upgrade for unlimited Foxy AI tutoring, quizzes, and more features.'}
              </p>
            </div>
          )}

          {/* Grace Period Warning */}
          {isPastDue && sub?.is_in_grace && (
            <div style={{ marginTop: 16, padding: 12, borderRadius: 10, background: '#f59e0b10', border: '1px solid #f59e0b30' }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: '#f59e0b' }}>
                {isHi ? 'भुगतान लंबित' : 'Payment Pending'}
              </p>
              <p style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
                {isHi
                  ? `आपका रिन्यूअल भुगतान रीट्राई किया जा रहा है। ${sub.grace_period_end ? formatDate(sub.grace_period_end) : 'कुछ समय'} तक एक्सेस बनी रहेगी।`
                  : `Your renewal payment is being retried. You still have access until ${sub.grace_period_end ? formatDate(sub.grace_period_end) : 'shortly'}. If payment fails, your plan will be downgraded.`}
              </p>
            </div>
          )}

          {/* Cancel Scheduled */}
          {sub?.is_cancel_scheduled && sub.status !== 'cancelled' && (
            <div style={{ marginTop: 16, padding: 12, borderRadius: 10, background: '#ef444410', border: '1px solid #ef444430' }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: '#ef4444' }}>
                {isHi ? 'रद्दीकरण निर्धारित' : 'Cancellation Scheduled'}
              </p>
              <p style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
                {isHi
                  ? `ऑटो-रिन्यू बंद है। ${sub.current_period_end ? formatDate(sub.current_period_end) : 'बिलिंग अवधि'} तक एक्सेस बनी रहेगी।`
                  : `Auto-renew is off. You'll keep access until ${sub.current_period_end ? formatDate(sub.current_period_end) : 'the end of your billing period'}.`}
              </p>
            </div>
          )}
        </div>

        {/* Actions */}
        <div style={{ ...card, marginTop: 16 }}>
          {isFree ? (
            <>
              <p style={{ fontSize: 14, color: '#888', marginBottom: 12 }}>
                {isHi
                  ? 'अधिक Foxy चैट, क्विज़ और सुविधाओं को अनलॉक करने के लिए अपग्रेड करें।'
                  : 'Upgrade to unlock more Foxy chats, quizzes, and features.'}
              </p>
              <Link href="/pricing" style={primaryBtn}>
                {isHi ? 'प्लान देखें' : 'View Plans'}
              </Link>
            </>
          ) : (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <Link href="/pricing" style={primaryBtn}>
                {isHi ? 'प्लान बदलें' : 'Change Plan'}
              </Link>

              {!isCancelled && sub?.is_recurring && (
                cancelConfirm ? (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <button onClick={handleCancel} disabled={cancelLoading} style={dangerBtn}>
                      {cancelLoading
                        ? (isHi ? 'रद्द हो रहा...' : 'Cancelling...')
                        : (isHi ? 'हाँ, रद्द करो' : 'Yes, Cancel')}
                    </button>
                    <button onClick={() => setCancelConfirm(false)} style={ghostBtn}>
                      {isHi ? 'प्लान रखो' : 'Keep Plan'}
                    </button>
                  </div>
                ) : (
                  <button onClick={() => setCancelConfirm(true)} style={ghostBtn}>
                    {isHi ? 'ऑटो-रिन्यू बंद करो' : 'Cancel Auto-Renew'}
                  </button>
                )
              )}
            </div>
          )}
        </div>

        {/* Payment Help */}
        {!isFree && (
          <p style={{ fontSize: 12, color: '#888', marginTop: 16, textAlign: 'center' }}>
            {isHi ? 'भुगतान समस्या? संपर्क करें ' : 'Payment issues? Contact '}
            <a href="mailto:alfanumrik10@gmail.com" style={{ color: '#E8581C' }}>alfanumrik10@gmail.com</a>
          </p>
        )}
      </div>
      <BottomNav />
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p style={{ fontSize: 11, color: '#888' }}>{label}</p>
      <p style={{ fontSize: 14, fontWeight: 600 }}>{value}</p>
    </div>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

const page: React.CSSProperties = {
  minHeight: '100vh', padding: '24px 16px', paddingBottom: 100,
  display: 'flex', flexDirection: 'column', alignItems: 'center',
  background: 'var(--bg, #FBF8F4)', color: 'var(--text-1, #1a1a1a)',
};

const card: React.CSSProperties = {
  background: 'var(--surface-1, #fff)', border: '1px solid var(--border, #e5e0d8)',
  borderRadius: 16, padding: 20,
};

const primaryBtn: React.CSSProperties = {
  display: 'inline-block', padding: '10px 20px', borderRadius: 10,
  fontSize: 13, fontWeight: 700, textDecoration: 'none',
  background: 'var(--orange, #E8581C)', color: '#fff',
};

const ghostBtn: React.CSSProperties = {
  padding: '10px 20px', borderRadius: 10, border: '1px solid var(--border, #e5e0d8)',
  fontSize: 13, fontWeight: 600, background: 'transparent', cursor: 'pointer',
  color: 'var(--text-2, #444)',
};

const dangerBtn: React.CSSProperties = {
  padding: '10px 20px', borderRadius: 10, border: 'none',
  fontSize: 13, fontWeight: 700, background: '#ef4444', color: '#fff', cursor: 'pointer',
};

const linkBtn: React.CSSProperties = {
  display: 'inline-block', marginTop: 12, padding: '10px 20px', borderRadius: 10,
  fontSize: 13, fontWeight: 700, textDecoration: 'none',
  background: 'var(--orange, #E8581C)', color: '#fff',
};
