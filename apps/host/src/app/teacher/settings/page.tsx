'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { TeacherPageGate, TeacherSettingsV3 } from '../_components/TeacherV3Pages';

function LegacyRedirect() { const router = useRouter(); useEffect(() => { router.replace('/teacher/profile'); }, [router]); return <div role="status">Opening profile…</div>; }
export default function TeacherSettingsPage() { return <TeacherPageGate legacy={<LegacyRedirect />} v3={<TeacherSettingsV3 />} />; }
