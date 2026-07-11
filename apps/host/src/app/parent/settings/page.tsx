'use client';
import ParentV3PageGate from '../_components/ParentV3PageGate';
import { ParentV3Settings } from '../_components/ParentV3Views';
import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
function LegacySettingsRedirect() { const router = useRouter(); const params = useSearchParams(); useEffect(() => { router.replace(`/parent/profile?${params?.toString() ?? ''}`); }, [params, router]); return null; }
export default function ParentSettingsPage() { return <ParentV3PageGate legacy={<LegacySettingsRedirect />} v3={<ParentV3Settings />} />; }
