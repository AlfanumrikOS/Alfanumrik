'use client';
import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
function LegacyHomeRedirect() { const router = useRouter(); const params = useSearchParams(); useEffect(() => { router.replace(`/parent?${params?.toString() ?? ''}`); }, [params, router]); return null; }
export default function ParentHomePage() { return <LegacyHomeRedirect />; }
