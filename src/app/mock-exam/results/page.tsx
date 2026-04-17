'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { Card, Button, ProgressBar } from '@/components/ui';
import { useSubjectLookup } from '@/lib/useSubjectLookup';

const SECTIONS = [
  { key: 'A', label: 'Section A', labelHi: 'खंड अ', marks: 1, count: 20 },
  { key: 'B', label: 'Section B', labelHi: 'खंड ब', marks: 2, count: 5 },
  { key: 'C', label: 'Section C', labelHi: 'खंड स', marks: 3, count: 7 },
  { key: 'D', label: 'Section D', labelHi: 'खंड द', marks: 5, count: 3 },
  { key: 'E', label: 'Section E', labelHi: 'खंड ई', marks: 4, count: 3 },
];

interface SectionResult {
  earned: number;
  total: number;
}

interface ResultData {
  correct: number;
  total: number;
  bySection: Record<string, SectionResult>;
  subject: string;
}

function getGradeLabel(pct: number, isHi: boolean) {
  if (pct >= 90) return isHi ? 'उत्कृष्ट (A+)' : 'Outstanding (A+)';
  if (pct >= 75) return isHi ? 'बहुत अच्छा (A)' : 'Very Good (A)';
  if (pct >= 60) return isHi ? 'अच्छा (B)' : 'Good (B)';
  if (pct >= 33) return isHi ? 'सफल (C)' : 'Pass (C)';
  return isHi ? 'असफल (F)' : 'Fail (F)';
}

function getGradeColor(pct: number) {
  if (pct >= 75) return '#16A34A';
  if (pct >= 33) return '#F97316';
  return '#DC2626';
}

