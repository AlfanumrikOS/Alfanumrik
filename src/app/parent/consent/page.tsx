'use client';

/**
 * Parent consent capture screen (Phase D.1, DPDP).
 *
 * Mounted at /parent/consent. The ParentShell gate redirects unconsented
 * guardians here on entry to any other /parent/* route. After all linked
 * children have an active consent at CURRENT_CONSENT_VERSION, the gate
 * stops redirecting and the parent regains free movement.
 *
 * Bilingual (English + Hindi) — picks locale from AuthContext.isHi.
 * Each linked child gets its own consent card; submit walks them
 * sequentially and posts each to /api/parent/consent before redirecting
 * to /parent.
 */

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';

const t = (isHi: boolean, en: string, hi: string) => (isHi ? hi : en);

interface ChildToConsent {
  studentId: string;
  name: string | null;
  grade: string | null;
}

interface ScopeSelection {
  curriculum_access: boolean;
  performance_data_sharing_with_teacher: boolean;
  marketing_emails: boolean;
}

const DEFAULT_SCOPES: ScopeSelection = {
  curriculum_access: true,
  performance_data_sharing_with_teacher: true,
  marketing_emails: false,
};

interface ScopeMeta {
  key: keyof ScopeSelection;
  en: { label: string; desc: string };
  hi: { label: string; desc: string };
  required: boolean;
}

const SCOPE_META: ScopeMeta[] = [
  {
    key: 'curriculum_access',
    required: true,
    en: {
      label: 'Curriculum access',
      desc: 'Allow Alfanumrik to provide lessons, quizzes, and progress tracking for my child.',
    },
    hi: {
      label: 'पाठ्यक्रम पहुँच',
      desc: 'Alfanumrik को मेरे बच्चे के लिए पाठ, क्विज़, और प्रगति ट्रैकिंग देने की अनुमति दें।',
    },
  },
  {
    key: 'performance_data_sharing_with_teacher',
    required: false,
    en: {
      label: 'Share performance with teacher',
      desc: 'Allow my child\'s teacher to see their quiz scores and progress reports.',
    },
    hi: {
      label: 'शिक्षक के साथ प्रदर्शन साझा करें',
      desc: 'मेरे बच्चे के शिक्षक को क्विज़ स्कोर और प्रगति रिपोर्ट देखने की अनुमति दें।',
    },
  },
  {
    key: 'marketing_emails',
    required: false,
    en: {
      label: 'Product updates by email',
      desc: 'Send me occasional updates about new Alfanumrik features and offers. (Optional.)',
    },
    hi: {
      label: 'ईमेल द्वारा उत्पाद अपडेट',
      desc: 'मुझे Alfanumrik की नई सुविधाओं और ऑफ़र की कभी-कभी अपडेट भेजें। (वैकल्पिक।)',
    },
  },
];

interface ChildSummaryResponse {
  studentId: string;
  name: string | null;
  grade: string | null;
  needsConsent: boolean;
}

