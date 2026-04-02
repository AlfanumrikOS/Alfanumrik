'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';
import { Card, Button, ProgressBar, SectionHeader, LoadingFoxy, BottomNav, Badge } from '@/components/ui';
import { SUBJECT_META } from '@/lib/constants';
import { SectionErrorBoundary } from '@/components/SectionErrorBoundary';

/* ─── Types ─── */
interface ExamChapter {
  id: string;
  chapter_number: number;
  chapter_title: string;
  weightage_marks: number;
  mastery_percent: number;
}

interface Exam {
  id: string;
  student_id: string;
  exam_name: string;
  exam_type: string;
  subject: string;
  exam_date: string;
  total_marks: number;
  duration_minutes: number;
  is_active: boolean;
  created_at: string;
  exam_chapters: ExamChapter[];
}

interface CurriculumTopic {
  chapter_number: number;
  title: string;
}

/* ─── Constants ─── */
const EXAM_TYPES = [
  { id: 'unit_test', label: 'Unit Test', labelHi: 'इकाई परीक्षा', icon: '📝', color: '#E8581C' },
  { id: 'half_yearly', label: 'Half-Yearly', labelHi: 'अर्धवार्षिक', icon: '📋', color: '#7C3AED' },
  { id: 'annual', label: 'Annual', labelHi: 'वार्षिक', icon: '🎓', color: '#0891B2' },
];

