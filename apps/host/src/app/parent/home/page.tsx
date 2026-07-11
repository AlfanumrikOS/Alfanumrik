'use client';
import ParentV3PageGate from '../_components/ParentV3PageGate';
import { ParentV3Home } from '../_components/ParentV3Views';
import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
function LegacyHomeRedirect() { const router = useRouter(); const params = useSearchParams(); useEffect(() => { router.replace(`/parent?${params?.toString() ?? ''}`); }, [params, router]); return null; }
export default function ParentHomePage() { return <ParentV3PageGate legacy={<LegacyHomeRedirect />} v3={<ParentV3Home />} />; }