export default function ParentConsentPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isHi, authUserId, isLoading } = useAuth();
  const returnTo = searchParams?.get('returnTo') ?? '/parent';

  const [children, setChildren] = useState<ChildToConsent[]>([]);
  const [scopesByChild, setScopesByChild] = useState<Record<string, ScopeSelection>>({});
  const [attested, setAttested] = useState(false);
  const [loadingChildren, setLoadingChildren] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Resolve children needing consent. We hit a small bespoke endpoint
  // (`/api/parent/consent/pending`) — implemented inline below as part
  // of the route file would be over-coupled; for Phase D.1 we fetch the
  // full /api/parent/billing for its `children[]` and the active list
  // from /api/parent/consent, then derive the diff client-side.
  const loadChildren = useCallback(async () => {
    setLoadingChildren(true);
    setErrorMsg(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        router.replace('/parent');
        return;
      }
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      };

      const [billingRes, activeRes] = await Promise.all([
        fetch('/api/parent/billing', { headers }),
        fetch('/api/parent/consent', { headers }),
      ]);

      if (!billingRes.ok) throw new Error(`billing_fetch_${billingRes.status}`);
      if (!activeRes.ok) throw new Error(`consent_fetch_${activeRes.status}`);

      const billing = await billingRes.json();
      const active = await activeRes.json();

      type BillingChild = { student_id: string; student_name: string | null; grade: string | null };
      const linkedChildren = ((billing?.data?.children ?? []) as BillingChild[]).map((c) => ({
        studentId: c.student_id,
        name: c.student_name,
        grade: c.grade,
      }));

      type ActiveRow = { studentId: string; consentVersion: string };
      const activeRows = (active?.items ?? []) as ActiveRow[];
      const currentVersion = active?.currentVersion as string | undefined;
      const consentedSet = new Set(
        activeRows
          .filter((r) => !currentVersion || r.consentVersion === currentVersion)
          .map((r) => r.studentId),
      );

      const needsConsent = linkedChildren.filter((c) => !consentedSet.has(c.studentId));
      setChildren(needsConsent);
      const initial: Record<string, ScopeSelection> = {};
      for (const c of needsConsent) initial[c.studentId] = { ...DEFAULT_SCOPES };
      setScopesByChild(initial);

      // Nothing to consent — bounce back.
      if (needsConsent.length === 0) {
        router.replace(returnTo);
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoadingChildren(false);
    }
  }, [router, returnTo]);

  useEffect(() => {
    if (isLoading) return;
    if (!authUserId) {
      router.replace('/parent');
      return;
    }
    void loadChildren();
  }, [authUserId, isLoading, loadChildren, router]);

  const toggleScope = (studentId: string, key: keyof ScopeSelection) => {
    setScopesByChild((prev) => ({
      ...prev,
      [studentId]: { ...prev[studentId], [key]: !prev[studentId]?.[key] },
    }));
  };

  const handleSubmit = async () => {
    if (!attested) {
      setErrorMsg(t(isHi, 'You must confirm you are the parent or legal guardian.', 'आपको पुष्टि करनी होगी कि आप अभिभावक हैं।'));
      return;
    }
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error('no session');

      // Sequential submit so a failure halts and the user can retry.
      for (const child of children) {
        const scopes = scopesByChild[child.studentId] ?? DEFAULT_SCOPES;
        const res = await fetch('/api/parent/consent', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            studentId: child.studentId,
            scopes,
            locale: isHi ? 'hi' : 'en',
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `submit_${res.status}`);
        }
      }
      router.replace(returnTo);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Submit failed');
    } finally {
      setSubmitting(false);
    }
  };

  if (loadingChildren) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-10 text-center text-sm text-gray-500">
        {t(isHi, 'Loading…', 'लोड हो रहा है…')}
      </div>
    );
  }

  if (children.length === 0) {
    return null; // Effect redirected.
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">
          {t(isHi, 'Parental consent (DPDP)', 'अभिभावक की सहमति (DPDP)')}
        </h1>
        <p className="mt-2 text-sm text-gray-600">
          {t(
            isHi,
            'India\'s Digital Personal Data Protection Act requires explicit consent from a parent or legal guardian before Alfanumrik can process a child\'s data. Please review and confirm below.',
            'भारत के डिजिटल पर्सनल डेटा प्रोटेक्शन एक्ट के तहत, बच्चे के डेटा को संसाधित करने से पहले अभिभावक की स्पष्ट सहमति आवश्यक है। कृपया नीचे देखें और पुष्टि करें।',
          )}
        </p>
      </header>

      {errorMsg && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {errorMsg}
        </div>
      )}

      <div className="space-y-6">
        {children.map((child) => {
          const scopes = scopesByChild[child.studentId] ?? DEFAULT_SCOPES;
          return (
            <section
              key={child.studentId}
              className="rounded-xl border border-orange-200 bg-white p-5"
            >
              <h2 className="text-lg font-semibold text-gray-900">
                {child.name || t(isHi, 'Child', 'बच्चा')}
                {child.grade && (
                  <span className="ml-2 text-sm font-normal text-gray-500">
                    {t(isHi, `Grade ${child.grade}`, `कक्षा ${child.grade}`)}
                  </span>
                )}
              </h2>
              <ul className="mt-4 space-y-3">
                {SCOPE_META.map((meta) => {
                  const m = isHi ? meta.hi : meta.en;
                  const checked = !!scopes[meta.key];
                  return (
                    <li key={meta.key} className="flex items-start gap-3">
                      <input
                        id={`scope-${child.studentId}-${meta.key}`}
                        type="checkbox"
                        checked={checked}
                        disabled={meta.required}
                        onChange={() => toggleScope(child.studentId, meta.key)}
                        className="mt-1 h-4 w-4 rounded border-gray-300"
                      />
                      <label
                        htmlFor={`scope-${child.studentId}-${meta.key}`}
                        className="flex-1 text-sm"
                      >
                        <span className="font-medium text-gray-900">
                          {m.label}
                          {meta.required && (
                            <span className="ml-1 text-xs text-orange-600">
                              {t(isHi, '(required)', '(आवश्यक)')}
                            </span>
                          )}
                        </span>
                        <p className="mt-0.5 text-xs text-gray-600">{m.desc}</p>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>

      <label className="mt-6 flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          checked={attested}
          onChange={() => setAttested((v) => !v)}
          className="mt-1 h-4 w-4 rounded border-gray-300"
        />
        <span className="text-gray-900">
          {t(
            isHi,
            'I confirm I am the parent or legal guardian of the child(ren) above, and I have read and agree to this consent.',
            'मैं पुष्टि करता/करती हूँ कि मैं उपरोक्त बच्चे/बच्चों का अभिभावक हूँ, और मैंने यह सहमति पढ़ी है और सहमत हूँ।',
          )}
        </span>
      </label>

      <div className="mt-6 flex justify-end gap-3">
        <button
          onClick={handleSubmit}
          disabled={submitting || !attested}
          className="rounded-lg bg-orange-500 px-5 py-2 text-sm font-semibold text-white hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting
            ? t(isHi, 'Submitting…', 'जमा कर रहे हैं…')
            : t(isHi, 'Confirm consent', 'सहमति पुष्टि करें')}
        </button>
      </div>
    </div>
  );
}
