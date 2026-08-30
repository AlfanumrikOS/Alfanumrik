'use client';

/**
 * ProfileScreen — screen 16 "Me" (`/me`, `ff_me_v2`).
 *
 * PRESENTATIONAL. Fetches nothing — every value is a prop, every write is a
 * callback. The page (apps/host/src/app/me/page.tsx) owns auth, the feature
 * flag gate, and all data hooks (AuthContext snapshot, useAllowedSubjects,
 * useOfflineState, and the same parent-link-code / export-data patterns
 * already used by apps/host/src/app/(student)/profile/page.tsx).
 *
 * House design system only: CSS custom properties (--orange, --surface-*,
 * --text-*, --border, --font-display/--font-body), matching
 * packages/ui/src/today/v2/TodayHomeV2.tsx and
 * packages/ui/src/exams/v2/ExamSchedule.tsx. No third token system.
 *
 * The streak lives HERE, small — deliberately not a prominent home-screen
 * element (SCREENS.md: "breaking a streak on your home screen makes
 * students quit"). Confirmed while building this that /today and /dashboard
 * both already show XP/streak in their own greeting strips — this screen
 * does not remove those (out of frontend's scope to touch /today's already-
 * shipped chrome for a Wave-B-adjacent screen), it simply also carries a
 * small streak readout here per the spec, which is additive, not a new
 * duplicate SOURCE OF TRUTH (same `students.streak_days` / snapshot field).
 *
 * Language switching is real: `onChangeLanguage` is expected to flip
 * AuthContext's `isHi` immediately (so this very screen re-renders in the
 * new language) in addition to persisting the preference.
 */

import { useState } from 'react';
import Link from 'next/link';
import { Skeleton, EmptyState, Button } from '@alfanumrik/ui/ui';
import { PlanBadge } from '@alfanumrik/ui/PlanBadge';
import type { Subject } from '@alfanumrik/lib/subjects.types';

export interface ProfileScreenStats {
  totalXp: number;
  streak: number;
  mastered: number;
  quizzesTaken: number;
}

export interface ProfileScreenStudent {
  name: string;
  grade: string;
  board: string | null;
  schoolName: string | null;
  city: string | null;
  state: string | null;
  subscriptionPlan: string | null;
  parentName: string | null;
  parentPhone: string | null;
  memberSince: string;
}

export interface ProfileScreenProps {
  isHi: boolean;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  student: ProfileScreenStudent | null;
  stats: ProfileScreenStats;
  selectedSubjects: Subject[];
  language: 'en' | 'hi' | string;
  languageSaving: boolean;
  onChangeLanguage: (lang: 'en' | 'hi') => void;
  parentLinkCode: string | null;
  parentLinkCodeLoading: boolean;
  downloadsCount: number;
  savedExplanationsCount: number;
  exporting: boolean;
  onExportData: () => void;
  onSignOut: () => void;
  editProfileHref: string;
  pricingHref: string;
  /**
   * ff_plan_v2 resolved ON — when true AND `onOpenPlan` is provided, the Plan
   * row opens the PlanModal (screen 15, `packages/ui/src/billing/v2/PlanModal`)
   * instead of navigating to `pricingHref`. Optional and defaults to the
   * existing Link-to-pricing behavior so every caller that doesn't pass it
   * (and every existing test) is unaffected.
   */
  planModalEnabled?: boolean;
  onOpenPlan?: () => void;
}

