'use client';

import { useState, useEffect } from 'react';

// Rule 9: NEVER hardcode API keys — use environment variables
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

async function nepApi(action: string, params: Record<string, unknown> = {}) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/nep-compliance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON },
    body: JSON.stringify({ action, ...params }),
  });
  return res.json();
}

const BLOOM_COLORS: Record<string, string> = { remember: '#3B82F6', understand: '#6366F1', apply: '#8B5CF6', analyze: '#D97706', evaluate: '#EA580C', create: '#DC2626' };

function BloomBar({ dist }: { dist: any }) {
  const total = (dist?.total || 1);
  return (<div>
    <div style={{ display: 'flex', height: 24, borderRadius: 6, overflow: 'hidden', marginBottom: 8 }}>
      {['remember','understand','apply','analyze','evaluate','create'].map(l => { const pct = total > 0 ? ((dist?.[l]||0)/total)*100 : 0; if (pct===0) return null; return <div key={l} style={{ width: `${pct}%`, backgroundColor: BLOOM_COLORS[l], minWidth: 2 }} title={`${l}: ${dist?.[l]||0}`} />; })}
    </div>
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
      {['remember','understand','apply','analyze','evaluate','create'].map(l => (<span key={l} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#94A3B8' }}><span style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: BLOOM_COLORS[l] }} />{l}: {dist?.[l]||0}</span>))}
    </div>
  </div>);
}

function CompetencyBadge({ level }: { level: string }) {
  const c: Record<string,{bg:string;text:string}> = { advanced:{bg:'#059669',text:'#D1FAE5'}, proficient:{bg:'#7C3AED',text:'#EDE9FE'}, developing:{bg:'#D97706',text:'#FEF3C7'}, beginning:{bg:'#DC2626',text:'#FEE2E2'} };
  const s = c[level]||c.beginning;
  return <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 10px', borderRadius: 99, backgroundColor: s.bg, color: s.text, textTransform: 'uppercase' as const }}>{level}</span>;
}

function BehaviorRating({ value, label }: { value: number|null; label: string }) {
  return (<div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
    <span style={{ fontSize: 13, color: '#94A3B8', minWidth: 120 }}>{label}</span>
    <div style={{ display: 'flex', gap: 3 }}>{[1,2,3,4,5].map(i => (<div key={i} style={{ width: 16, height: 16, borderRadius: 3, backgroundColor: value && i <= value ? '#6366F1' : '#1E293B', border: '1px solid #334155' }} />))}</div>
    <span style={{ fontSize: 12, color: '#E2E8F0', marginLeft: 4 }}>{value||'—'}/5</span>
  </div>);
}

export default function HPCPage() {
  const [hpc, setHpc] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // TODO(production): Get student_id from auth session, not hardcoded
  const studentId = 'c64920ff-ca82-47e3-9991-26051ca8a6cd';

  useEffect(() => {
    (async () => {
      setLoading(true);
      await nepApi('generate_hpc', { student_id: studentId });
      const data = await nepApi('get_hpc', { student_id: studentId });
      setHpc(data);
      setLoading(false);
    })();
  }, []);

  if (loading) return (<div style={pageStyle}><div style={{ textAlign: 'center', padding: 80, color: '#64748B' }}><div style={{ width: 40, height: 40, border: '3px solid #1E293B', borderTopColor: '#6366F1', borderRadius: '50%', margin: '0 auto 16px', animation: 'spin 0.8s linear infinite' }} />Generating Holistic Progress Card...</div><style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style></div>);
  if (!hpc || hpc.error) return <div style={pageStyle}><div style={{ textAlign: 'center', padding: 60, color: '#EF4444' }}>{hpc?.error || 'Failed to load HPC'}</div></div>;

  const stu = hpc.student;
  const comp = hpc.competency_levels || {};
  const subPerf = hpc.subject_performance || {};
  const behaviors = hpc.learning_behaviors || {};
  const holistic = hpc.holistic_indicators || {};
  const cbse = hpc.cbse_readiness || {};
  const portfolio = hpc.portfolio_highlights || [];

  return (
    <div style={pageStyle}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}} .hpc-card{background:#0F172A;border-radius:14px;padding:18px 20px;border:1px solid #1E293B;margin-bottom:14px} .hpc-title{font-size:15px;font-weight:600;color:#F1F5F9;margin:0 0 12px} .hpc-label{font-size:12px;color:#64748B;font-weight:500;margin:0 0 4px;text-transform:uppercase;letter-spacing:0.5px}`}</style>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid #1E293B' }}>
        <div>
          <p style={{ fontSize: 11, color: '#6366F1', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: 1, margin: '0 0 4px' }}>NEP 2020 Holistic Progress Card</p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#F8FAFC', margin: 0 }}>{stu?.name || 'Student'}</h1>
          <p style={{ fontSize: 14, color: '#64748B', margin: '4px 0 0' }}>Grade {stu?.grade} | {stu?.board || 'CBSE'} | {hpc.academic_year} {hpc.term}</p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 36, fontWeight: 700, color: '#6366F1' }}>P{hpc.class_percentile || 50}</div>
          <div style={{ fontSize: 11, color: '#64748B' }}>Class percentile</div>
        </div>
      </div>

      <div className="hpc-card"><h3 className="hpc-title">Bloom&apos;s taxonomy distribution</h3><BloomBar dist={hpc.bloom_distribution} /></div>

      {Object.entries(subPerf).filter(([,v]: any) => v.concepts_attempted > 0).map(([subject, perf]: any) => (
        <div key={subject} className="hpc-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 className="hpc-title" style={{ margin: 0, textTransform: 'capitalize' as const }}>{subject}</h3>
            {comp[subject] && <CompetencyBadge level={comp[subject].overall_level} />}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 10 }}>
            <div><p className="hpc-label">Mastery</p><p style={{ fontSize: 20, fontWeight: 700, color: '#E2E8F0', margin: 0 }}>{perf.avg_mastery_pct || 0}%</p></div>
            <div><p className="hpc-label">Concepts</p><p style={{ fontSize: 20, fontWeight: 700, color: '#E2E8F0', margin: 0 }}>{perf.concepts_attempted}/{perf.concepts_total}</p></div>
            <div><p className="hpc-label">Chapters</p><p style={{ fontSize: 20, fontWeight: 700, color: '#E2E8F0', margin: 0 }}>{perf.chapters_covered}/{perf.chapters_total}</p></div>
          </div>
        </div>
      ))}

      {Object.entries(cbse).filter(([,sections]: any) => Object.values(sections).some((s: any) => s.readiness_pct != null)).map(([subject, sections]: any) => (
        <div key={subject} className="hpc-card">
          <h3 className="hpc-title" style={{ textTransform: 'capitalize' as const }}>CBSE board exam readiness — {subject}</h3>
          {Object.entries(sections).map(([,s]: any) => (
            <div key={s.section} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0' }}>
              <span style={{ fontSize: 12, color: '#94A3B8', minWidth: 160, whiteSpace: 'nowrap' }}>{s.section} ({s.marks}m)</span>
              <div style={{ flex: 1, height: 8, backgroundColor: '#1E293B', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${s.readiness_pct || 0}%`, backgroundColor: (s.readiness_pct||0) >= 70 ? '#059669' : (s.readiness_pct||0) >= 40 ? '#D97706' : '#DC2626', borderRadius: 4 }} />
              </div>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#E2E8F0', minWidth: 40, textAlign: 'right' }}>{s.readiness_pct ?? '—'}%</span>
            </div>
          ))}
        </div>
      ))}

      <div className="hpc-card">
        <h3 className="hpc-title">Learning behaviors (NCF 2023)</h3>
        <BehaviorRating label="Consistency" value={behaviors.consistency} />
        <BehaviorRating label="Curiosity" value={behaviors.curiosity} />
        <BehaviorRating label="Self-regulation" value={behaviors.self_regulation} />
        <BehaviorRating label="Collaboration" value={behaviors.collaboration} />
      </div>

      <div className="hpc-card">
        <h3 className="hpc-title">Holistic indicators</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 10 }}>
          {[{label:'Sessions',val:holistic.total_sessions||0},{label:'Active days',val:holistic.active_days||0},{label:'Best streak',val:`${holistic.streak_best||0}d`},{label:'Notes',val:holistic.notes_created||0},{label:'Total XP',val:holistic.xp_total||0},{label:'Regularity',val:`${holistic.study_regularity_pct||0}%`}].map((s,i) => (
            <div key={i}><p className="hpc-label">{s.label}</p><p style={{ fontSize: 18, fontWeight: 600, color: '#E2E8F0', margin: 0 }}>{s.val}</p></div>
          ))}
        </div>
      </div>

      {portfolio.length > 0 && (<div className="hpc-card">
        <h3 className="hpc-title">Portfolio highlights</h3>
        {portfolio.map((p: any, i: number) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: i < portfolio.length-1 ? '1px solid #1E293B' : 'none' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: p.type === 'mastery' ? '#059669' : '#6366F1', flexShrink: 0 }} />
            <span style={{ fontSize: 13, color: '#E2E8F0', flex: 1 }}>{p.description}</span>
            <span style={{ fontSize: 11, color: '#64748B' }}>{p.date}</span>
          </div>
        ))}
      </div>)}

      <p style={{ textAlign: 'center', fontSize: 11, color: '#475569', margin: '20px 0' }}>
        Generated {new Date(hpc.generated_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })} | Alfanumrik Learning OS | NEP 2020 Compliant
      </p>
    </div>
  );
}

const pageStyle: React.CSSProperties = { maxWidth: 700, margin: '0 auto', padding: '20px 16px', fontFamily: "'Plus Jakarta Sans', 'Sora', system-ui, sans-serif", color: '#E2E8F0', backgroundColor: '#0B1120', minHeight: '100vh' };
