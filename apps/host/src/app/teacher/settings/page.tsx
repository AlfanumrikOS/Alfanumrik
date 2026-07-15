'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

function LegacyRedirect() { const router = useRouter(); useEffect(() => { router.replace('/teacher/profile'); }, [router]); return <div role="status" aria-busy="true" className="min-h-dvh" style={{ background: 'var(--bg)' }} />; }
export default function TeacherSettingsPage() { return <LegacyRedirect />; }
