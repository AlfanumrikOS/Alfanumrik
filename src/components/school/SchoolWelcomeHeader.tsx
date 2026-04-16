'use client';

import Image from 'next/image';
import type { SchoolBranding } from '@/lib/types';

/**
 * SchoolWelcomeHeader -- School-branded welcome header for B2B students.
 *
 * B2B mode: Shows school logo + "Welcome to {schoolName}, {studentName}!" + tagline.
 * B2C mode: Shows default "Welcome back, {studentName}!" (no school branding).
 *
 * Props-driven component -- does not fetch data itself. The parent page should
 * use `useTenant()` from `@/lib/tenant-context` to resolve school context.
 *
 * P7: All labels are bilingual (isHi).
 * P13: No PII in console logs.
 */

/* ─── Props ─── */

interface SchoolWelcomeHeaderProps {
  isHi: boolean;
  studentName: string;
  /** If true, render the B2B school-branded version */
  isB2B: boolean;
  /** School display name (e.g., "Delhi Public School") */
  schoolName?: string | null;
  /** School branding from useTenant() */
  branding?: SchoolBranding | null;
}

/* ─── Component ─── */

export default function SchoolWelcomeHeader({
  isHi,
  studentName,
  isB2B,
  schoolName,
  branding,
}: SchoolWelcomeHeaderProps) {
  const firstName = studentName?.split(' ')[0] || '';
  const greeting = getGreeting(isHi);
  const primaryColor = branding?.primaryColor || '#7C3AED';

  // B2C fallback: simple greeting
  if (!isB2B || !schoolName) {
    return (
      <div className="w-full">
        <h1
          className="text-lg font-bold"
          style={{ fontFamily: 'var(--font-display)', color: 'var(--text-1)' }}
        >
          {greeting}, {firstName}!
        </h1>
        <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
          {isHi ? 'आज कुछ नया सीखते हैं!' : 'Ready to learn something new today!'}
        </p>
      </div>
    );
  }

  // B2B: school-branded header
  return (
    <div className="w-full">
      <div className="flex items-center gap-3">
        {/* School logo */}
        {branding?.logoUrl ? (
          <div
            className="w-10 h-10 rounded-xl overflow-hidden flex-shrink-0"
            style={{
              border: `1.5px solid ${primaryColor}20`,
              background: 'var(--surface-1)',
            }}
          >
            <Image
              src={branding.logoUrl}
              alt={schoolName}
              width={40}
              height={40}
              className="w-full h-full object-contain"
            />
          </div>
        ) : (
          // Fallback: school initial in a colored circle
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-sm font-bold"
            style={{
              background: `${primaryColor}12`,
              color: primaryColor,
              border: `1.5px solid ${primaryColor}20`,
            }}
          >
            {schoolName.charAt(0).toUpperCase()}
          </div>
        )}

        {/* Text */}
        <div className="min-w-0 flex-1">
          <h1
            className="text-lg font-bold leading-snug"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--text-1)' }}
          >
            {greeting}, {firstName}!
          </h1>
          <p
            className="text-xs mt-0.5 truncate"
            style={{ color: primaryColor }}
          >
            {isHi
              ? `${schoolName} में आपका स्वागत है`
              : `Welcome to ${schoolName}`}
          </p>
        </div>
      </div>

      {/* School tagline */}
      {branding?.tagline && (
        <p
          className="text-[11px] mt-2 italic"
          style={{ color: 'var(--text-4)' }}
        >
          &ldquo;{branding.tagline}&rdquo;
        </p>
      )}

      {/* Powered by Alfanumrik */}
      {branding?.showPoweredBy && (
        <div className="mt-1.5">
          <span
            className="text-[9px] uppercase tracking-widest"
            style={{ color: 'var(--text-4)' }}
          >
            {isHi ? 'Alfanumrik द्वारा संचालित' : 'Powered by Alfanumrik'}
          </span>
        </div>
      )}
    </div>
  );
}

/* ─── Helpers ─── */

function getGreeting(isHi: boolean): string {
  const hour = new Date().getHours();
  if (hour < 12) return isHi ? 'सुप्रभात' : 'Good morning';
  if (hour < 17) return isHi ? 'नमस्ते' : 'Good afternoon';
  return isHi ? 'शुभ संध्या' : 'Good evening';
}
