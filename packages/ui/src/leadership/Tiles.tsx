'use client';

/**
 * Leadership dashboard tile primitives — small shared components for the K9
 * school-admin PARAKH-style leadership page. Read-only presentation of numbers
 * the server already aggregated (competency_summary, safeguarding_counts,
 * school_overview, coverage). No business logic. P7 bilingual.
 */

import Link from 'next/link';

const t = (isHi: boolean, en: string, hi: string) => (isHi ? hi : en);

export function LeadershipTile({
  label,
  labelHi,
  value,
  hint,
  hintHi,
  accent = 'var(--purple)',
  href,
}: {
  label: string;
  labelHi?: string;
  value: string | number;
  hint?: string;
  hintHi?: string;
  accent?: string;
  href?: string;
}) {
  const body = (
    <div
      className="rounded-2xl p-4 h-full"
      style={{
        background: 'var(--surface-1)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--shadow-md)',
        borderLeft: `4px solid ${accent}`,
      }}
      data-testid="leadership-tile"
    >
      <p
        className="text-[11px] uppercase tracking-wide font-semibold m-0"
        style={{ color: 'var(--text-3)' }}
      >
        {labelHi ? labelHi : label}
      </p>
      <p
        className="text-3xl font-extrabold mt-1 tabular-nums"
        style={{ color: 'var(--text-1)' }}
      >
        {value}
      </p>
      {(hint || hintHi) && (
        <p className="text-[12px] mt-1 m-0" style={{ color: 'var(--text-3)' }}>
          {hintHi ? hintHi : hint}
        </p>
      )}
    </div>
  );
  if (href) {
    return (
      <Link href={href} className="no-underline block">
        {body}
      </Link>
    );
  }
  return body;
}

export function LeadershipSection({
  title,
  titleHi,
  isHi,
  children,
}: {
  title: string;
  titleHi: string;
  isHi: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-6">
      <h2
        className="text-lg font-bold m-0 mb-2.5 font-heading"
        style={{ color: 'var(--text-1)' }}
      >
        {isHi ? titleHi : title}
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">{children}</div>
    </section>
  );
}