function MockExamResultsInner() {
  const { isHi } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const isAuto = params.get('auto') === '1';
  const rawData = params.get('data');

  const [resultData, setResultData] = useState<ResultData | null>(null);
  // Subject display metadata — resolved from the same grade-/plan-gated source
  // of truth as the rest of the app. Null when the subject is not in the user's
  // allowed set (rare post-exam, but safe — display falls back to raw code).
  const lookupSubject = useSubjectLookup();

  useEffect(() => {
    if (!rawData) return;
    try {
      setResultData(JSON.parse(decodeURIComponent(rawData)));
    } catch {
      // malformed
    }
  }, [rawData]);

  if (!resultData) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 gap-4" style={{ background: 'var(--warm-cream, #FFF9F0)' }}>
        <div className="text-5xl">❓</div>
        <p style={{ color: 'var(--text-2)' }}>
          {isHi ? 'परिणाम नहीं मिले।' : 'No results found.'}
        </p>
        <Button onClick={() => router.push('/mock-exam')}>
          {isHi ? 'नई परीक्षा दें' : 'Take New Exam'}
        </Button>
      </div>
    );
  }

  const { correct, total, bySection, subject } = resultData;
  const pct = Math.round((correct / total) * 100);
  const gradeColor = getGradeColor(pct);
  const gradeLabel = getGradeLabel(pct, isHi);
  const subjectMeta = lookupSubject(subject);

  return (
    <div className="min-h-screen pb-24" style={{ background: 'var(--warm-cream, #FFF9F0)' }}>
      {/* Header */}
      <div className="px-4 py-5 flex items-center gap-3" style={{ borderBottom: '1px solid var(--border)', background: 'var(--warm-cream, #FFF9F0)' }}>
        <button onClick={() => router.push('/mock-exam')} className="text-xl p-1 rounded-lg hover:bg-black/5">←</button>
        <div>
          <h1 className="font-bold text-xl" style={{ color: 'var(--text-1)' }}>
            {isHi ? 'परीक्षा परिणाम' : 'Exam Results'}
          </h1>
          <p className="text-xs" style={{ color: 'var(--text-2)' }}>
            {subjectMeta?.icon} {isHi ? subjectMeta?.nameHi || subjectMeta?.name : subjectMeta?.name}
            {isAuto && <span className="ml-2 px-2 py-0.5 rounded-full text-[10px]" style={{ background: '#FEF2F2', color: '#DC2626' }}>
              {isHi ? 'समय समाप्त' : 'Time expired'}
            </span>}
          </p>
        </div>
      </div>

      <div className="px-4 py-6 max-w-lg mx-auto space-y-6">
        {/* Overall Score Card */}
        <Card accent={gradeColor}>
          <div className="text-center">
            <div className="text-6xl font-black mb-1" style={{ color: gradeColor }}>
              {correct}/{total}
            </div>
            <div className="text-2xl font-bold mb-2" style={{ color: gradeColor }}>
              {pct}%
            </div>
            <div className="inline-block px-4 py-1 rounded-full text-sm font-semibold mb-4"
              style={{ background: gradeColor + '20', color: gradeColor }}>
              {gradeLabel}
            </div>
            <ProgressBar value={pct} />
            <p className="text-xs mt-3" style={{ color: 'var(--text-2)' }}>
              {isHi ? 'कुल अंक' : 'Total Marks'}: {total}
            </p>
          </div>
        </Card>

        {/* Section-wise Scorecard */}
        <div>
          <h2 className="font-bold text-base mb-3" style={{ color: 'var(--text-1)' }}>
            {isHi ? 'खंड-वार अंक' : 'Section-wise Scores'}
          </h2>
          <div className="space-y-3">
            {SECTIONS.map(sec => {
              const secData = bySection[sec.key];
              if (!secData) return null;
              const secPct = secData.total > 0 ? Math.round((secData.earned / secData.total) * 100) : 0;
              const secColor = getGradeColor(secPct);
              return (
                <Card key={sec.key}>
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <span className="font-semibold text-sm" style={{ color: 'var(--text-1)' }}>
                        {isHi ? sec.labelHi : sec.label}
                      </span>
                      <span className="text-xs ml-2" style={{ color: 'var(--text-2)' }}>
                        ({sec.count} × {sec.marks} {isHi ? 'अंक' : 'marks'})
                      </span>
                    </div>
                    <span className="font-bold text-sm" style={{ color: secColor }}>
                      {secData.earned}/{secData.total}
                    </span>
                  </div>
                  <ProgressBar value={secPct} />
                  <p className="text-xs mt-1" style={{ color: secColor }}>
                    {secPct}% · {getGradeLabel(secPct, isHi)}
                  </p>
                </Card>
              );
            })}
          </div>
        </div>

        {/* Performance tips */}
        <Card>
          <h3 className="font-bold mb-3" style={{ color: 'var(--text-1)' }}>
            {isHi ? 'आगे की योजना' : 'Next Steps'}
          </h3>
          <ul className="space-y-2 text-sm" style={{ color: 'var(--text-2)' }}>
            {pct < 60 && (
              <li>📚 {isHi ? 'NCERT के बुनियादी पाठ दोबारा पढ़ें।' : 'Revisit NCERT fundamentals for weak sections.'}</li>
            )}
            {pct >= 60 && pct < 80 && (
              <li>🎯 {isHi ? 'अधिक PYQ अभ्यास करें।' : 'Practice more PYQs to push past 80%.'}</li>
            )}
            {pct >= 80 && (
              <li>🌟 {isHi ? 'बढ़िया! अब कठिन प्रश्नों पर ध्यान दें।' : 'Excellent! Focus on high-difficulty questions now.'}</li>
            )}
            <li>🔄 {isHi ? 'गलत उत्तरों को Foxy के साथ समझें।' : 'Review incorrect answers with Foxy AI tutor.'}</li>
            <li>📅 {isHi ? 'अगले सप्ताह फिर से मॉक परीक्षा दें।' : 'Retake a mock exam next week to track improvement.'}</li>
          </ul>
        </Card>

        {/* CTAs */}
        <div className="flex flex-col gap-3">
          <Button fullWidth onClick={() => router.push('/mock-exam')} style={{ background: 'var(--purple, #7C3AED)', color: '#fff', borderRadius: '1rem' }}>
            {isHi ? 'नई मॉक परीक्षा दें' : 'Take New Mock Exam'}
          </Button>
          <Button fullWidth variant="ghost" onClick={() => router.push('/pyq?subject=' + subject)}>
            {isHi ? 'PYQ अभ्यास करें' : 'Practice PYQs'}
          </Button>
          <Button fullWidth variant="ghost" onClick={() => router.push('/foxy?subject=' + subject)}>
            {isHi ? 'Foxy से समझें' : 'Explain with Foxy'}
          </Button>
          <Button fullWidth variant="ghost" onClick={() => router.push('/dashboard')}>
            {isHi ? 'डैशबोर्ड' : 'Dashboard'}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function MockExamResultsPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--warm-cream, #FFF9F0)' }}>
        <div className="text-4xl animate-bounce">📊</div>
      </div>
    }>
      <MockExamResultsInner />
    </Suspense>
  );
}
