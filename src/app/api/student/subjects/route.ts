// src/app/api/student/subjects/route.ts
import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { getAllowedSubjectsForStudent } from '@/lib/subjects';
import { logger } from '@/lib/logger';
import { GRADE_SUBJECTS, SUBJECT_META } from '@/lib/constants';
import type { Subject } from '@/lib/subjects.types';

export const runtime = 'nodejs';

// Hindi name fallback for legacy path (governance tables unavailable)
const SUBJECT_NAME_HI: Record<string, string> = {
  math: 'गणित', science: 'विज्ञान', english: 'अंग्रेज़ी', hindi: 'हिंदी',
  social_studies: 'सामाजिक विज्ञान', physics: 'भौतिक विज्ञान', chemistry: 'रसायन विज्ञान',
  biology: 'जीव विज्ञान', computer_science: 'कंप्यूटर विज्ञान', economics: 'अर्थशास्त्र',
  accountancy: 'लेखा-शास्त्र', business_studies: 'व्यवसाय अध्ययन',
  political_science: 'राजनीति विज्ञान', history_sr: 'इतिहास', geography: 'भूगोल',
  coding: 'कोडिंग',
};

function buildLegacySubjects(grade: string): Subject[] {
  const metaMap = new Map(SUBJECT_META.map(s => [s.code as string, s]));
  const codes = GRADE_SUBJECTS[grade] ?? GRADE_SUBJECTS['9'] ?? [];
  return codes
    .filter(code => metaMap.has(code))
    .map(code => {
      const m = metaMap.get(code)!;
      return {
        code: m.code,
        name: m.name,
        nameHi: SUBJECT_NAME_HI[m.code] ?? m.name,
        icon: m.icon,
        color: m.color,
        subjectKind: 'cbse_core' as const,
        isCore: true,
        isLocked: false,
      };
    });
}

export async function GET() {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    // Try governed subject list first
    try {
      const subjects = await getAllowedSubjectsForStudent(user.id, { supabase });
      return NextResponse.json({ subjects });
    } catch (govErr) {
      // Governance RPCs unavailable — fall back to legacy constants
      logger.warn('subjects.governance_fallback', {
        userId: user.id,
        error: govErr instanceof Error ? govErr.message : String(govErr),
        note: 'Falling back to GRADE_SUBJECTS — governance migrations may not be applied',
      });

      // Look up student grade for correct subject list
      let grade = '9'; // safe default
      try {
        const { data: student } = await supabase
          .from('students')
          .select('grade')
          .eq('auth_user_id', user.id)
          .maybeSingle();
        if (student?.grade) grade = String(student.grade);
      } catch { /* use default grade */ }

      return NextResponse.json({ subjects: buildLegacySubjects(grade) });
    }
  } catch (e) {
    logger.error('subjects.list_failed', { err: String(e) });
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
