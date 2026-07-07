'use client';
import { useState } from 'react';

const STAGES = [
  { name: 'Screening', color: '#8D6E63', waterColor: '#5D4037', removes: 'Large debris: leaves, sticks, plastic', desc: 'Bar screens and mesh filters remove large floating objects from raw water.' },
  { name: 'Sedimentation', color: '#795548', waterColor: '#7B5E3A', removes: 'Heavy particles settle down', desc: 'Water sits in large tanks. Gravity pulls heavy suspended solids to the bottom.' },
  { name: 'Coagulation', color: '#9E9D24', waterColor: '#BCAC91', removes: 'Fine suspended particles clump together', desc: 'Alum (Al₂(SO₄)₃) added. Forms flocs that trap fine particles and colloids.' },
  { name: 'Filtration', color: '#558B2F', waterColor: '#C8D8B4', removes: 'Microorganisms, fine particles', desc: 'Water passes through sand, gravel, and activated carbon layers. Removes microbes.' },
  { name: 'Chlorination', color: '#1565C0', waterColor: '#E3F2FD', removes: 'Bacteria, viruses, pathogens', desc: 'Chlorine added (0.2–0.5 ppm). Kills remaining pathogens. Water is now safe to drink!' },
];

export default function WaterPurification() {
  const [step, setStep] = useState(0);
  const [turbidity, setTurbidity] = useState(1);

  const s = STAGES[step];
  const opacity = Math.max(0.1, 1 - step * 0.22 - (1 - turbidity) * 0.1);

  return (
    <div style={{ background: 'var(--surface-1)', borderRadius: 12, padding: 16, maxWidth: 600, margin: '0 auto', fontFamily: 'inherit' }}>
      <h3 style={{ color: 'var(--text-1)', fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Water Purification Plant</h3>
      <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
        {STAGES.map((st, i) => (
          <button key={i} onClick={() => setStep(i)} style={{ flex: 1, minWidth: 80, padding: '4px 6px', background: step === i ? s.color : 'var(--surface-2)', color: step === i ? '#fff' : 'var(--text-2)', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: step === i ? 700 : 400 }}>
            {i + 1}. {st.name}
          </button>
        ))}
      </div>
      <svg viewBox="0 0 560 200" style={{ width: '100%', background: 'var(--surface-2)', borderRadius: 8, display: 'block' }}>
        {[0, 1, 2, 3, 4].map(i => {
          const x = 30 + i * 100;
          const wc = STAGES[i].waterColor;
          const isCurrent = i === step;
          const isDone = i < step;
          const stageOpacity = isDone ? Math.max(0.1, 1 - i * 0.2) : i === step ? opacity : 1;
          return (
            <g key={i} onClick={() => setStep(i)} style={{ cursor: 'pointer' }}>
              <rect x={x} y={40} width={80} height={120} rx={6} fill={wc} opacity={stageOpacity}
                stroke={isCurrent ? '#F97316' : '#aaa'} strokeWidth={isCurrent ? 2.5 : 1} />
              <text x={x + 40} y={35} textAnchor="middle" fontSize={10} fill="var(--text-1)" fontWeight={isCurrent ? 700 : 400}>{STAGES[i].name}</text>
              {i < 4 && <path d={`M${x + 80},100 L${x + 100},100`} stroke="#aaa" strokeWidth={2} markerEnd="url(#farrow)" />}
              {i === 0 && <g>{[0, 1, 2].map(j => <line key={j} x1={x + 15 + j * 22} y1={40} x2={x + 15 + j * 22} y2={60} stroke="#8D6E63" strokeWidth={3} />)}</g>}
              {i === 1 && <ellipse cx={x + 40} cy={150} rx={28} ry={7} fill="#8D6E6366" />}
              {i === 2 && <text x={x + 40} y={100} textAnchor="middle" fontSize={18} opacity={0.7}>⭐</text>}
              {i === 3 && <>
                <rect x={x + 10} y={50} width={24} height={100} fill="#E8D5A3" opacity={0.7} />
                <rect x={x + 38} y={60} width={20} height={90} fill="#C8B88A" opacity={0.7} />
                <rect x={x + 62} y={55} width={14} height={95} fill="#1a1a1a" opacity={0.5} />
              </>}
              {i === 4 && <text x={x + 40} y={100} textAnchor="middle" fontSize={20} opacity={0.8}>💧</text>}
              {isDone && <text x={x + 60} y={55} fontSize={16} fill="#4CAF50">✓</text>}
            </g>
          );
        })}
        <defs>
          <marker id="farrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L0,6 L6,3 z" fill="#aaa" />
          </marker>
        </defs>
        <text x={280} y={185} textAnchor="middle" fontSize={11} fill="var(--text-2)">→ Flow direction: Raw water becomes drinking water →</text>
      </svg>
      <div style={{ marginTop: 8 }}>
        <label style={{ fontSize: 12, color: 'var(--text-2)' }}>Initial turbidity:
          <input type="range" min={0} max={2} step={1} value={turbidity} onChange={e => setTurbidity(+e.target.value)} style={{ marginLeft: 8, width: 100 }} />
          <span style={{ marginLeft: 6 }}>{['Low', 'Medium', 'High'][turbidity]}</span>
        </label>
      </div>
      <div style={{ marginTop: 8, padding: '8px 12px', background: s.color + '22', borderRadius: 8, fontSize: 13, color: 'var(--text-1)', borderLeft: `3px solid ${s.color}` }}>
        <strong>Stage {step + 1}: {s.name}</strong><br />
        Removes: <em>{s.removes}</em><br />
        <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{s.desc}</span>
      </div>
      <div style={{ marginTop: 8, display: 'flex', gap: 8, justifyContent: 'center' }}>
        <button onClick={() => setStep(s => Math.max(0, s - 1))} style={{ padding: '6px 16px', background: 'var(--purple)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>Back</button>
        <button onClick={() => setStep(s => Math.min(4, s + 1))} style={{ padding: '6px 16px', background: 'var(--orange)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>Next</button>
      </div>
      <div style={{ marginTop: 8, padding: '8px 12px', background: '#E3F2FD', borderRadius: 8, fontSize: 13, color: '#1565C0', borderLeft: '3px solid #1565C0' }}>
        Stages: <strong>Physical removal</strong> → <strong>Chemical treatment</strong> → <strong>Disinfection</strong>
      </div>
    </div>
  );
}
