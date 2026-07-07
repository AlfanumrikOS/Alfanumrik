'use client';

/**
 * PostHog Analytics Provider
 *
 * Initialises PostHog once per session (client-side only).
 * EU cloud: eu.i.posthog.com (project 159341)
 *
 * Usage: wrap the app in <PostHogProvider> inside the root layout.
 * Identification: call posthogIdentify() after login with student_id + grade.
 */

import posthog from 'posthog-js';
import { PostHogProvider as PHProvider } from 'posthog-js/react';
import { useEffect } from 'react';

const PH_KEY    = process.env.NEXT_PUBLIC_POSTHOG_KEY   ?? '';
const PH_HOST   = process.env.NEXT_PUBLIC_POSTHOG_HOST  ?? 'https://eu.i.posthog.com';

let initialised = false;

function PostHogInit() {
  useEffect(() => {
    if (initialised || !PH_KEY || typeof window === 'undefined') return;
    posthog.init(PH_KEY, {
      api_host:             PH_HOST,
      capture_pageview:     true,      // auto page views
      capture_pageleave:    true,      // bounce detection
      persistence:          'localStorage',
      autocapture:          false,     // manual events only — avoid PII in DOM
      sanitize_properties:  (props) => { delete props['$current_url']; return props; },
      loaded: (ph) => {
        if (process.env.NODE_ENV === 'development') ph.debug();
      },
    });
    initialised = true;
  }, []);
  return null;
}

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  return (
    <PHProvider client={posthog}>
      <PostHogInit />
      {children}
    </PHProvider>
  );
}

/**
 * Call after successful login to link PostHog anonymous ID to student record.
 * Properties become available for cohort analysis in PostHog.
 */
export function posthogIdentify(params: {
  student_id: string;
  grade: string;
  plan: string;
  language: string;
  board?: string;
}) {
  if (!PH_KEY || typeof window === 'undefined') return;
  posthog.identify(params.student_id, {
    grade:    params.grade,
    plan:     params.plan,
    language: params.language,
    board:    params.board ?? 'CBSE',
    app:      'alfanumrik',
  });
}

/** Reset identity on sign-out to avoid cross-account contamination. */
export function posthogReset() {
  if (typeof window === 'undefined') return;
  posthog.reset();
}
