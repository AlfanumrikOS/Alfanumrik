'use client';
import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
function LegacySettingsRedirect() { const router = useRouter(); const params = useSearchParams(); useEffect(() => { router.replace(`/parent/profile?${params?.toString() ?? ''}`); }, [params, router]); return null; }
export default function ParentSettingsPage() { return <LegacySettingsRedirect />; }
