'use client';
import { useState, useEffect, useCallback } from 'react';
import SimulationViewer from '../../components/SimulationViewer';
import SimulationCard from '../../components/SimulationCard';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

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
  widget_code?: string;
  widget_type?: string;
  subject_code?: string;
  grade?: string;
}

const subjects = [
  { code: 'all', label: 'All Subjects', emoji: '📚' },
  { code: 'science', label: 'Science', emoji: '🔬' },
  { code: 'math', label: 'Mathematics', emoji: '📐' },
  { code: 'physics', label: 'Physics', emoji: '⚡' },
  { code: 'chemistry', label: 'Chemistry', emoji: '🧪' },
  { code: 'biology', label: 'Biology', emoji: '🧬' },
];

const grades = ['all', '6', '7', '8', '9', '10', '11', '12'];

async function fetchSimulations(subject: string, grade: string): Promise<Simulation[]> {
  const params = new URLSearchParams();
  params.append('is_active', 'eq.true');
  params.append('order', 'board_exam_relevance.desc,chapter_number.asc');
  if (subject !== 'all') params.append('subject_code', `eq.${subject}`);
  if (grade !== 'all') params.append('grade', `eq.${grade}`);
  // Only fetch sims that have real widget code (not placeholders)
  params.append('widget_code', 'neq.PLACEHOLDER');
  params.append('limit', '50');

  const res = await fetch(`${SUPABASE_URL}/rest/v1/interactive_simulations?${params}`, {
    headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` }
  });
  if (!res.ok) return [];
  return res.json();
}

async function fetchFullSimulation(id: string): Promise<Simulation | null> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/interactive_simulations?id=eq.${id}&limit=1`, {
    headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` }
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data[0] || null;
}

export default function SimulationsPage() {
  const [selectedSubject, setSelectedSubject] = useState('all');
  const [selectedGrade, setSelectedGrade] = useState('10');
  const [simulations, setSimulations] = useState<Simulation[]>([]);
  const [activeSim, setActiveSim] = useState<Simulation | null>(null);
  const [loading, setLoading] = useState(true);
  const [interactions, setInteractions] = useState(0);

  const loadSims = useCallback(async () => {
    setLoading(true);
    const data = await fetchSimulations(selectedSubject, selectedGrade);
    setSimulations(data);
    setLoading(false);
  }, [selectedSubject, selectedGrade]);

  useEffect(() => { loadSims(); }, [loadSims]);

  const openSim = async (id: string) => {
    const full = await fetchFullSimulation(id);
    if (full) {
      setActiveSim(full);
      setInteractions(0);
    }
  };

  const closeSim = () => setActiveSim(null);

  return (
    <div style={{ minHeight: '100vh', background: '#FBF8F4', padding: '0 0 40px' }}>
      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, #6366F1 0%, #8B5CF6 50%, #a855f7 100%)',
        padding: '32px 20px 28px',
        color: '#fff',
        textAlign: 'center'
      }}>
        <div style={{ fontSize: '32px', marginBottom: '8px' }}>🔬</div>
        <h1 style={{ fontSize: '24px', fontWeight: 700, margin: 0, fontFamily: 'Sora, sans-serif' }}>
          Interactive Lab
        </h1>
        <p style={{ fontSize: '13px', opacity: 0.8, marginTop: '6px', maxWidth: '400px', margin: '6px auto 0' }}>
          Explore NCERT concepts with interactive simulations. Drag sliders, click buttons, and learn by doing!
        </p>
      </div>

      {/* Filters */}
      <div style={{ padding: '16px 20px', background: '#fff', borderBottom: '1px solid #f0f0f0', position: 'sticky', top: 0, zIndex: 10 }}>
        {/* Subject pills */}
        <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '10px' }}>
          {subjects.map(s => (
            <button
              key={s.code}
              onClick={() => setSelectedSubject(s.code)}
              style={{
                padding: '6px 14px',
                borderRadius: '20px',
                border: 'none',
                fontSize: '12px',
                fontWeight: selectedSubject === s.code ? 600 : 400,
                background: selectedSubject === s.code ? '#6366F1' : '#f5f3ff',
                color: selectedSubject === s.code ? '#fff' : '#6366F1',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'all 0.15s'
              }}
            >
              {s.emoji} {s.label}
            </button>
          ))}
        </div>
        {/* Grade pills */}
        <div style={{ display: 'flex', gap: '6px', overflowX: 'auto' }}>
          {grades.map(g => (
            <button
              key={g}
              onClick={() => setSelectedGrade(g)}
              style={{
                padding: '4px 12px',
                borderRadius: '14px',
                border: '1px solid',
                borderColor: selectedGrade === g ? '#6366F1' : '#e5e5e5',
                fontSize: '11px',
                fontWeight: selectedGrade === g ? 600 : 400,
                background: selectedGrade === g ? '#6366F115' : '#fff',
                color: selectedGrade === g ? '#6366F1' : '#888',
                cursor: 'pointer',
                transition: 'all 0.15s'
              }}
            >
              {g === 'all' ? 'All grades' : `Class ${g}`}
            </button>
          ))}
        </div>
      </div>

      {/* Active Simulation Viewer */}
      {activeSim && activeSim.widget_code && (
        <div style={{ padding: '16px 20px' }}>
          <button onClick={closeSim} style={{
            marginBottom: '12px', padding: '6px 16px', borderRadius: '8px',
            border: '1px solid #ddd', background: '#fff', fontSize: '12px', cursor: 'pointer'
          }}>
            ← Back to all simulations
          </button>

          <SimulationViewer
            widgetCode={activeSim.widget_code}
            title={activeSim.title}
            description={activeSim.description}
            simType={activeSim.sim_type}
            onInteraction={() => setInteractions(prev => prev + 1)}
          />

          {/* Foxy integration */}
          {activeSim.foxy_intro_prompt && (
            <div style={{
              marginTop: '16px',
              background: '#fff',
              borderRadius: '14px',
              padding: '16px',
              border: '1px solid rgba(99,102,241,0.1)',
              display: 'flex',
              gap: '12px',
              alignItems: 'flex-start'
            }}>
              <span style={{ fontSize: '24px' }}>🦊</span>
              <div>
                <div style={{ fontSize: '13px', color: '#1a1a1a', lineHeight: 1.5 }}>
                  {activeSim.foxy_intro_prompt}
                </div>
                <div style={{ marginTop: '8px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {(activeSim.foxy_followup_prompts || []).slice(0, 3).map((prompt: string, i: number) => (
                    <a
                      key={i}
                      href={`/foxy?q=${encodeURIComponent(prompt)}`}
                      style={{
                        fontSize: '11px',
                        padding: '4px 10px',
                        borderRadius: '8px',
                        background: '#f5f3ff',
                        color: '#6366F1',
                        textDecoration: 'none',
                        border: '1px solid rgba(99,102,241,0.15)'
                      }}
                    >
                      {prompt.length > 50 ? prompt.substring(0, 50) + '...' : prompt}
                    </a>
                  ))}
                </div>
              </div>
            </div>
          )}

          {interactions > 0 && (
            <div style={{
              marginTop: '12px', textAlign: 'center',
              fontSize: '12px', color: '#22c55e', fontWeight: 500
            }}>
              ✨ {interactions} interaction{interactions > 1 ? 's' : ''} — great exploring!
            </div>
          )}
        </div>
      )}

      {/* Simulations Grid */}
      {!activeSim && (
        <div style={{ padding: '16px 20px' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <div style={{ fontSize: '36px', marginBottom: '12px', animation: 'bounce 1s infinite' }}>🔬</div>
              <div style={{ color: '#888', fontSize: '13px' }}>Loading simulations...</div>
            </div>
          ) : simulations.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <div style={{ fontSize: '36px', marginBottom: '12px' }}>🚧</div>
              <div style={{ color: '#888', fontSize: '14px', fontWeight: 500 }}>
                No simulations available yet for this selection
              </div>
              <div style={{ color: '#aaa', fontSize: '12px', marginTop: '4px' }}>
                We&apos;re building more every day! Try Science Class 10 for the most options.
              </div>
            </div>
          ) : (
            <>
              <div style={{ fontSize: '13px', color: '#888', marginBottom: '12px' }}>
                {simulations.length} simulation{simulations.length !== 1 ? 's' : ''} available
              </div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                gap: '14px'
              }}>
                {simulations.map(sim => (
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
                    onClick={openSim}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