export default function ExamsPage() {
  const { student, isLoggedIn, isLoading, isHi } = useAuth();
  const router = useRouter();

  // Exam list
  const [exams, setExams] = useState<Exam[]>([]);
  const [loading, setLoading] = useState(true);

  // Add exam form
  const [showForm, setShowForm] = useState(false);
  const [examType, setExamType] = useState<string>('unit_test');
  const [examName, setExamName] = useState('');
  const [selectedSubject, setSelectedSubject] = useState<string>('');
  const [examDate, setExamDate] = useState('');
  const [totalMarks, setTotalMarks] = useState(80);
  const [duration, setDuration] = useState(180);
  const [saving, setSaving] = useState(false);

  // Chapter selection
  const [availableChapters, setAvailableChapters] = useState<CurriculumTopic[]>([]);
  const [selectedChapters, setSelectedChapters] = useState<Record<number, boolean>>({});
  const [chapterWeightage, setChapterWeightage] = useState<Record<number, number>>({});
  const [loadingChapters, setLoadingChapters] = useState(false);

  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace('/login');
  }, [isLoading, isLoggedIn, router]);

  /* ─── Load exams ─── */
  const loadExams = useCallback(async () => {
    if (!student) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('exam_configs')
        .select('*, exam_chapters(*)')
        .eq('student_id', student.id)
        .eq('is_active', true)
        .order('exam_date');
      if (!error && data) setExams(data as Exam[]);
    } catch (e) {
      console.error('Load exams error:', e);
    }
    setLoading(false);
  }, [student]);

  useEffect(() => {
    if (student) loadExams();
  }, [student, loadExams]);

  /* ─── Load chapters when subject changes ─── */
  useEffect(() => {
    if (!selectedSubject || !student) {
      setAvailableChapters([]);
      return;
    }
    const loadChapters = async () => {
      setLoadingChapters(true);
      try {
        const { data, error } = await supabase
          .from('curriculum_topics')
          .select('chapter_number, title')
          .eq('grade', student.grade)
          .eq('subject', selectedSubject)
          .eq('is_active', true)
          .order('chapter_number');
        if (!error && data) {
          // Deduplicate by chapter_number
          const seen = new Set<number>();
          const unique = (data as CurriculumTopic[]).filter(c => {
            if (seen.has(c.chapter_number)) return false;
            seen.add(c.chapter_number);
            return true;
          });
          setAvailableChapters(unique);
        }
      } catch (e) {
        console.error('Load chapters error:', e);
      }
      setLoadingChapters(false);
    };
    loadChapters();
    setSelectedChapters({});
    setChapterWeightage({});
  }, [selectedSubject, student]);

  /* ─── Toggle chapter ─── */
  const toggleChapter = (num: number) => {
    setSelectedChapters(prev => {
      const next = { ...prev };
      if (next[num]) {
        delete next[num];
        setChapterWeightage(w => { const nw = { ...w }; delete nw[num]; return nw; });
      } else {
        next[num] = true;
        setChapterWeightage(w => ({ ...w, [num]: 0 }));
      }
      return next;
    });
  };

  /* ─── Save exam ─── */
  const handleSave = async () => {
    if (!student || !examName.trim() || !selectedSubject || !examDate) return;
    setSaving(true);
    try {
      const { data: exam, error: examErr } = await supabase
        .from('exam_configs')
        .insert({
          student_id: student.id,
          exam_name: examName.trim(),
          exam_type: examType,
          subject: selectedSubject,
          exam_date: examDate,
          total_marks: totalMarks,
          duration_minutes: duration,
          is_active: true,
        })
        .select()
        .single();

      if (examErr || !exam) {
        alert(isHi ? 'परीक्षा सेव करने में त्रुटि' : 'Error saving exam');
        setSaving(false);
        return;
      }

      // Insert selected chapters
      const chaptersToInsert = Object.keys(selectedChapters)
        .filter(k => selectedChapters[Number(k)])
        .map(k => {
          const num = Number(k);
          const ch = availableChapters.find(c => c.chapter_number === num);
          return {
            exam_config_id: exam.id,
            chapter_number: num,
            chapter_title: ch?.title || `Chapter ${num}`,
            weightage_marks: chapterWeightage[num] || 0,
            mastery_percent: 0,
          };
        });

      if (chaptersToInsert.length > 0) {
        await supabase.from('exam_chapters').insert(chaptersToInsert);
      }

      // Reset form
      setShowForm(false);
      setExamName('');
      setExamType('unit_test');
      setSelectedSubject('');
      setExamDate('');
      setTotalMarks(80);
      setDuration(180);
      setSelectedChapters({});
      setChapterWeightage({});
      await loadExams();
    } catch (e) {
      console.error('Save exam error:', e);
      alert(isHi ? 'परीक्षा सेव करने में त्रुटि' : 'Error saving exam');
    }
    setSaving(false);
  };

  /* ─── Helpers ─── */
  const getDaysRemaining = (dateStr: string) => {
    const diff = new Date(dateStr).getTime() - Date.now();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  };

  const getSubjectMeta = (code: string) => SUBJECT_META.find(s => s.code === code);

  const getChaptersProgress = (chapters: ExamChapter[]) => {
    if (!chapters || chapters.length === 0) return 0;
    const total = chapters.reduce((a, c) => a + c.mastery_percent, 0);
    return Math.round(total / chapters.length);
  };

  const getPredictedScore = (chapters: ExamChapter[], totalMarks: number) => {
    if (!chapters || chapters.length === 0) return 0;
    const totalWeight = chapters.reduce((a, c) => a + c.weightage_marks, 0);
    if (totalWeight === 0) {
      const avgMastery = chapters.reduce((a, c) => a + c.mastery_percent, 0) / chapters.length;
      return Math.round((avgMastery / 100) * totalMarks);
    }
    const weighted = chapters.reduce((a, c) => a + (c.mastery_percent / 100) * c.weightage_marks, 0);
    return Math.round(weighted);
  };

  if (isLoading || !student) return <LoadingFoxy />;

  /* ═══ RENDER ═══ */
  return (
    <div className="mesh-bg min-h-dvh pb-nav">
      {/* Header */}
      <header className="page-header" style={{ background: 'rgba(251,248,244,0.88)', backdropFilter: 'blur(20px)', borderColor: 'var(--border)' }}>
        <div className="app-container py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => router.push('/dashboard')} className="text-[var(--text-3)]">&larr;</button>
            <h1 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)' }}>
              {isHi ? 'मेरी परीक्षाएँ' : 'My Exams'}
            </h1>
          </div>
          {!showForm && (
            <button
              onClick={() => setShowForm(true)}
              className="text-xs px-3 py-1.5 rounded-lg font-semibold"
              style={{ background: 'var(--orange)', color: '#fff' }}
            >
              + {isHi ? 'परीक्षा जोड़ें' : 'Add Exam'}
            </button>
          )}
        </div>
      </header>

      <main className="app-container py-5 space-y-4">
        <SectionErrorBoundary section="Exams">
        {/* ═══ ADD EXAM FORM ═══ */}
        {showForm && (
          <Card accent="var(--orange)">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold" style={{ fontFamily: 'var(--font-display)' }}>
                {isHi ? 'नई परीक्षा जोड़ें' : 'Add New Exam'}
              </h2>
              <button onClick={() => setShowForm(false)} className="text-[var(--text-3)] text-sm">&times;</button>
            </div>

            {/* Exam Type */}
            <div className="mb-4">
              <p className="text-xs text-[var(--text-3)] mb-2 font-medium">
                {isHi ? 'परीक्षा प्रकार' : 'Exam Type'}
              </p>
              <div className="grid grid-cols-3 gap-2">
                {EXAM_TYPES.map(t => (
                  <button
                    key={t.id}
                    onClick={() => setExamType(t.id)}
                    className="rounded-xl p-3 text-center transition-all"
                    style={{
                      background: examType === t.id ? `${t.color}15` : 'var(--surface-2)',
                      border: examType === t.id ? `2px solid ${t.color}` : '1.5px solid var(--border)',
                    }}
                  >
                    <div className="text-xl mb-1">{t.icon}</div>
                    <div className="text-[10px] font-semibold" style={{ color: examType === t.id ? t.color : 'var(--text-3)' }}>
                      {isHi ? t.labelHi : t.label}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Exam Name */}
            <div className="mb-4">
              <label className="text-xs text-[var(--text-3)] mb-1.5 block ml-1 font-medium">
                {isHi ? 'परीक्षा का नाम' : 'Exam Name'}
              </label>
              <input
                type="text"
                value={examName}
                onChange={e => setExamName(e.target.value)}
                placeholder={isHi ? 'जैसे: गणित इकाई परीक्षा 1' : 'e.g. Math Unit Test 1'}
                className="input-base w-full"
              />
            </div>

            {/* Subject Selector */}
            <div className="mb-4">
              <p className="text-xs text-[var(--text-3)] mb-2 font-medium">
                {isHi ? 'विषय चुनें' : 'Select Subject'}
              </p>
              <div className="grid grid-cols-3 gap-2">
                {SUBJECT_META.slice(0, 9).map(s => (
                  <button
                    key={s.code}
                    onClick={() => setSelectedSubject(s.code)}
                    className="rounded-xl p-3 text-center transition-all"
                    style={{
                      background: selectedSubject === s.code ? `${s.color}12` : 'var(--surface-1)',
                      border: selectedSubject === s.code ? `2px solid ${s.color}` : '1.5px solid var(--border)',
                    }}
                  >
                    <div className="text-xl mb-1">{s.icon}</div>
                    <div className="text-[10px] font-semibold" style={{ color: selectedSubject === s.code ? s.color : 'var(--text-3)' }}>
                      {s.name}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Exam Date */}
            <div className="mb-4">
              <label className="text-xs text-[var(--text-3)] mb-1.5 block ml-1 font-medium">
                {isHi ? 'परीक्षा तिथि' : 'Exam Date'}
              </label>
              <input
                type="date"
                value={examDate}
                onChange={e => setExamDate(e.target.value)}
                className="input-base w-full"
                min={new Date().toISOString().split('T')[0]}
              />
            </div>

            {/* Total Marks & Duration */}
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <label className="text-xs text-[var(--text-3)] mb-1.5 block ml-1 font-medium">
                  {isHi ? 'कुल अंक' : 'Total Marks'}
                </label>
                <input
                  type="number"
                  value={totalMarks}
                  onChange={e => setTotalMarks(Number(e.target.value))}
                  className="input-base w-full"
                  min={1}
                />
              </div>
              <div>
                <label className="text-xs text-[var(--text-3)] mb-1.5 block ml-1 font-medium">
                  {isHi ? 'अवधि (मिनट)' : 'Duration (min)'}
                </label>
                <input
                  type="number"
                  value={duration}
                  onChange={e => setDuration(Number(e.target.value))}
                  className="input-base w-full"
                  min={1}
                />
              </div>
            </div>

            {/* Chapter Selector */}
            {selectedSubject && (
              <div className="mb-4">
                <p className="text-xs text-[var(--text-3)] mb-2 font-medium">
                  {isHi ? 'अध्याय चुनें और अंक भार दें' : 'Select Chapters & Set Weightage'}
                </p>
                {loadingChapters ? (
                  <p className="text-xs text-[var(--text-3)] py-4 text-center">
                    {isHi ? 'अध्याय लोड हो रहे हैं...' : 'Loading chapters...'}
                  </p>
                ) : availableChapters.length === 0 ? (
                  <p className="text-xs text-[var(--text-3)] py-4 text-center">
                    {isHi ? 'कोई अध्याय नहीं मिला' : 'No chapters found for this subject'}
                  </p>
                ) : (
                  <div className="space-y-2 max-h-60 overflow-y-auto rounded-xl p-2" style={{ background: 'var(--surface-2)' }}>
                    {availableChapters.map(ch => (
                      <div
                        key={ch.chapter_number}
                        className="flex items-center gap-2 rounded-lg p-2"
                        style={{
                          background: selectedChapters[ch.chapter_number] ? 'rgba(232,88,28,0.06)' : 'transparent',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={!!selectedChapters[ch.chapter_number]}
                          onChange={() => toggleChapter(ch.chapter_number)}
                          className="rounded"
                        />
                        <span className="text-xs flex-1 truncate">
                          Ch {ch.chapter_number}: {ch.title}
                        </span>
                        {selectedChapters[ch.chapter_number] && (
                          <input
                            type="number"
                            value={chapterWeightage[ch.chapter_number] || 0}
                            onChange={e => setChapterWeightage(w => ({ ...w, [ch.chapter_number]: Number(e.target.value) }))}
                            className="input-base w-16 text-xs text-center"
                            placeholder={isHi ? 'अंक' : 'Marks'}
                            min={0}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Save Button */}
            <Button
              fullWidth
              onClick={handleSave}
              disabled={saving || !examName.trim() || !selectedSubject || !examDate}
              color="var(--orange)"
            >
              {saving
                ? (isHi ? 'सेव हो रहा है...' : 'Saving...')
                : (isHi ? 'परीक्षा सेव करें' : 'Save Exam')}
            </Button>
          </Card>
        )}

        {/* ═══ EXAM LIST ═══ */}
        {loading ? (
          <div className="text-center py-16">
            <div className="text-4xl animate-float mb-3">📝</div>
            <p className="text-sm text-[var(--text-3)]">{isHi ? 'परीक्षाएँ लोड हो रही हैं...' : 'Loading exams...'}</p>
          </div>
        ) : exams.length === 0 && !showForm ? (
          <div className="text-center py-16">
            <div className="text-5xl mb-4">📋</div>
            <h3 className="text-lg font-bold mb-2" style={{ fontFamily: 'var(--font-display)' }}>
              {isHi ? 'कोई परीक्षा नहीं' : 'No Exams Yet'}
            </h3>
            <p className="text-sm text-[var(--text-3)] mb-4 max-w-xs mx-auto">
              {isHi
                ? 'अपनी परीक्षाएँ जोड़ें और ट्रैक करें'
                : 'Add your exams to track preparation and get study plans'}
            </p>
            <Button onClick={() => setShowForm(true)} color="var(--orange)">
              + {isHi ? 'पहली परीक्षा जोड़ें' : 'Add First Exam'}
            </Button>
          </div>
        ) : (
          <>
            {!showForm && exams.length > 0 && (
              <SectionHeader icon="📋">
                {isHi ? 'आगामी परीक्षाएँ' : 'Upcoming Exams'}
              </SectionHeader>
            )}

            {exams.map(exam => {
              const subMeta = getSubjectMeta(exam.subject);
              const daysLeft = getDaysRemaining(exam.exam_date);
              const chaptersProgress = getChaptersProgress(exam.exam_chapters);
              const predicted = getPredictedScore(exam.exam_chapters, exam.total_marks);
              const typeConfig = EXAM_TYPES.find(t => t.id === exam.exam_type);

              return (
                <Card key={exam.id} accent={subMeta?.color || 'var(--orange)'}>
                  {/* Header row */}
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2.5 flex-1 min-w-0">
                      <span className="text-2xl flex-shrink-0">{subMeta?.icon || '📚'}</span>
                      <div className="min-w-0">
                        <h3 className="text-sm font-bold truncate" style={{ fontFamily: 'var(--font-display)' }}>
                          {exam.exam_name}
                        </h3>
                        <div className="flex items-center gap-2 mt-0.5">
                          <Badge color={typeConfig?.color || 'var(--orange)'} size="sm">
                            {typeConfig?.icon} {isHi ? typeConfig?.labelHi : typeConfig?.label}
                          </Badge>
                          <span className="text-[10px] text-[var(--text-3)]">
                            {subMeta?.name}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Countdown */}
                    <div className="text-right flex-shrink-0 ml-2">
                      <div
                        className="text-xl font-bold"
                        style={{ color: daysLeft <= 3 ? '#EF4444' : daysLeft <= 7 ? '#F59E0B' : '#16A34A' }}
                      >
                        {daysLeft > 0 ? daysLeft : 0}
                      </div>
                      <div className="text-[10px] text-[var(--text-3)]">
                        {isHi ? 'दिन बाकी' : 'days left'}
                      </div>
                    </div>
                  </div>

                  {/* Progress */}
                  <ProgressBar
                    value={chaptersProgress}
                    color={subMeta?.color || 'var(--orange)'}
                    label={isHi ? `${exam.exam_chapters?.length || 0} अध्याय` : `${exam.exam_chapters?.length || 0} chapters`}
                    showPercent
                  />

                  {/* Stats row */}
                  <div className="flex items-center gap-4 mt-3 text-xs text-[var(--text-3)] flex-wrap">
                    <span>📅 {new Date(exam.exam_date).toLocaleDateString()}</span>
                    <span>📊 {isHi ? 'अनुमानित' : 'Predicted'}: {predicted}/{exam.total_marks}</span>
                    <span>⏱ {exam.duration_minutes} {isHi ? 'मिनट' : 'min'}</span>
                  </div>

                  {/* Action buttons */}
                  <div className="flex gap-2 mt-3 flex-wrap">
                    <button
                      onClick={() => router.push(`/study-plan?exam_id=${exam.id}`)}
                      className="text-xs px-3 py-1.5 rounded-lg font-semibold"
                      style={{ background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.2)', color: '#7C3AED' }}
                    >
                      📅 {isHi ? 'स्टडी प्लान' : 'Study Plan'}
                    </button>
                    <button
                      onClick={() => router.push(`/quiz?mode=exam&exam_id=${exam.id}`)}
                      className="text-xs px-3 py-1.5 rounded-lg font-semibold"
                      style={{ background: 'rgba(232,88,28,0.1)', border: '1px solid rgba(232,88,28,0.2)', color: 'var(--orange)' }}
                    >
                      {isHi ? 'परीक्षा मोड' : 'Exam Mode'}
                    </button>
                  </div>
                </Card>
              );
            })}
          </>
        )}
        </SectionErrorBoundary>
      </main>

      <BottomNav />
    </div>
  );
}
