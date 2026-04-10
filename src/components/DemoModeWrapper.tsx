'use client';

import { useAuth } from '@/lib/AuthContext';
import DemoModeBanner from './DemoModeBanner';

/**
 * Wrapper that reads demo status from AuthContext and renders the banner.
 * Placed in root layout so it appears on all pages for demo users.
 */
export default function DemoModeWrapper() {
  const { isDemoUser, isHi } = useAuth();
  return <DemoModeBanner isDemoUser={isDemoUser} isHi={isHi} />;
}