function SettingsRow({
  icon,
  label,
  value,
  onClick,
  href,
  testId,
}: {
  icon: string;
  label: string;
  value?: React.ReactNode;
  onClick?: () => void;
  href?: string;
  testId?: string;
}) {
  const inner = (
    <div
      className="flex items-center gap-3 w-full text-left"
      style={{ minHeight: 56, padding: '10px 4px' }}
    >
      <span
        className="flex items-center justify-center rounded-xl flex-shrink-0"
        style={{ width: 36, height: 36, background: 'var(--surface-2)', fontSize: 16 }}
        aria-hidden="true"
      >
        {icon}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold truncate" style={{ color: 'var(--text-1)' }}>
          {label}
        </p>
        {value !== undefined && (
          <div className="text-xs truncate" style={{ color: 'var(--text-3)' }}>
            {value}
          </div>
        )}
      </div>
      {(onClick || href) && (
        <span aria-hidden="true" style={{ color: 'var(--text-3)', fontSize: 18 }}>
          ›
        </span>
      )}
    </div>
  );

  if (href) {
    return (
      <Link href={href} data-testid={testId} style={{ display: 'block' }}>
        {inner}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        data-testid={testId}
        style={{ display: 'block', width: '100%', minHeight: 44 }}
      >
        {inner}
      </button>
    );
  }
  return <div data-testid={testId}>{inner}</div>;
}

