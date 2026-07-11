'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { TeacherPageGate, TeacherResourcesV3 } from '../_components/TeacherV3Pages';

function LegacyRedirect() { const router = useRouter(); useEffect(() => { router.replace('/teacher/worksheets'); }, [router]); return <div role="status">Opening resources…</div>; }
export default function TeacherResourcesPage() { return <TeacherPageGate legacy={<LegacyRedirect />} v3={<TeacherResourcesV3 />} />; }
