'use client';

import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';

interface PresenceValue {
  active: boolean;
  register: () => () => void;
}

const PresenceContext = createContext<PresenceValue>({ active: false, register: () => () => undefined });

export function ExperiencePresenceProvider({ children }: { children: ReactNode }) {
  const [mounts, setMounts] = useState(0);
  const register = useCallback(() => {
    setMounts((count) => count + 1);
    return () => setMounts((count) => Math.max(0, count - 1));
  }, []);
  const value = useMemo(() => ({ active: mounts > 0, register }), [mounts, register]);
  return <PresenceContext.Provider value={value}>{children}</PresenceContext.Provider>;
}

export function useExperiencePresence() { return useContext(PresenceContext); }

/** Register before paint so Safari 14 never displays legacy and V3 nav together. */
export function ExperiencePresenceRegistration() {
  const { register } = useExperiencePresence();
  useLayoutEffect(() => register(), [register]);
  return null;
}
