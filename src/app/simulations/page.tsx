'use client';
import { useState, useEffect, useCallback, Suspense, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { BUILT_IN_SIMULATIONS, type BuiltInSimulation } from '@/components/simulations';
import dynamic from 'next/dynamic';
import SimulationCard from '../../components/SimulationCard';

const SimulationViewer = dynamic(() => import('../../components/SimulationViewer'), {
  loading: () => <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><span style={{ fontSize: 32 }}>🔬</span></div>,
  ssr: false,
});
import { supabaseUrl as SUPABASE_URL, supabaseAnonKey as SUPABASE_ANON_KEY } from '@/lib/supabase';

/* ═══ Adaptive Step-by-Step Viewer for Mobile ═══ */
function useIsMobile(breakpoint = 640) {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < breakpoint);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, [breakpoint]);
  return isMobile;
}

interface SimStep {
  title: string;
  description: string;
  emoji: string;
}

function SimulationStepView({ sim, onBack, children }: {
  sim: { title: string; description: string; thumbnailEmoji?: string; conceptTags?: string[]; foxyTip?: string };
  onBack: () => void;
  children: React.ReactNode;
}) {
  const [currentStep, setCurrentStep] = useState(0);
  const touchStart = useRef<number | null>(null);

  const steps: SimStep[] = [
    { title: 'Introduction', description: sim.description, emoji: '📖' },
    { title: 'Simulation', description: 'Interact with the simulation below. Drag, slide, and explore!', emoji: sim.thumbnailEmoji || '🔬' },
    ...(sim.foxyTip ? [{ title: "Foxy's Tip", description: sim.foxyTip, emoji: '🦊' }] : []),
    ...(sim.conceptTags?.length ? [{ title: 'Key Concepts', description: sim.conceptTags.join(' · '), emoji: '💡' }] : []),
  ];
  const totalSteps = steps.length;

  const handleTouchStart = (e: React.TouchEvent) => { touchStart.current = e.touches[0].clientX; };
  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStart.current === null) return;
    const diff = e.changedTouches[0].clientX - touchStart.current;
    if (Math.abs(diff) > 50) {
      if (diff < 0 && currentStep < totalSteps - 1) setCurrentStep(s => s + 1);
      if (diff > 0 && currentStep > 0) setCurrentStep(s => s - 1);
    }
    touchStart.current = null;
  };

  return (
    <div style={{ padding: '16px' }}>
      <button onClick={onBack} style={{
        marginBottom: '12px', padding: '10px 18px', borderRadius: '10px',
        border: '1px solid #e0e0e0', background: '#fff', fontSize: '14px',
        cursor: 'pointer', fontWeight: 500, color: '#555',
        display: 'flex', alignItems: 'center', gap: '6px', minHeight: '48px',
      }}>
        <span style={{ fontSize: '16px' }}>&#8592;</span> Back
      </button>

      {/* Progress bar */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '16px' }}>
        {steps.map((_, i) => (
          <div key={i} style={{
            flex: 1, height: '4px', borderRadius: '2px',
            background: i <= currentStep ? '#6366F1' : '#e5e7eb',
            transition: 'background 0.3s',
          }} />
        ))}
      </div>

      {/* Step indicator */}
      <div style={{ fontSize: '12px', color: '#888', marginBottom: '8px', fontWeight: 500 }}>
        Step {currentStep + 1} of {totalSteps}
      </div>

      {/* Step content */}
      <div
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        style={{
          background: '#fff', borderRadius: '16px', padding: '20px',
          border: '1px solid rgba(99,102,241,0.12)', minHeight: '200px',
          boxShadow: '0 2px 12px rgba(99,102,241,0.08)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
          <span style={{ fontSize: '28px' }}>{steps[currentStep].emoji}</span>
          <h3 style={{ fontSize: '18px', fontWeight: 700, color: '#1a1a1a', margin: 0, fontFamily: 'Sora, sans-serif' }}>
            {steps[currentStep].title}
          </h3>
        </div>
        <p style={{ fontSize: '15px', color: '#555', lineHeight: 1.7, margin: 0 }}>
          {steps[currentStep].description}
        </p>
        {/* Show actual simulation on step 1 */}
        {currentStep === 1 && <div style={{ marginTop: '16px' }}>{children}</div>}
      </div>

      {/* Dot indicators */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginTop: '16px' }}>
        {steps.map((_, i) => (
          <button key={i} onClick={() => setCurrentStep(i)} style={{
            width: i === currentStep ? '24px' : '8px', height: '8px',
            borderRadius: '4px', border: 'none', cursor: 'pointer',
            background: i === currentStep ? '#6366F1' : '#d1d5db',
            transition: 'all 0.3s',
          }} />
        ))}
      </div>

      {/* Prev / Next buttons */}
      <div style={{ display: 'flex', gap: '12px', marginTop: '20px' }}>
        <button
          onClick={() => setCurrentStep(s => Math.max(0, s - 1))}
          disabled={currentStep === 0}
          style={{
            flex: 1, padding: '14px', borderRadius: '12px', fontSize: '15px',
            fontWeight: 600, cursor: currentStep === 0 ? 'default' : 'pointer',
            border: '1px solid #e0e0e0', background: '#fff',
            color: currentStep === 0 ? '#ccc' : '#555', minHeight: '52px',
          }}
        >
          ← Previous
        </button>
        <button
          onClick={() => setCurrentStep(s => Math.min(totalSteps - 1, s + 1))}
          disabled={currentStep === totalSteps - 1}
          style={{
            flex: 1, padding: '14px', borderRadius: '12px', fontSize: '15px',
            fontWeight: 600, cursor: currentStep === totalSteps - 1 ? 'default' : 'pointer',
            border: 'none',
            background: currentStep === totalSteps - 1 ? '#e5e7eb' : '#6366F1',
            color: currentStep === totalSteps - 1 ? '#999' : '#fff', minHeight: '52px',
          }}
        >
          Next →
        </button>
      </div>
    </div>
  );
}

