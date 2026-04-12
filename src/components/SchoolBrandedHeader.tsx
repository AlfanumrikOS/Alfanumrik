'use client';

/**
 * SchoolBrandedHeader — Renders school-branded header when in school context.
 *
 * When `useSchool().isSchoolContext` is true, shows:
 * - School logo (or initial avatar fallback)
 * - School name
 * - School tagline
 * - Uses CSS custom properties for school colors
 *
 * When NOT in school context, renders nothing (existing headers remain untouched).
 * This is designed to be placed ABOVE existing page headers as a complementary banner.
 */

import Image from 'next/image';
import { useSchool } from '@/lib/SchoolContext';

function t(isHi: boolean, en: string, hi: string): string {
  return isHi ? hi : en;
}

interface SchoolBrandedHeaderProps {
  isHi?: boolean;
}

export default function SchoolBrandedHeader({ isHi = false }: SchoolBrandedHeaderProps) {
  const school = useSchool();

  if (!school.isSchoolContext) {
    return null;
  }

  const initials = school.name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <div
      className="w-full px-4 py-3 flex items-center gap-3"
      style={{
        backgroundColor: 'var(--school-primary, #7C3AED)',
        color: '#fff',
      }}
      role="banner"
      aria-label={t(isHi, `${school.name} school banner`, `${school.name} स्कूल बैनर`)}
    >
      {/* School logo or initials fallback */}
      {school.logoUrl ? (
        <div className="relative flex-shrink-0 rounded-lg overflow-hidden" style={{ width: 40, height: 40 }}>
          <Image
            src={school.logoUrl}
            alt={`${school.name} logo`}
            width={40}
            height={40}
            className="object-contain"
            style={{ background: 'rgba(255,255,255,0.15)' }}
          />
        </div>
      ) : (
        <div
          className="flex-shrink-0 rounded-lg flex items-center justify-center font-bold text-sm"
          style={{
            width: 40,
            height: 40,
            background: 'rgba(255,255,255,0.2)',
            color: '#fff',
          }}
          aria-hidden="true"
        >
          {initials}
        </div>
      )}

      {/* School name and tagline */}
      <div className="flex-1 min-w-0">
        <h2
          className="text-sm font-bold truncate"
          style={{ fontFamily: 'Sora, system-ui, sans-serif', color: '#fff' }}
        >
          {school.name}
        </h2>
        {school.tagline && (
          <p
            className="text-xs truncate mt-0.5"
            style={{ color: 'rgba(255,255,255,0.8)' }}
          >
            {school.tagline}
          </p>
        )}
      </div>

      {/* Powered by badge */}
      <div
        className="flex-shrink-0 text-xs font-medium px-2 py-1 rounded-md"
        style={{
          background: 'rgba(255,255,255,0.15)',
          color: 'rgba(255,255,255,0.9)',
        }}
      >
        {t(isHi, 'Powered by Alfanumrik', 'Alfanumrik द्वारा संचालित')}
      </div>
    </div>
  );
}