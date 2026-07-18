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
import { hashUserIdForAnalytics } from './posthog-client';

// Single, explicit enable gate — matches posthog-client.ts / posthog/client.ts.
// PostHog initialises ONLY when the operator flips NEXT_PUBLIC_POSTHOG_ENABLED
// to the literal "true" AND a non-empty browser key is present. Default OFF.
const PH_ENABLED = process.env.NEXT_PUBLIC_POSTHOG_ENABLED === 'true';
const PH_KEY    = process.env.NEXT_PUBLIC_POSTHOG_KEY   ?? '';
const PH_HOST   = process.env.NEXT_PUBLIC_POSTHOG_HOST  ?? 'https://eu.i.posthog.com';

/** True iff the deliberate enable gate is satisfied (flag on AND key present). */
const phEnabled = (): boolean => PH_ENABLED && PH_KEY.length > 0;

let initialised = false;

function PostHogInit() {
  useEffect(() => {
    if (initialised || !phEnabled() || typeof window === 'undefined') return;
    // first-init-wins: posthog-js is a single global singleton. If another init
    // path (posthog/client.ts or posthog-client.ts) already ran this session,
    // this call is a no-op. All three paths now share the SAME safe config
    // below (EU host, autocapture:false, disable_session_recording:true,
    // person_profiles:'identified_only'), so whichever wins is P13-safe.
    posthog.init(PH_KEY, {
      api_host:             PH_HOST,
      capture_pageview:     true,      // auto page views
      capture_pageleave:    true,      // bounce detection
      persistence:          'localStorage',
      autocapture:          false,     // manual events only — avoid PII in DOM
      // P13 (minors' product): never record sessions; only materialize person
      // profiles after identify() — parity with the other two init paths.
      disable_session_recording: true,
      person_profiles:      'identified_only',
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
 * Call after successful login to link PostHog to the student record.
 *
 * P13: the raw `student_id` (a Supabase auth UUID) MUST NEVER reach PostHog.
 * We hash it via `hashUserIdForAnalytics()` (SHA-256, 16-hex-char prefix) —
 * the SAME distinct_id derivation the funnel path in `analytics.ts` uses — so
 * both code paths agree on identity. Async because Web Crypto is async.
 * No-op unless the deliberate enable gate is satisfied.
 */
export async function posthogIdentify(params: {
  student_id: string;
  grade: string;
  plan: string;
  language: string;
  board?: string;
}): Promise<void> {
  if (!phEnabled() || typeof window === 'undefined') return;
  const distinctId = await hashUserIdForAnalytics(params.student_id);
  // If hashing is unavailable (no Web Crypto) we DO NOT fall back to the raw
  // id — better to skip identify than leak a UUID into PostHog.
  if (!distinctId) return;
  posthog.identify(distinctId, {
    grade:            params.grade,
    plan:             params.plan,
    language:         params.language,
    board:            params.board ?? 'CBSE',
    app:              'alfanumrik',
    distinct_id_hash: distinctId,
  });
}

/** Reset identity on sign-out to avoid cross-account contamination. */
export function posthogReset() {
  if (typeof window === 'undefined') return;
  posthog.reset();
}
