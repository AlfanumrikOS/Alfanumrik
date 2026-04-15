'use client';

import { useState, useEffect, useCallback, useMemo, Suspense } from 'react';
import dynamic from 'next/dynamic';
import SimulationSkeleton from '@/components/simulations/SimulationSkeleton';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';
import { BUILT_IN_SIMULATIONS, type BuiltInSimulation } from '@/components/simulations/index';
import type { ExperimentResult } from '@/components/stem/GuidedExperiment';
import { getExperimentForSimulation } from '@/components/stem/experiments';
import { isPremium } from '@/lib/plans';
import { useAllowedSubjects } from '@/lib/useAllowedSubjects';
import Link from 'next/link';

// Lazy-load GuidedExperiment — only rendered when a lab with a guided experiment is active
const GuidedExperiment = dynamic(() => import('@/components/stem/GuidedExperiment'), {
  ssr: false,
  loading: () => <div className="p-8 text-center animate-pulse text-2xl">🔬</div>,
});

/* ─── Types ─── */
interface DbSimulation {
  id: string;
  title: string;
  description: string;
  topic_title: string;
  chapter_number: number;
  difficulty: number;
  bloom_level: string;
  thumbnail_emoji: string;
  estimated_time_minutes: number;
  concept_tags: string[];
  widget_code?: string;
  widget_type?: string;
  subject_code?: string;
  grade?: string;
}

type ActiveLab =
  | { type: 'builtin'; sim: BuiltInSimulation }
  | { type: 'db'; sim: DbSimulation };

/* ─── Constants ───
 * STEM_SUBJECT_SUBSET is the closed set of subject codes that have STEM
 * simulations/experiments. It is NOT a subject catalogue — it is a filter
 * applied on top of useAllowedSubjects() so a Class 6 student's tab row is
 * the intersection of:
 *   (their grade-plan-stream allowed subjects) ∩ (STEM-capable subjects).
 * Display metadata (Hindi label, emoji) is carried here because STEM has
 * a bespoke compact label ("CS") that differs from the global subject name.
 */
const STEM_SUBJECT_SUBSET: Array<{ code: string; en: string; hi: string; emoji: string }> = [
  { code: 'math', en: 'Math', hi: 'गणित', emoji: '📐' },
  { code: 'science', en: 'Science', hi: 'विज्ञान', emoji: '🔬' },
  { code: 'physics', en: 'Physics', hi: 'भौतिकी', emoji: '⚡' },
  { code: 'chemistry', en: 'Chemistry', hi: 'रसायन', emoji: '🧪' },
  { code: 'biology', en: 'Biology', hi: 'जीव विज्ञान', emoji: '🧬' },
  { code: 'coding', en: 'Coding', hi: 'कोडिंग', emoji: '</>' },
  { code: 'computer_science', en: 'CS', hi: 'कम्प्यूटर', emoji: '💻' },
];
const ALL_TAB = { code: 'all', en: 'All Subjects', hi: 'सभी विषय', emoji: '📚' };

const DIFFICULTY_LABEL: Record<number, string> = { 1: 'Easy', 2: 'Medium', 3: 'Hard', 4: 'Advanced', 5: 'Expert' };
const DIFFICULTY_COLOR: Record<number, string> = { 1: 'bg-green-100 text-green-700', 2: 'bg-blue-100 text-blue-700', 3: 'bg-yellow-100 text-yellow-700', 4: 'bg-red-100 text-red-700', 5: 'bg-purple-100 text-purple-700' };
const BLOOM_COLOR: Record<string, string> = {
  remember: 'bg-slate-100 text-slate-600', understand: 'bg-blue-100 text-blue-600',
  apply: 'bg-green-100 text-green-600', analyze: 'bg-yellow-100 text-yellow-700',
  evaluate: 'bg-red-100 text-red-600', create: 'bg-purple-100 text-purple-700',
};

