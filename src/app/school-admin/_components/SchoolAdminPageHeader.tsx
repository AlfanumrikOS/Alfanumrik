'use client';

/**
 * SchoolAdminPageHeader — the standardised shell-integrated page header.
 *
 * Replaces the per-page mobile sticky headers (back button + title + language
 * toggle) that caused the double-header desktop layout issue (RCA-02).
 * Renders INSIDE the shell's <main> — shell provides all outer padding.
 *
 * Props:
 *   title / titleHi  — bilingual page title (P7)
 *   isHi             — from useAuth()
 *   action           — optional right-aligned CTA slot (e.g. "+ Invite" button)
 *   description / descriptionHi — optional one-liner under the title
 */

import { type ReactNode } from 'react';

export interface SchoolAdminPageHeaderProps {
  title: string;
  titleHi: string;
  isHi: boolean;
  action?: ReactNode;
  description?: string;
  descriptionHi?: string;
}

export default function SchoolAdminPageHeader({
  title,
  titleHi,
  isHi,
  action,
  description,
  descriptionHi,
}: SchoolAdminPageHeaderProps) {
  const label = isHi ? titleHi : title;
  const desc = isHi ? (descriptionHi ?? description) : description;

  return (
    <div className="flex items-start justify-between gap-4 mb-6">
      <div>
        <h1
          className="text-xl font-bold text-foreground"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {label}
        </h1>
        {desc && (
          <p className="text-sm text-muted-foreground mt-0.5">{desc}</p>
        )}
      </div>
      {action && (
        <div className="flex-shrink-0">{action}</div>
      )}
    </div>
  );
}
