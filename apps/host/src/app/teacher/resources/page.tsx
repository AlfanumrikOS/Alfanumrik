'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

function LegacyRedirect() { const router = useRouter(); useEffect(() => { router.replace('/teacher/worksheets'); }, [router]); return <div role="status">Opening resources…</div>; }
export default function TeacherResourcesPage() { return <LegacyRedirect />; }