interface Simulation {
  id: string;
  title: string;
  description: string;
  sim_type: string;
  topic_title: string;
  chapter_number: number;
  difficulty: number;
  bloom_level: string;
  thumbnail_emoji: string;
  estimated_time_minutes: number;
  board_exam_relevance: number;
  concept_tags: string[];
  foxy_intro_prompt: string;
  foxy_followup_prompts: string[];
  widget_code?: string;
  widget_type?: string;
  subject_code?: string;
  grade?: string;
}

const subjectFilters = [
  { code: 'all', label: 'All', emoji: '📚' },
  { code: 'physics', label: 'Physics', emoji: '⚡' },
  { code: 'chemistry', label: 'Chemistry', emoji: '🧪' },
  { code: 'math', label: 'Maths', emoji: '📐' },
  { code: 'biology', label: 'Biology', emoji: '🧬' },
  { code: 'science', label: 'Science', emoji: '🔬' },
];

const gradeFilters = ['all', '5', '6', '7', '8', '9', '10', '11', '12'];

const difficultyLabels = ['', 'Easy', 'Medium', 'Intermediate', 'Advanced', 'Expert'];
const difficultyColors = ['', '#22c55e', '#3B8BD4', '#f59e0b', '#e24b4a', '#7c3aed'];
const bloomColors: Record<string, string> = {
  remember: '#94a3b8', understand: '#3B8BD4', apply: '#22c55e',
  analyze: '#f59e0b', evaluate: '#e24b4a', create: '#7c3aed',
};

async function fetchSimulations(subject: string, grade: string): Promise<Simulation[]> {
  const params = new URLSearchParams();
  params.append('is_active', 'eq.true');
  params.append('order', 'board_exam_relevance.desc,chapter_number.asc');
  if (subject !== 'all') params.append('subject_code', `eq.${subject}`);
  if (grade !== 'all') params.append('grade', `eq.${grade}`);
  params.append('widget_code', 'neq.PLACEHOLDER');
  params.append('limit', '50');

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/interactive_simulations?${params}`, {
      headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` }
    });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

async function fetchFullSimulation(id: string): Promise<Simulation | null> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/interactive_simulations?id=eq.${id}&limit=1`, {
      headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` }
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data[0] || null;
  } catch {
    return null;
  }
}