export default function ProfileScreen({
  isHi,
  loading,
  error,
  onRetry,
  student,
  stats,
  selectedSubjects,
  language,
  languageSaving,
  onChangeLanguage,
  parentLinkCode,
  parentLinkCodeLoading,
  downloadsCount,
  savedExplanationsCount,
  exporting,
  onExportData,
  onSignOut,
  editProfileHref,
  pricingHref,
  planModalEnabled,
  onOpenPlan,
}: ProfileScreenProps) {
  const [copied, setCopied] = useState(false);
  const openPlanModal = planModalEnabled && onOpenPlan ? onOpenPlan : undefined;

  if (loading) {
    return (
      <main className="app-container py-6" data-testid="me-loading">
        <Skeleton height={28} width="30%" className="mb-4" />
        <Skeleton height={140} rounded="rounded-2xl" className="mb-4" />
        <Skeleton height={220} rounded="rounded-2xl" />
      </main>
    );
  }

  if (error) {
    return (
      <main className="app-container py-6" data-testid="me-error">
        <EmptyState
          icon="😕"
          title={isHi ? 'अभी लोड नहीं हो पाया' : "Couldn't load this right now"}
          description={isHi ? 'थोड़ी देर में फिर कोशिश करें।' : 'Please try again in a moment.'}
          action={
            <Button variant="soft" onClick={onRetry}>
              {isHi ? 'फिर कोशिश करें' : 'Retry'}
            </Button>
          }
        />
      </main>
    );
  }

  if (!student) {
    return (
      <main className="app-container py-6" data-testid="me-empty">
        <EmptyState
          icon="👤"
          title={isHi ? 'प्रोफ़ाइल नहीं मिली' : 'No profile found'}
        />
      </main>
    );
  }

  const copyCode = () => {
    if (!parentLinkCode) return;
    navigator.clipboard.writeText(parentLinkCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <main className="app-container py-6 pb-nav" data-testid="me-loaded">
      <h1
        className="text-2xl font-bold mb-4"
        style={{ fontFamily: 'var(--font-display)', color: 'var(--text-1)' }}
      >
        {isHi ? 'मैं' : 'Me'}
      </h1>

      {/* ── Identity header ── */}
      <section
        className="rounded-2xl p-5 mb-4"
        style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
        data-testid="me-identity"
      >
        <div className="flex items-center gap-3 mb-4">
          <div
            className="rounded-full flex items-center justify-center flex-shrink-0 font-black text-foreground"
            style={{ width: 56, height: 56, background: 'linear-gradient(135deg, var(--orange), #F5A623)', fontSize: 20 }}
            aria-hidden="true"
          >
            {student.name.trim().charAt(0).toUpperCase() || '?'}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-extrabold truncate" style={{ color: 'var(--text-1)', fontFamily: 'var(--font-display)' }}>
              {student.name}
            </h2>
            <p className="text-xs" style={{ color: 'var(--text-3)' }}>
              {isHi ? 'कक्षा' : 'Grade'} {student.grade} · {student.board ?? 'CBSE'}
              {student.memberSince ? ` · ${isHi ? 'सदस्य' : 'since'} ${student.memberSince}` : ''}
            </p>
          </div>
          {/* Streak — small, deliberately not prominent (SCREENS.md 16). */}
          <div
            className="flex items-center gap-1 rounded-xl px-2.5 py-1.5 flex-shrink-0"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
            data-testid="me-streak"
          >
            <span style={{ fontSize: 14 }} aria-hidden="true">🔥</span>
            <span className="text-xs font-bold" style={{ color: 'var(--text-2)' }}>
              {stats.streak}
            </span>
          </div>
        </div>

        {/* 3 stats */}
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-xl p-3 text-center" style={{ background: 'var(--surface-2)' }}>
            <p className="text-lg font-black" style={{ color: 'var(--orange)' }}>
              {stats.totalXp.toLocaleString('en-IN')}
            </p>
            <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
              XP
            </p>
          </div>
          <div className="rounded-xl p-3 text-center" style={{ background: 'var(--surface-2)' }}>
            <p className="text-lg font-black" style={{ color: 'var(--green)' }}>
              {stats.mastered}
            </p>
            <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
              {isHi ? 'महारत' : 'Mastered'}
            </p>
          </div>
          <div className="rounded-xl p-3 text-center" style={{ background: 'var(--surface-2)' }}>
            <p className="text-lg font-black" style={{ color: 'var(--purple, #7C3AED)' }}>
              {stats.quizzesTaken}
            </p>
            <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
              {isHi ? 'क्विज़' : 'Quizzes'}
            </p>
          </div>
        </div>
      </section>

      {/* ── Settings list ── */}
      <section
        className="rounded-2xl mb-4 divide-y"
        style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
        data-testid="me-settings-list"
      >
        <div className="px-4">
          <SettingsRow
            icon="🎒"
            label={isHi ? 'कक्षा और विषय' : 'Class & subjects'}
            value={
              selectedSubjects.length > 0
                ? `${isHi ? 'कक्षा' : 'Grade'} ${student.grade} · ${selectedSubjects.map((s) => (isHi ? s.nameHi : s.name)).join(', ')}`
                : `${isHi ? 'कक्षा' : 'Grade'} ${student.grade}`
            }
            href={editProfileHref}
            testId="me-row-class-subjects"
          />
        </div>

        {/* Language — real, inline, no exceptions. */}
        <div className="px-4 py-1" data-testid="me-row-language">
          <div className="flex items-center gap-3" style={{ minHeight: 56, padding: '10px 4px' }}>
            <span
              className="flex items-center justify-center rounded-xl flex-shrink-0"
              style={{ width: 36, height: 36, background: 'var(--surface-2)', fontSize: 16 }}
              aria-hidden="true"
            >
              🌐
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>
                {isHi ? 'भाषा' : 'Language'}
              </p>
            </div>
            <div
              className="inline-flex rounded-full p-0.5 flex-shrink-0"
              role="group"
              aria-label={isHi ? 'भाषा चुनें' : 'Choose language'}
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
            >
              <button
                type="button"
                onClick={() => onChangeLanguage('en')}
                disabled={languageSaving}
                aria-pressed={language === 'en'}
                className="text-xs font-bold rounded-full transition-all"
                style={{
                  minHeight: 36,
                  padding: '0 14px',
                  background: language === 'en' ? 'var(--orange)' : 'transparent',
                  color: language === 'en' ? '#fff' : 'var(--text-2)',
                }}
                data-testid="me-lang-en"
              >
                EN
              </button>
              <button
                type="button"
                onClick={() => onChangeLanguage('hi')}
                disabled={languageSaving}
                aria-pressed={language === 'hi'}
                className="text-xs font-bold rounded-full transition-all"
                style={{
                  minHeight: 36,
                  padding: '0 14px',
                  background: language === 'hi' ? 'var(--orange)' : 'transparent',
                  color: language === 'hi' ? '#fff' : 'var(--text-2)',
                }}
                data-testid="me-lang-hi"
              >
                हिंदी
              </button>
            </div>
          </div>
        </div>

        <div className="px-4">
          <SettingsRow
            icon="🏫"
            label={isHi ? 'स्कूल और शिक्षक' : 'School & teachers'}
            value={
              student.schoolName
                ? [student.schoolName, student.city].filter(Boolean).join(', ')
                : isHi
                  ? 'अभी नहीं जोड़ा गया'
                  : 'Not added yet'
            }
            href={editProfileHref}
            testId="me-row-school"
          />
        </div>

        <div className="px-4">
          {parentLinkCodeLoading ? (
            <div className="py-3">
              <Skeleton height={20} width="60%" />
            </div>
          ) : (
            <SettingsRow
              icon="👨‍👩‍👧"
              label={isHi ? 'अभिभावक' : 'Parent'}
              value={
                student.parentName
                  ? student.parentName
                  : parentLinkCode
                    ? (
                      <span className="flex items-center gap-2">
                        <code style={{ fontFamily: 'monospace', fontWeight: 700, letterSpacing: 1 }}>
                          {parentLinkCode}
                        </code>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            copyCode();
                          }}
                          className="text-[10px] font-bold px-2 py-0.5 rounded-md"
                          style={{ background: 'var(--surface-2)', color: 'var(--text-2)', border: '1px solid var(--border)' }}
                          data-testid="me-parent-copy"
                        >
                          {copied ? (isHi ? 'कॉपी हुआ' : 'Copied') : isHi ? 'कॉपी' : 'Copy'}
                        </button>
                      </span>
                    )
                    : isHi
                      ? 'कोड उपलब्ध नहीं'
                      : 'Code not available'
              }
              testId="me-row-parent"
            />
          )}
        </div>

        <div className="px-4">
          <SettingsRow
            icon="📥"
            label={isHi ? 'डाउनलोड' : 'Downloads'}
            value={
              downloadsCount > 0 || savedExplanationsCount > 0
                ? isHi
                  ? `${downloadsCount} अध्याय ऑफ़लाइन · ${savedExplanationsCount} सहेजे गए जवाब`
                  : `${downloadsCount} chapter${downloadsCount === 1 ? '' : 's'} offline · ${savedExplanationsCount} saved answer${savedExplanationsCount === 1 ? '' : 's'}`
                : isHi
                  ? 'कुछ भी ऑफ़लाइन सहेजा नहीं गया'
                  : 'Nothing kept offline yet'
            }
            testId="me-row-downloads"
          />
        </div>

        <div className="px-4">
          <SettingsRow
            icon="💳"
            label={isHi ? 'प्लान' : 'Plan'}
            value={<PlanBadge planCode={student.subscriptionPlan} size="sm" isHi={isHi} />}
            href={openPlanModal ? undefined : pricingHref}
            onClick={openPlanModal}
            testId="me-row-plan"
          />
        </div>
      </section>

      {/* ── Your data (DPDP) ── */}
      <section
        className="rounded-2xl p-4 mb-4"
        style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
        data-testid="me-your-data"
      >
        <p className="text-[11px] font-black uppercase tracking-wider mb-1" style={{ color: 'var(--text-3)', fontFamily: 'var(--font-display)' }}>
          {isHi ? 'आपका डेटा' : 'Your data'}
        </p>
        <p className="text-xs mb-3 leading-relaxed" style={{ color: 'var(--text-3)' }}>
          {isHi
            ? "आप कभी भी अपना डेटा डाउनलोड कर सकते हैं।"
            : "You can download your data at any time."}
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          <button
            type="button"
            onClick={onExportData}
            disabled={exporting}
            className="flex-1 rounded-xl text-sm font-bold"
            style={{ minHeight: 44, background: 'var(--surface-2)', color: 'var(--text-2)', border: '1px solid var(--border)' }}
            data-testid="me-export-data"
          >
            {exporting ? (isHi ? 'डाउनलोड हो रहा है...' : 'Downloading...') : isHi ? 'मेरा डेटा डाउनलोड करो' : 'Download my data'}
          </button>
        </div>
      </section>

      <button
        type="button"
        onClick={onSignOut}
        className="w-full rounded-xl text-sm font-bold"
        style={{ minHeight: 44, background: 'var(--surface-2)', color: 'var(--text-2)', border: '1px solid var(--border)' }}
        data-testid="me-sign-out"
      >
        {isHi ? 'लॉग आउट' : 'Sign out'}
      </button>
    </main>
  );
}