/* ─── Page ─── */
export default function STEMCentrePage() {
  const { isLoggedIn, isLoading: authLoading, student, isHi } = useAuth();
  const router = useRouter();
  const [subject, setSubject] = useState('all');
  const [dbSims, setDbSims] = useState<DbSimulation[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeLab, setActiveLab] = useState<ActiveLab | null>(null);
  const [observation, setObservation] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState('');

  const grade = student?.grade || '10';

  // Source of truth: /api/student/subjects → get_available_subjects RPC.
  // Intersects grade ∩ plan ∩ stream server-side. STEM tab row is then
  // the intersection of (allowed) ∩ (STEM_SUBJECT_SUBSET), plus the "all"
  // pseudo-tab. A Class 6 free-plan student will only ever see the
  // subset that their plan unlocks AND that has STEM content.
  const { unlocked: allowedSubjects } = useAllowedSubjects();

  const saveObservation = useCallback(async (params: {
    type: 'simple' | 'guided';
    simId: string;
    experimentId?: string;
    observationText?: string;
    result?: ExperimentResult;
    subject: string;
  }) => {
    if (!student?.id) return false;
    setSaving(true);
    setSaveError('');
    const { error } = await supabase.from('experiment_observations').insert({
      student_id: student.id,
      simulation_id: params.simId,
      experiment_id: params.experimentId || null,
      observation_type: params.type,
      observation_text: params.type === 'simple' ? params.observationText : null,
      structured_observations: params.result?.observations || null,
      data_entries: params.result?.dataEntries || null,
      conclusion: params.result?.conclusion || null,
      quiz_score: params.result?.quizScore ?? null,
      total_questions: params.result?.totalQuestions ?? null,
      time_spent_seconds: params.result?.timeSpent ?? 0,
      grade,
      subject: params.subject,
    });
    setSaving(false);
    if (error) {
      setSaveError(isHi ? 'सहेजने में त्रुटि हुई' : 'Failed to save observation');
      return false;
    }
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
    return true;
  }, [student?.id, grade, isHi]);
  const allowedCodes = useMemo(() => new Set(allowedSubjects.map(s => s.code)), [allowedSubjects]);
  const tabs = useMemo(
    () => [ALL_TAB, ...STEM_SUBJECT_SUBSET.filter(t => allowedCodes.has(t.code))],
    [allowedCodes],
  );
  const availableSubjectCodes = useMemo(() => tabs.map(t => t.code), [tabs]);

  // Auth redirect
  useEffect(() => {
    if (!authLoading && !isLoggedIn) router.replace('/login');
  }, [authLoading, isLoggedIn, router]);

  // Fetch DB simulations
  const loadSims = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from('interactive_simulations')
      .select('id,title,description,topic_title,chapter_number,difficulty,bloom_level,thumbnail_emoji,estimated_time_minutes,concept_tags,widget_code,widget_type,subject_code,grade')
      .eq('is_active', true)
      .eq('grade', grade)
      .neq('widget_code', 'PLACEHOLDER')
      .neq('quality_status', 'rejected')
      .order('chapter_number', { ascending: true })
      .limit(50);

    if (subject !== 'all') query = query.eq('subject_code', subject);

    const { data } = await query;
    setDbSims((data as DbSimulation[]) || []);
    setLoading(false);
  }, [grade, subject]);

  useEffect(() => { loadSims(); }, [loadSims]);

  // Filter built-in sims
  const builtInFiltered = BUILT_IN_SIMULATIONS.filter(s => {
    if (!s.grade.includes(grade)) return false;
    if (subject !== 'all' && s.subject !== subject) return false;
    return true;
  });

  // Reset subject if not available for grade ∩ plan ∩ STEM subset.
  useEffect(() => {
    if (!availableSubjectCodes.includes(subject)) setSubject('all');
  }, [grade, availableSubjectCodes, subject]);

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#FFF8F0] flex items-center justify-center">
        <div className="text-center">
          <div className="text-5xl animate-pulse mb-3">🔬</div>
          <p className="text-gray-500 text-sm">{isHi ? 'लोड हो रहा है...' : 'Loading...'}</p>
        </div>
      </div>
    );
  }

  /* ─── Plan Gate: STEM Lab requires Starter+ ─── */
  if (student && !isPremium(student.subscription_plan)) {
    return (
      <div className="min-h-screen bg-[#FFF8F0] flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-lg border border-orange-100 p-6 text-center">
          <div className="text-5xl mb-4">🔬</div>
          <h1 className="text-xl font-bold text-gray-900 font-[Sora] mb-2">
            {isHi ? 'STEM लैब' : 'STEM Lab'}
          </h1>
          <p className="text-sm text-gray-600 mb-4">
            {isHi
              ? 'STEM लैब्स, सिमुलेशन और गाइडेड प्रयोगों के साथ विज्ञान और गणित को जीवंत बनाएं।'
              : 'Bring science and math to life with STEM labs, simulations, and guided experiments.'}
          </p>

          <div className="bg-orange-50 rounded-xl p-4 mb-5 text-left">
            <p className="text-xs font-semibold text-orange-700 mb-2">
              {isHi ? 'STEM लैब में शामिल है:' : 'STEM Lab includes:'}
            </p>
            <ul className="space-y-1.5">
              {[
                { en: 'Interactive physics, chemistry & biology simulations', hi: 'इंटरैक्टिव भौतिकी, रसायन और जीव विज्ञान सिमुलेशन' },
                { en: 'Guided experiments with observations & conclusions', hi: 'अवलोकन और निष्कर्ष के साथ गाइडेड प्रयोग' },
                { en: 'Math & coding labs aligned to CBSE curriculum', hi: 'CBSE पाठ्यक्रम के अनुसार गणित और कोडिंग लैब्स' },
                { en: 'Save your experiment observations', hi: 'अपने प्रयोग के अवलोकन सहेजें' },
              ].map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-gray-700">
                  <span className="text-orange-500 mt-0.5 flex-shrink-0">&#10003;</span>
                  {isHi ? item.hi : item.en}
                </li>
              ))}
            </ul>
          </div>

          <p className="text-xs text-gray-500 mb-4">
            {isHi
              ? 'STEM लैब Starter योजना और उससे ऊपर के लिए उपलब्ध है।'
              : 'STEM Lab is available on the Starter plan and above.'}
          </p>

          <Link
            href="/pricing"
            className="inline-block w-full py-3 bg-orange-500 hover:bg-orange-600 text-white rounded-xl text-sm font-semibold transition-colors active:scale-[0.98] min-h-[44px]"
          >
            {isHi ? 'योजनाएं देखें' : 'View Plans'}
          </Link>

          <button
            onClick={() => router.push('/dashboard')}
            className="mt-3 text-xs text-gray-400 hover:text-gray-600 font-medium min-h-[44px]"
          >
            {isHi ? 'डैशबोर्ड पर वापस जाएं' : 'Back to Dashboard'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FFF8F0] pb-24">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur border-b border-orange-100 px-4 py-3">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900 font-[Sora]">
              🔬 {isHi ? 'STEM लैब' : 'STEM Lab'}
            </h1>
            <p className="text-xs text-gray-500">
              {isHi ? `कक्षा ${grade} — प्रयोग और सिमुलेशन` : `Grade ${grade} — Experiments & Simulations`}
            </p>
          </div>
          <span className="text-xs bg-orange-100 text-orange-700 px-2 py-1 rounded-full font-medium">
            {builtInFiltered.length + dbSims.length} {isHi ? 'लैब्स' : 'labs'}
          </span>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 pt-4">
        {/* Subject Tabs */}
        <div className="flex gap-2 overflow-x-auto pb-3 scrollbar-hide">
          {tabs.map(t => (
            <button
              key={t.code}
              onClick={() => setSubject(t.code)}
              className={`flex-shrink-0 px-3 py-2 rounded-xl text-sm font-medium transition-all ${
                subject === t.code
                  ? 'bg-orange-500 text-white shadow-md'
                  : 'bg-white text-gray-600 hover:bg-orange-50 border border-gray-200'
              }`}
            >
              {t.emoji} {isHi ? t.hi : t.en}
            </button>
          ))}
        </div>

        {/* Active Lab View */}
        {activeLab && (() => {
          const simId = activeLab.sim.id;
          const experiment = getExperimentForSimulation(simId, grade);
          const simNode = activeLab.type === 'builtin' ? (
            <Suspense fallback={<SimulationSkeleton />}>
              <activeLab.sim.component />
            </Suspense>
          ) : activeLab.sim.widget_code ? (
            <iframe
              srcDoc={activeLab.sim.widget_code}
              className="w-full min-h-[400px] border-0 rounded-lg"
              sandbox="allow-scripts allow-same-origin"
              title={activeLab.sim.title}
            />
          ) : null;

          /* If a guided experiment exists, use the full 6-step flow */
          if (experiment && simNode) {
            return (
              <section className="mb-6">
                <GuidedExperiment
                  title={experiment.title}
                  titleHi={experiment.titleHi}
                  chapterRef={experiment.chapterRef}
                  grade={grade}
                  subject={experiment.subject}
                  difficulty={experiment.difficulty}
                  bloomLevel={experiment.bloomLevel}
                  estimatedMinutes={experiment.estimatedMinutes}
                  objective={experiment.objective}
                  objectiveHi={experiment.objectiveHi}
                  materials={experiment.materials}
                  simulation={simNode}
                  observations={experiment.observations}
                  dataTable={experiment.dataTable}
                  conclusionPrompt={experiment.conclusionPrompt}
                  conclusionPromptHi={experiment.conclusionPromptHi}
                  quizQuestions={experiment.quizQuestions}
                  onComplete={async (result: ExperimentResult) => {
                    await saveObservation({
                      type: 'guided',
                      simId,
                      experimentId: experiment.id,
                      result,
                      subject: experiment.subject,
                    });
                    setTimeout(() => {
                      setActiveLab(null);
                      setObservation('');
                    }, 2000);
                  }}
                  onClose={() => { setActiveLab(null); setObservation(''); }}
                />
              </section>
            );
          }

          /* Fallback: simple simulation view (no guided experiment defined) */
          return (
            <section className="mb-6 bg-white rounded-2xl shadow-lg border border-orange-100 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 bg-orange-50 border-b border-orange-100">
                <div>
                  <h2 className="font-bold text-gray-900">{activeLab.sim.title}</h2>
                  <p className="text-xs text-gray-500">
                    {activeLab.type === 'db' && activeLab.sim.topic_title
                      ? `Ch ${activeLab.sim.chapter_number} — ${activeLab.sim.topic_title}`
                      : activeLab.type === 'builtin'
                      ? activeLab.sim.conceptTags.slice(0, 3).join(' · ')
                      : ''}
                  </p>
                </div>
                <button
                  onClick={() => { setActiveLab(null); setObservation(''); }}
                  className="px-3 py-1.5 bg-red-50 text-red-600 rounded-lg text-sm font-medium hover:bg-red-100 transition"
                >
                  {isHi ? 'बंद करें' : 'Close Lab'}
                </button>
              </div>

              <div className="p-4">
                <div className="bg-gray-50 rounded-xl overflow-hidden min-h-[300px] flex items-center justify-center">
                  {simNode || (
                    <p className="text-gray-400 text-sm">{isHi ? 'सिमुलेशन उपलब्ध नहीं' : 'Simulation not available'}</p>
                  )}
                </div>

                {/* Observation prompt with save */}
                <div className="mt-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    🦊 {isHi ? 'तुमने क्या देखा? लिखो:' : 'What did you observe? Write it down:'}
                  </label>
                  <textarea
                    value={observation}
                    onChange={e => setObservation(e.target.value)}
                    placeholder={isHi ? 'अपना अवलोकन यहाँ लिखें...' : 'Write your observation here...'}
                    className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:ring-2 focus:ring-orange-300 focus:border-orange-400 outline-none resize-none"
                    rows={2}
                  />
                  <button
                    onClick={async () => {
                      const subj = activeLab!.type === 'builtin'
                        ? (activeLab!.sim as BuiltInSimulation).subject
                        : ((activeLab!.sim as DbSimulation).subject_code || 'science');
                      const ok = await saveObservation({
                        type: 'simple',
                        simId,
                        observationText: observation,
                        subject: subj,
                      });
                      if (ok) setObservation('');
                    }}
                    disabled={!observation.trim() || saving}
                    className="mt-2 w-full py-2.5 bg-orange-500 hover:bg-orange-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-xl text-sm font-semibold transition-colors active:scale-[0.98] min-h-[44px]"
                  >
                    {saving
                      ? (isHi ? 'सहेज रहे हैं...' : 'Saving...')
                      : (isHi ? '💾 अवलोकन सहेजें' : '💾 Save Observation')}
                  </button>
                  {saveSuccess && (
                    <p className="mt-2 text-sm text-green-600 font-medium text-center">
                      {isHi ? '✅ अवलोकन सफलतापूर्वक सहेजा गया!' : '✅ Observation saved successfully!'}
                    </p>
                  )}
                  {saveError && (
                    <p className="mt-2 text-sm text-red-600 font-medium text-center">{saveError}</p>
                  )}
                </div>
              </div>
            </section>
          );
        })()}

        {saveSuccess && !activeLab && (
          <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-2xl text-center">
            <p className="text-green-700 font-semibold text-sm">
              {isHi ? '🎉 प्रयोग सफलतापूर्वक सहेजा गया!' : '🎉 Experiment saved successfully!'}
            </p>
            <p className="text-green-600 text-xs mt-1">
              {isHi ? 'आपके अवलोकन और निष्कर्ष रिकॉर्ड हो गए हैं।' : 'Your observations and conclusions have been recorded.'}
            </p>
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="flex justify-center py-12">
            <div className="text-center">
              <div className="text-4xl animate-pulse mb-2">🦊</div>
              <p className="text-gray-400 text-sm">{isHi ? 'लैब्स लोड हो रहे हैं...' : 'Loading labs...'}</p>
            </div>
          </div>
        )}

        {/* Empty State */}
        {!loading && !activeLab && builtInFiltered.length === 0 && dbSims.length === 0 && (
          <div className="text-center py-16 max-w-xs mx-auto">
            <div className="text-5xl mb-3">🔬</div>
            <h3 className="text-gray-900 font-bold text-base mb-2">
              {isHi ? 'इस फ़िल्टर के लिए कोई लैब नहीं मिला' : 'No labs found for this filter'}
            </h3>
            <p className="text-gray-500 text-sm mb-4">
              {isHi
                ? 'कोई अन्य विषय चुनें या सभी विषय देखें। हम जल्द ही और लैब्स जोड़ रहे हैं!'
                : 'Try another subject or view all subjects. We\'re adding more labs soon!'}
            </p>
            <button
              onClick={() => setSubject('all')}
              className="px-5 py-2.5 min-h-[44px] bg-orange-500 hover:bg-orange-600 text-white rounded-xl text-sm font-semibold transition-colors active:scale-[0.98]"
            >
              {isHi ? '📚 सभी विषय दिखाएं' : '📚 Show All Subjects'}
            </button>
          </div>
        )}

        {/* Lab Cards Grid */}
        {!loading && (builtInFiltered.length > 0 || dbSims.length > 0) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pb-4">
            {/* Built-in simulations */}
            {builtInFiltered.map(sim => (
              <LabCard
                key={sim.id}
                emoji={sim.thumbnailEmoji}
                title={sim.title}
                chapter={sim.conceptTags[0] || ''}
                difficulty={sim.difficulty}
                bloomLevel={sim.bloomLevel}
                timeMin={sim.estimatedTimeMinutes}
                isActive={activeLab?.type === 'builtin' && activeLab.sim.id === sim.id}
                hasGuided={!!getExperimentForSimulation(sim.id, grade)}
                isHi={isHi}
                onStart={() => { setActiveLab({ type: 'builtin', sim }); setObservation(''); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
              />
            ))}

            {/* DB simulations */}
            {dbSims.map(sim => (
              <LabCard
                key={sim.id}
                emoji={sim.thumbnail_emoji || '🧪'}
                title={sim.title}
                chapter={sim.topic_title ? `Ch ${sim.chapter_number} — ${sim.topic_title}` : ''}
                difficulty={sim.difficulty}
                bloomLevel={sim.bloom_level}
                timeMin={sim.estimated_time_minutes}
                isActive={activeLab?.type === 'db' && activeLab.sim.id === sim.id}
                isHi={isHi}
                onStart={() => { setActiveLab({ type: 'db', sim }); setObservation(''); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

/* ─── Lab Card Component ─── */
function LabCard({
  emoji, title, chapter, difficulty, bloomLevel, timeMin, isActive, hasGuided, isHi, onStart,
}: {
  emoji: string; title: string; chapter: string; difficulty: number;
  bloomLevel: string; timeMin: number; isActive: boolean; hasGuided?: boolean; isHi: boolean;
  onStart: () => void;
}) {
  return (
    <div className={`bg-white rounded-2xl shadow-md hover:shadow-lg transition-all border-2 ${
      isActive ? 'border-orange-400 ring-2 ring-orange-200' : 'border-transparent'
    }`}>
      <div className="p-4">
        <div className="flex items-start gap-3 mb-3">
          <span className="text-3xl flex-shrink-0">{emoji}</span>
          <div className="min-w-0">
            <h3 className="font-semibold text-gray-900 text-sm leading-snug line-clamp-2">{title}</h3>
            {chapter && <p className="text-xs text-gray-400 mt-0.5 truncate">{chapter}</p>}
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5 mb-3">
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${DIFFICULTY_COLOR[difficulty] || 'bg-gray-100 text-gray-600'}`}>
            {DIFFICULTY_LABEL[difficulty] || 'Medium'}
          </span>
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium capitalize ${BLOOM_COLOR[bloomLevel] || 'bg-gray-100 text-gray-600'}`}>
            {bloomLevel}
          </span>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
            ~{timeMin}{isHi ? ' मिनट' : ' min'}
          </span>
        </div>

        {hasGuided && (
          <span className="inline-block mb-2 text-[10px] px-2 py-0.5 rounded-full bg-orange-50 text-orange-600 font-semibold border border-orange-200">
            {isHi ? 'गाइडेड प्रयोग' : 'Guided Experiment'}
          </span>
        )}
        <button
          onClick={onStart}
          className="w-full py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-xl text-sm font-semibold transition-colors active:scale-[0.98]"
        >
          🧪 {hasGuided ? (isHi ? 'प्रयोग शुरू करें' : 'Start Experiment') : (isHi ? 'लैब शुरू करें' : 'Start Lab')}
        </button>
      </div>
    </div>
  );
}
