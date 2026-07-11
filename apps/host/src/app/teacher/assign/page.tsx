'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { TeacherAssignV3, TeacherPageGate } from '../_components/TeacherV3Pages';

function LegacyRedirect() { const router = useRouter(); useEffect(() => { router.replace('/teacher/assignments'); }, [router]); return <div role="status">Opening assignments…</div>; }
export default function TeacherAssignPage() { return <TeacherPageGate legacy={<LegacyRedirect />} v3={<TeacherAssignV3 />} />; }
