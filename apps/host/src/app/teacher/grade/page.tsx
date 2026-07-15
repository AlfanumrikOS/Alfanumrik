'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

function LegacyRedirect() { const router = useRouter(); useEffect(() => { router.replace('/teacher/grade-book'); }, [router]); return <div role="status">Opening grade book…</div>; }
export default function TeacherGradePage() { return <LegacyRedirect />; }