function LoadingSpinner() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '60px 20px' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '48px', marginBottom: '12px', animation: 'pulse 1.5s ease-in-out infinite' }}>🦊</div>
        <div style={{ color: '#888', fontSize: '14px' }}>Loading simulation...</div>
      </div>
    </div>
  );
}

export default function SimulationsPage() {
  const { isLoggedIn, isLoading, student } = useAuth();
  const router = useRouter();
  const [selectedSubject, setSelectedSubject] = useState('all');
  const [selectedGrade, setSelectedGrade] = useState(student?.grade || '10');
  const [dbSimulations, setDbSimulations] = useState<Simulation[]>([]);
  const [activeBuiltIn, setActiveBuiltIn] = useState<BuiltInSimulation | null>(null);
  const [activeDbSim, setActiveDbSim] = useState<Simulation | null>(null);
  const [loading, setLoading] = useState(true);
  const [interactions, setInteractions] = useState(0);
  const isMobile = useIsMobile();

  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace('/');
  }, [isLoading, isLoggedIn, router]);

  useEffect(() => {
    if (student?.grade) setSelectedGrade(student.grade);
  }, [student?.grade]);

  const loadDbSims = useCallback(async () => {
    setLoading(true);
    const data = await fetchSimulations(selectedSubject, selectedGrade);
    setDbSimulations(data);
    setLoading(false);
  }, [selectedSubject, selectedGrade]);

  useEffect(() => { loadDbSims(); }, [loadDbSims]);

  // Filter built-in simulations by subject and grade
  const filteredBuiltIn = BUILT_IN_SIMULATIONS.filter(sim => {
    const matchSubject = selectedSubject === 'all' || sim.subject === selectedSubject;
    const matchGrade = selectedGrade === 'all' || sim.grade.includes(selectedGrade);
    return matchSubject && matchGrade;
  });

  const openBuiltIn = (sim: BuiltInSimulation) => {
    setActiveBuiltIn(sim);
    setActiveDbSim(null);
    setInteractions(0);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const openDbSim = async (id: string) => {
    const full = await fetchFullSimulation(id);
    if (full) {
      setActiveDbSim(full);
      setActiveBuiltIn(null);
      setInteractions(0);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const closeSim = () => {
    setActiveBuiltIn(null);
    setActiveDbSim(null);
  };

  const isActive = activeBuiltIn || activeDbSim;

  return (
    <div style={{ minHeight: '100vh', background: '#FAFBFF', paddingBottom: '100px' }}>
      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, #6366F1 0%, #8B5CF6 40%, #a855f7 100%)',
        padding: '32px 20px 28px',
        color: '#fff',
        textAlign: 'center',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Decorative circles */}
        <div style={{ position: 'absolute', top: -20, right: -20, width: 100, height: 100, borderRadius: '50%', background: 'rgba(255,255,255,0.06)' }} />
        <div style={{ position: 'absolute', bottom: -30, left: -10, width: 80, height: 80, borderRadius: '50%', background: 'rgba(255,255,255,0.04)' }} />

        <div style={{ fontSize: '36px', marginBottom: '8px' }}>🧪</div>
        <h1 style={{ fontSize: '24px', fontWeight: 700, margin: 0, fontFamily: 'Sora, sans-serif' }}>
          Interactive Lab
        </h1>
        <p style={{ fontSize: '13px', opacity: 0.85, marginTop: '8px', maxWidth: '420px', margin: '8px auto 0', lineHeight: 1.5 }}>
          Touch, drag, and play with real science & math. Every simulation is a mini experiment!
        </p>
      </div>

      {/* Filters */}
      {!isActive && (
        <div style={{ padding: '14px 20px 12px', background: '#fff', borderBottom: '1px solid #f0f0f0', position: 'sticky', top: 0, zIndex: 10 }}>
          <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '10px', WebkitOverflowScrolling: 'touch' }}>
            {subjectFilters.map(s => (
              <button
                key={s.code}
                onClick={() => setSelectedSubject(s.code)}
                style={{
                  padding: '7px 14px',
                  borderRadius: '20px',
                  border: 'none',
                  fontSize: '12px',
                  fontWeight: selectedSubject === s.code ? 600 : 400,
                  background: selectedSubject === s.code ? '#6366F1' : '#f5f3ff',
                  color: selectedSubject === s.code ? '#fff' : '#6366F1',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  transition: 'all 0.2s',
                  flexShrink: 0,
                }}
              >
                {s.emoji} {s.label}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
            {gradeFilters.map(g => (
              <button
                key={g}
                onClick={() => setSelectedGrade(g)}
                style={{
                  padding: '5px 12px',
                  borderRadius: '14px',
                  border: '1px solid',
                  borderColor: selectedGrade === g ? '#6366F1' : '#e5e5e5',
                  fontSize: '11px',
                  fontWeight: selectedGrade === g ? 600 : 400,
                  background: selectedGrade === g ? '#6366F115' : '#fff',
                  color: selectedGrade === g ? '#6366F1' : '#888',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  flexShrink: 0,
                }}
              >
                {g === 'all' ? 'All grades' : `Class ${g}`}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Active Simulation (Built-in) — Adaptive Layout */}
      {activeBuiltIn && (
        isMobile ? (
          /* Mobile: Step-by-step mode */
          <SimulationStepView
            sim={{
              title: activeBuiltIn.title,
              description: activeBuiltIn.description,
              thumbnailEmoji: activeBuiltIn.thumbnailEmoji,
              conceptTags: activeBuiltIn.conceptTags,
              foxyTip: activeBuiltIn.foxyTip,
            }}
            onBack={closeSim}
          >
            <Suspense fallback={<LoadingSpinner />}>
              <activeBuiltIn.component />
            </Suspense>
          </SimulationStepView>
        ) : (
          /* Desktop: Full simulation view */
          <div style={{ padding: '16px 20px' }}>
            <button onClick={closeSim} style={{
              marginBottom: '14px', padding: '8px 18px', borderRadius: '10px',
              border: '1px solid #e0e0e0', background: '#fff', fontSize: '13px',
              cursor: 'pointer', fontWeight: 500, color: '#555',
              display: 'flex', alignItems: 'center', gap: '6px',
            }}>
              <span style={{ fontSize: '16px' }}>&#8592;</span> Back to all simulations
            </button>

            <div style={{
              borderRadius: '16px',
              overflow: 'hidden',
              border: '1px solid rgba(99,102,241,0.15)',
              background: '#fff',
              boxShadow: '0 4px 20px rgba(99,102,241,0.1)',
            }}>
              <div style={{
                padding: '14px 18px',
                background: 'linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%)',
                display: 'flex', alignItems: 'center', gap: '12px',
              }}>
                <span style={{ fontSize: '24px' }}>{activeBuiltIn.thumbnailEmoji}</span>
                <div>
                  <div style={{ color: '#fff', fontWeight: 700, fontSize: '16px' }}>{activeBuiltIn.title}</div>
                  <div style={{ color: 'rgba(255,255,255,0.75)', fontSize: '12px', marginTop: '2px' }}>{activeBuiltIn.description}</div>
                </div>
              </div>

              <div style={{ padding: '0' }}>
                <Suspense fallback={<LoadingSpinner />}>
                  <activeBuiltIn.component />
                </Suspense>
              </div>
            </div>

            {/* Foxy tip */}
            {activeBuiltIn.foxyTip && (
              <div style={{
                marginTop: '16px',
                background: '#fff',
                borderRadius: '14px',
                padding: '14px 16px',
                border: '1px solid rgba(14,165,233,0.15)',
                display: 'flex',
                gap: '12px',
                alignItems: 'flex-start',
              }}>
                <span style={{ fontSize: '28px', flexShrink: 0 }}>🦊</span>
                <div>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: '#0EA5E9', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>
                    Foxy&apos;s Tip
                  </div>
                  <div style={{ fontSize: '13px', color: '#1a1a1a', lineHeight: 1.6 }}>
                    {activeBuiltIn.foxyTip}
                  </div>
                </div>
              </div>
            )}

            {/* Concept tags */}
            <div style={{ marginTop: '12px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {activeBuiltIn.conceptTags.map((tag, i) => (
                <span key={i} style={{
                  fontSize: '11px', padding: '4px 10px', borderRadius: '8px',
                  background: '#f5f3ff', color: '#6366F1', fontWeight: 500,
                }}>
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )
      )}

      {/* Active Simulation (DB) — Adaptive Layout */}
      {activeDbSim && activeDbSim.widget_code && (
        isMobile ? (
          <SimulationStepView
            sim={{
              title: activeDbSim.title,
              description: activeDbSim.description,
              thumbnailEmoji: activeDbSim.thumbnail_emoji,
              conceptTags: activeDbSim.concept_tags,
              foxyTip: activeDbSim.foxy_intro_prompt,
            }}
            onBack={closeSim}
          >
            <SimulationViewer
              widgetCode={activeDbSim.widget_code}
              title={activeDbSim.title}
              description={activeDbSim.description}
              simType={activeDbSim.sim_type}
              onInteraction={() => setInteractions(prev => prev + 1)}
            />
          </SimulationStepView>
        ) : (
          <div style={{ padding: '16px 20px' }}>
            <button onClick={closeSim} style={{
              marginBottom: '14px', padding: '8px 18px', borderRadius: '10px',
              border: '1px solid #e0e0e0', background: '#fff', fontSize: '13px',
              cursor: 'pointer', fontWeight: 500, color: '#555',
              display: 'flex', alignItems: 'center', gap: '6px',
            }}>
              <span style={{ fontSize: '16px' }}>&#8592;</span> Back to all simulations
            </button>

            <SimulationViewer
              widgetCode={activeDbSim.widget_code}
              title={activeDbSim.title}
              description={activeDbSim.description}
              simType={activeDbSim.sim_type}
              onInteraction={() => setInteractions(prev => prev + 1)}
            />

            {activeDbSim.foxy_intro_prompt && (
              <div style={{
                marginTop: '16px', background: '#fff', borderRadius: '14px',
                padding: '14px 16px', border: '1px solid rgba(14,165,233,0.15)',
                display: 'flex', gap: '12px', alignItems: 'flex-start',
              }}>
                <span style={{ fontSize: '28px' }}>🦊</span>
                <div>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: '#0EA5E9', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>
                    Foxy says
                  </div>
                  <div style={{ fontSize: '13px', color: '#1a1a1a', lineHeight: 1.6 }}>
                    {activeDbSim.foxy_intro_prompt}
                  </div>
                  <div style={{ marginTop: '8px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {(activeDbSim.foxy_followup_prompts || []).slice(0, 3).map((prompt: string, i: number) => (
                      <a key={i} href={`/foxy?q=${encodeURIComponent(prompt)}`} style={{
                        fontSize: '11px', padding: '4px 10px', borderRadius: '8px',
                        background: '#f5f3ff', color: '#6366F1', textDecoration: 'none',
                        border: '1px solid rgba(99,102,241,0.15)',
                      }}>
                        {prompt.length > 50 ? prompt.substring(0, 50) + '...' : prompt}
                      </a>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {interactions > 0 && (
              <div style={{ marginTop: '12px', textAlign: 'center', fontSize: '12px', color: '#22c55e', fontWeight: 500 }}>
                {interactions} interaction{interactions > 1 ? 's' : ''} — great exploring!
              </div>
            )}
          </div>
        )
      )}

      {/* Simulation Grid */}
      {!isActive && (
        <div style={{ padding: '20px' }}>
          {/* Quick Start — Top 3 recommended */}
          {filteredBuiltIn.length > 0 && (
            <div style={{ marginBottom: '24px' }}>
              <div style={{ fontSize: '14px', fontWeight: 700, color: '#6366F1', marginBottom: '10px', fontFamily: 'Sora, sans-serif', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Quick Start
              </div>
              <div style={{ display: 'flex', gap: '10px', overflowX: 'auto', paddingBottom: '8px', WebkitOverflowScrolling: 'touch' as const }}>
                {filteredBuiltIn.slice(0, 3).map(sim => (
                  <button
                    key={`qs-${sim.id}`}
                    onClick={() => openBuiltIn(sim)}
                    style={{
                      flex: '0 0 auto', width: isMobile ? '260px' : '280px',
                      background: 'linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%)',
                      borderRadius: '14px', border: 'none', padding: '16px',
                      cursor: 'pointer', textAlign: 'left', color: '#fff',
                      minHeight: '52px', transition: 'transform 0.2s',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{ fontSize: '28px' }}>{sim.thumbnailEmoji}</span>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '14px', lineHeight: 1.3 }}>{sim.title}</div>
                        <div style={{ fontSize: '11px', opacity: 0.8, marginTop: '2px' }}>
                          {sim.estimatedTimeMinutes} min · {difficultyLabels[sim.difficulty]}
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Built-in simulations */}
          {filteredBuiltIn.length > 0 && (
            <>
              <div style={{ marginBottom: '14px' }}>
                <div style={{ fontSize: '16px', fontWeight: 700, color: '#1a1a1a', fontFamily: 'Sora, sans-serif' }}>
                  Interactive Experiments
                </div>
                <div style={{ fontSize: '12px', color: '#888', marginTop: '2px' }}>
                  Drag, slide, and play — built for your grade
                </div>
              </div>

              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(min(280px, 100%), 1fr))',
                gap: '14px',
                marginBottom: '32px',
              }}>
                {filteredBuiltIn.map(sim => (
                  <div
                    key={sim.id}
                    onClick={() => openBuiltIn(sim)}
                    style={{
                      background: '#fff',
                      borderRadius: '16px',
                      border: '1px solid rgba(99,102,241,0.12)',
                      padding: '18px',
                      cursor: 'pointer',
                      transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                      position: 'relative',
                      overflow: 'hidden',
                    }}
                    onMouseEnter={e => {
                      (e.currentTarget).style.transform = 'translateY(-3px)';
                      (e.currentTarget).style.boxShadow = '0 8px 24px rgba(99,102,241,0.15)';
                    }}
                    onMouseLeave={e => {
                      (e.currentTarget).style.transform = 'translateY(0)';
                      (e.currentTarget).style.boxShadow = 'none';
                    }}
                  >
                    {/* Gradient accent */}
                    <div style={{
                      position: 'absolute', top: 0, left: 0, right: 0, height: '3px',
                      background: 'linear-gradient(90deg, #6366F1, #a855f7, #ec4899)',
                    }} />

                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px', marginBottom: '12px' }}>
                      <span style={{
                        fontSize: '32px', width: '52px', height: '52px',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: 'linear-gradient(135deg, #f5f3ff, #ede9fe)',
                        borderRadius: '14px', flexShrink: 0,
                      }}>
                        {sim.thumbnailEmoji}
                      </span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: '15px', color: '#1a1a1a', lineHeight: 1.3 }}>
                          {sim.title}
                        </div>
                        <div style={{ fontSize: '11px', color: '#888', marginTop: '4px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                          <span style={{ textTransform: 'capitalize' }}>{sim.subject}</span>
                          <span>·</span>
                          <span>Class {sim.grade.join(', ')}</span>
                        </div>
                      </div>
                    </div>

                    <div style={{ fontSize: '12.5px', color: '#555', lineHeight: 1.6, marginBottom: '12px' }}>
                      {sim.description}
                    </div>

                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '12px' }}>
                      <span style={{
                        fontSize: '10px', padding: '3px 8px', borderRadius: '6px',
                        background: `${difficultyColors[sim.difficulty]}15`,
                        color: difficultyColors[sim.difficulty], fontWeight: 600,
                      }}>
                        {difficultyLabels[sim.difficulty]}
                      </span>
                      <span style={{
                        fontSize: '10px', padding: '3px 8px', borderRadius: '6px',
                        background: `${bloomColors[sim.bloomLevel] || '#666'}15`,
                        color: bloomColors[sim.bloomLevel] || '#666',
                        fontWeight: 600, textTransform: 'capitalize',
                      }}>
                        {sim.bloomLevel}
                      </span>
                      <span style={{
                        fontSize: '10px', padding: '3px 8px', borderRadius: '6px',
                        background: '#f5f5f5', color: '#888',
                      }}>
                        ~{sim.estimatedTimeMinutes} min
                      </span>
                    </div>

                    {!isMobile && (
                      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '10px' }}>
                        {sim.conceptTags.slice(0, 3).map((tag, i) => (
                          <span key={i} style={{
                            fontSize: '9px', padding: '2px 7px', borderRadius: '4px',
                            background: '#f5f3ff', color: '#6366F1',
                          }}>
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}

                    <div style={{
                      paddingTop: '10px', borderTop: '1px solid #f0f0f0',
                    }}>
                      {isMobile ? (
                        /* Full-width Play button on mobile — large thumb target */
                        <div style={{
                          background: '#6366F1', color: '#fff', borderRadius: '10px',
                          padding: '12px', textAlign: 'center', fontSize: '14px',
                          fontWeight: 700, minHeight: '48px', display: 'flex',
                          alignItems: 'center', justifyContent: 'center', gap: '6px',
                        }}>
                          Play Simulation <span style={{ fontSize: '16px' }}>&#9654;</span>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                            {sim.conceptTags.slice(0, 3).map((tag, i) => (
                              <span key={i} style={{
                                fontSize: '9px', padding: '2px 7px', borderRadius: '4px',
                                background: '#f5f3ff', color: '#6366F1',
                              }}>
                                {tag}
                              </span>
                            ))}
                          </div>
                          <span style={{
                            fontSize: '12px', color: '#6366F1', fontWeight: 700,
                            display: 'flex', alignItems: 'center', gap: '4px',
                          }}>
                            Play <span style={{ fontSize: '14px' }}>&#9654;</span>
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* DB simulations */}
          {loading ? (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <div style={{ fontSize: '36px', marginBottom: '12px' }}>🔬</div>
              <div style={{ color: '#888', fontSize: '13px' }}>Loading more simulations...</div>
            </div>
          ) : dbSimulations.length > 0 && (
            <>
              <div style={{ marginBottom: '14px' }}>
                <div style={{ fontSize: '15px', fontWeight: 600, color: '#1a1a1a' }}>
                  More Simulations
                </div>
                <div style={{ fontSize: '12px', color: '#888', marginTop: '2px' }}>
                  {dbSimulations.length} additional simulation{dbSimulations.length !== 1 ? 's' : ''}
                </div>
              </div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(min(280px, 100%), 1fr))',
                gap: '14px',
              }}>
                {dbSimulations.map(sim => (
                  <SimulationCard
                    key={sim.id}
                    id={sim.id}
                    title={sim.title}
                    description={sim.description || ''}
                    simType={sim.sim_type}
                    topicTitle={sim.topic_title}
                    chapterNumber={sim.chapter_number}
                    difficulty={sim.difficulty}
                    bloomLevel={sim.bloom_level}
                    thumbnailEmoji={sim.thumbnail_emoji}
                    estimatedTimeMinutes={sim.estimated_time_minutes}
                    boardExamRelevance={sim.board_exam_relevance}
                    conceptTags={sim.concept_tags || []}
                    onClick={openDbSim}
                  />
                ))}
              </div>
            </>
          )}

          {/* Empty state */}
          {filteredBuiltIn.length === 0 && !loading && dbSimulations.length === 0 && (
            <div style={{ textAlign: 'center', padding: '48px 20px' }}>
              <div style={{ fontSize: '48px', marginBottom: '14px' }}>🔭</div>
              <div style={{ color: '#555', fontSize: '15px', fontWeight: 600 }}>
                No simulations for this selection yet
              </div>
              <div style={{ color: '#aaa', fontSize: '13px', marginTop: '6px', lineHeight: 1.5 }}>
                Try &quot;All Subjects&quot; or a different grade. We&apos;re adding new experiments every week!
              </div>
            </div>
          )}
        </div>
      )}

      <style jsx>{`
        @keyframes pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.1); }
        }
      `}</style>
    </div>
  );
}
