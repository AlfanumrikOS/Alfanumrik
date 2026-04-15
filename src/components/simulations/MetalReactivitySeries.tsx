'use client';
import { useState } from 'react';

const METALS = [
  { name: 'K',  label: 'Potassium',  level: 0 },
  { name: 'Na', label: 'Sodium',     level: 1 },
  { name: 'Ca', label: 'Calcium',    level: 2 },
  { name: 'Mg', label: 'Magnesium',  level: 3 },
  { name: 'Al', label: 'Aluminium',  level: 4 },
  { name: 'Zn', label: 'Zinc',       level: 5 },
  { name: 'Fe', label: 'Iron',       level: 6 },
  { name: 'Pb', label: 'Lead',       level: 7 },
  { name: 'H',  label: 'Hydrogen',   level: 8 },
  { name: 'Cu', label: 'Copper',     level: 9 },
  { name: 'Ag', label: 'Silver',     level: 10 },
  { name: 'Au', label: 'Gold',       level: 11 },
];

function metalColor(level: number) {
  if (level <= 3) return 'var(--orange)';
  if (level <= 7) return '#eab308';
  return '#6b7280';
}

export default function MetalReactivitySeries() {
  const [metalA, setMetalA] = useState('Zn');
  const [metalB, setMetalB] = useState('Cu');

  const mA = METALS.find(m => m.name === metalA)!;
  const mB = METALS.find(m => m.name === metalB)!;
  const displaces = mA.level < mB.level;

  const equation = displaces
    ? `${mA.name} + ${mB.name}SO₄ → ${mA.name}SO₄ + ${mB.name}↓`
    : `No reaction — ${mA.name} is less reactive than ${mB.name}`;

  return (
    <div style={{ background: 'var(--surface-1)', borderRadius: 12, padding: 16, maxWidth: 600, margin: '0 auto', fontFamily: 'inherit' }}>
      <h3 style={{ color: 'var(--text-1)', fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Metal Reactivity Series</h3>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 120 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)', marginBottom: 8 }}>Reactivity Series</div>
          {METALS.map(m => (
            <div key={m.name} style={{
              padding: '4px 10px', marginBottom: 3, borderRadius: 6, fontSize: 12, fontWeight: 600,
              background: (metalA === m.name || metalB === m.name) ? `${metalColor(m.level)}33` : 'var(--surface-2)',
              border: metalA === m.name ? `2px solid var(--orange)` : metalB === m.name ? `2px solid var(--purple)` : '1px solid transparent',
              color: metalColor(m.level), cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span>{m.name} ({m.label})</span>
              {m.level <= 3 && <span style={{ fontSize: 10, color: 'var(--orange)' }}>Very reactive</span>}
              {m.level >= 9 && <span style={{ fontSize: 10, color: '#6b7280' }}>Least reactive</span>}
            </div>
          ))}
        </div>
        <div style={{ flex: 1, minWidth: 160 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)', marginBottom: 8 }}>Displacement Test</div>
          <div style={{ marginBottom: 8 }}>
            <label style={{ fontSize: 12, color: 'var(--text-2)' }}>Metal A (added):</label>
            <select value={metalA} onChange={e => setMetalA(e.target.value)} style={{ width: '100%', padding: '4px 8px', borderRadius: 6, marginTop: 2, border: '1px solid #ccc', fontSize: 13 }}>
              {METALS.map(m => <option key={m.name} value={m.name}>{m.name} — {m.label}</option>)}
            </select>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, color: 'var(--text-2)' }}>Metal B salt solution:</label>
            <select value={metalB} onChange={e => setMetalB(e.target.value)} style={{ width: '100%', padding: '4px 8px', borderRadius: 6, marginTop: 2, border: '1px solid #ccc', fontSize: 13 }}>
              {METALS.map(m => <option key={m.name} value={m.name}>{m.name}SO₄ solution</option>)}
            </select>
          </div>
          <svg viewBox="0 0 200 140" style={{ width: '100%', borderRadius: 8, background: 'var(--surface-2)' }}>
            <rect x={60} y={20} width={80} height={90} rx={6}
              fill={displaces ? 'rgba(100,160,220,0.3)' : 'rgba(200,200,200,0.2)'}
              stroke="#888" strokeWidth={2} />
            <text x={100} y={70} textAnchor="middle" fontSize="12" fill={displaces ? '#3b82f6' : '#888'}>
              {displaces ? `${mA.name}SO₄(aq)` : 'No reaction'}
            </text>
            {displaces && (
              <>
                <circle cx={80} cy={90} r={5} fill={metalColor(mB.level)} />
                <circle cx={100} cy={95} r={4} fill={metalColor(mB.level)} />
                <circle cx={120} cy={88} r={6} fill={metalColor(mB.level)} />
                <text x={100} y={120} textAnchor="middle" fontSize="10" fill={metalColor(mB.level)}>{mB.name} precipitates</text>
              </>
            )}
            <text x={100} y={15} textAnchor="middle" fontSize="10" fill="var(--text-2)">{mA.name} + {mB.name}SO₄</text>
          </svg>
          <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 8, fontSize: 12, fontWeight: 700,
            background: displaces ? 'rgba(22,163,74,0.1)' : 'rgba(239,68,68,0.1)',
            color: displaces ? '#16a34a' : '#ef4444', border: `1px solid ${displaces ? '#16a34a' : '#ef4444'}` }}>
            {equation}
          </div>
        </div>
      </div>
      <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 8, fontSize: 12, color: 'var(--text-1)', textAlign: 'center' }}>
        <b style={{ color: 'var(--orange)' }}>More reactive metal displaces less reactive from salt solution</b>
      </div>
    </div>
  );
}
