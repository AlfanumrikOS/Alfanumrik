'use client';

/**
 * SchoolContext — White-label school branding provider
 *
 * When a user visits via a school subdomain (e.g., dps-noida.alfanumrik.com),
 * the middleware resolves the school and injects headers. This context reads
 * the school config via /api/school-config and provides it to the React tree.
 *
 * Usage:
 *   const { isSchoolContext, name, primaryColor } = useSchool();
 *   if (isSchoolContext) { /* render school-branded header * / }
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export interface SchoolConfig {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  tagline: string | null;
  isSchoolContext: boolean;
}

const DEFAULT_CONFIG: SchoolConfig = {
  id: '',
  name: 'Alfanumrik',
  slug: '',
  logoUrl: null,
  primaryColor: '#7C3AED',
  secondaryColor: '#F97316',
  tagline: 'Adaptive Learning OS',
  isSchoolContext: false,
};

const SchoolContext = createContext<SchoolConfig>(DEFAULT_CONFIG);

export function SchoolProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<SchoolConfig>(DEFAULT_CONFIG);

  useEffect(() => {
    // Only fetch if we might be on a subdomain
    // Quick client-side check before making a network request
    const host = window.location.hostname;
    const parts = host.split('.');
    const isSubdomain =
      (parts.length >= 3 && parts[0] !== 'www') ||
      (parts.length >= 2 && parts[parts.length - 1] === 'localhost' && parts[0] !== 'localhost');

    if (!isSubdomain) return;

    fetch('/api/school-config')
      .then(r => {
        if (!r.ok) return null;
        return r.json();
      })
      .then(data => {
        if (data && data.isSchoolContext) {
          setConfig(data);
          // Set CSS custom properties for theming
          document.documentElement.style.setProperty('--school-primary', data.primaryColor);
          document.documentElement.style.setProperty('--school-secondary', data.secondaryColor);
        }
      })
      .catch(() => {
        // Fail silently — default Alfanumrik branding
      });
  }, []);

  return (
    <SchoolContext.Provider value={config}>
      {children}
    </SchoolContext.Provider>
  );
}

export function useSchool(): SchoolConfig {
  return useContext(SchoolContext);
}
