'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { TeacherGradeV3, TeacherPageGate } from '../_components/TeacherV3Pages';

function LegacyRedirect() { const router = useRouter(); useEffect(() => { router.replace('/teacher/grade-book'); }, [router]); return <div role="status">Opening grade book…</div>; }
export default function TeacherGradePage() { return <TeacherPageGate legacy={<LegacyRedirect />} v3={<TeacherGradeV3 />} />; }
