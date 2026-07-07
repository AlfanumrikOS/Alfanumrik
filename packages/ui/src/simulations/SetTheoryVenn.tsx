'use client';

import { useState, useCallback } from 'react';

export const metadata = {
  id: 'set-theory-venn',
  name: 'Set Theory & Venn Diagrams',
  subject: 'Mathematics',
  grade: '11-12',
  description: 'Build Venn diagrams and explore union, intersection, complement, and difference of sets',
};

const ORANGE = '#F97316';
const PURPLE = '#7C3AED';

type Region = 'A-only' | 'B-only' | 'intersection' | 'outside' | null;

function parseSet(s: string): string[] {
  return s.split(',').map(x => x.trim()).filter(x => x.length > 0);
}

function setOp(a: string[], b: string[], u: string[]) {
  const aSet = new Set(a);
  const bSet = new Set(b);
  const uSet = new Set(u);
  const union = u.filter(x => aSet.has(x) || bSet.has(x));
  const intersection = a.filter(x => bSet.has(x));
  const aMinusB = a.filter(x => !bSet.has(x));
  const bMinusA = b.filter(x => !aSet.has(x));
  const outside = u.filter(x => !aSet.has(x) && !bSet.has(x));
  const complement = u.filter(x => !aSet.has(x) && !bSet.has(x));
  const formulaCheck = a.length + b.length - intersection.length;
  return { union, intersection, aMinusB, bMinusA, outside, complement, formulaCheck };
}

const REGION_INFO: Record<string, { label: string; color: string; formula: string }> = {
  'A-only': { label: 'A − B', color: `${ORANGE}22`, formula: 'Elements in A but not B' },
  'B-only': { label: 'B − A', color: `${PURPLE}22`, formula: 'Elements in B but not A' },
  'intersection': { label: 'A ∩ B', color: '#22c55e22', formula: 'Elements in both A and B' },
  'outside': { label: "U − (A∪B)", color: '#374151', formula: 'Elements outside both sets' },
};

export default function SetTheoryVenn() {
  const [inputA, setInputA] = useState('1, 2, 3, 4, 5');
  const [inputB, setInputB] = useState('4, 5, 6, 7, 8');
  const [inputU, setInputU] = useState('1, 2, 3, 4, 5, 6, 7, 8, 9, 10');
  const [highlighted, setHighlighted] = useState<Region>(null);

  const setA = parseSet(inputA);
  const setB = parseSet(inputB);
  const setU = parseSet(inputU);
  const { union, intersection, aMinusB, bMinusA, outside, formulaCheck } = setOp(setA, setB, setU);

  const getRegionElements = useCallback((region: Region): string[] => {
    if (region === 'A-only') return aMinusB;
    if (region === 'B-only') return bMinusA;
    if (region === 'intersection') return intersection;
    if (region === 'outside') return outside;
    return [];
  }, [aMinusB, bMinusA, intersection, outside]);

  const regionStyle = (region: Region) => ({
    cursor: 'pointer',
    opacity: highlighted === null || highlighted === region ? 1 : 0.4,
  });

  const inputStyle = {
    background: '#111827',
    border: '1px solid #374151',
    borderRadius: 8,
    color: '#f9fafb',
    padding: '6px 10px',
    fontSize: 13,
    width: '100%',
    outline: 'none',
  };
  const labelStyle = { color: '#9ca3af', fontSize: 12, marginBottom: 4 };

  return (
    <div style={{ background: '#111827', minHeight: '100vh', padding: 16, fontFamily: 'Plus Jakarta Sans, sans-serif', color: '#f9fafb' }}>
      <h2 style={{ textAlign: 'center', color: ORANGE, fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Set Theory & Venn Diagrams</h2>
      <p style={{ textAlign: 'center', color: '#9ca3af', fontSize: 12, marginBottom: 14 }}>Click regions to explore set operations</p>

      {/* Inputs */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 14 }}>
        <div>
          <p style={labelStyle}>Set A</p>
          <input value={inputA} onChange={e => setInputA(e.target.value)} style={{ ...inputStyle, borderColor: `${ORANGE}88` }} placeholder="e.g. 1, 2, 3" />
        </div>
        <div>
          <p style={labelStyle}>Set B</p>
          <input value={inputB} onChange={e => setInputB(e.target.value)} style={{ ...inputStyle, borderColor: `${PURPLE}88` }} placeholder="e.g. 3, 4, 5" />
        </div>
        <div>
          <p style={labelStyle}>Universal Set U</p>
          <input value={inputU} onChange={e => setInputU(e.target.value)} style={inputStyle} placeholder="e.g. 1-10" />
        </div>
      </div>

      {/* Venn SVG */}
      <div style={{ background: '#1f2937', borderRadius: 12, padding: 12, border: '1px solid #374151', marginBottom: 12 }}>
        <svg viewBox="0 0 360 200" style={{ width: '100%', maxWidth: 400, display: 'block', margin: '0 auto' }}>
          {/* Universal set border */}
          <rect x="5" y="5" width="350" height="190" rx="12" fill="none" stroke="#4b5563" strokeWidth="1.5" strokeDasharray="6 3" />
          <text x="16" y="20" fill="#6b7280" fontSize="11">U</text>

          {/* Outside region (clickable) */}
          <rect x="5" y="5" width="350" height="190" rx="12"
            fill={highlighted === 'outside' ? '#374151' : 'transparent'}
            style={regionStyle('outside')}
            onClick={() => setHighlighted(h => h === 'outside' ? null : 'outside')}
          />

          {/* Circle A */}
          <circle cx="145" cy="100" r="72"
            fill={highlighted === 'A-only' ? `${ORANGE}44` : `${ORANGE}18`}
            stroke={ORANGE} strokeWidth="2"
            style={regionStyle('A-only')}
            onClick={() => setHighlighted(h => h === 'A-only' ? null : 'A-only')}
          />

          {/* Circle B */}
          <circle cx="215" cy="100" r="72"
            fill={highlighted === 'B-only' ? `${PURPLE}44` : `${PURPLE}18`}
            stroke={PURPLE} strokeWidth="2"
            style={regionStyle('B-only')}
            onClick={() => setHighlighted(h => h === 'B-only' ? null : 'B-only')}
          />

          {/* Intersection overlay */}
          <clipPath id="clipA"><circle cx="145" cy="100" r="72" /></clipPath>
          <circle cx="215" cy="100" r="72"
            fill={highlighted === 'intersection' ? '#22c55e55' : '#22c55e22'}
            clipPath="url(#clipA)"
            style={regionStyle('intersection')}
            onClick={() => setHighlighted(h => h === 'intersection' ? null : 'intersection')}
          />

          {/* Labels */}
          <text x="105" y="95" fill={ORANGE} fontSize="13" fontWeight="700" textAnchor="middle">A</text>
          <text x="255" y="95" fill={PURPLE} fontSize="13" fontWeight="700" textAnchor="middle">B</text>

          {/* A-only elements */}
          <text x="105" y="112" fill="#fff" fontSize="10" textAnchor="middle">{aMinusB.slice(0, 5).join(', ')}</text>
          {aMinusB.length > 5 && <text x="105" y="126" fill="#9ca3af" fontSize="9" textAnchor="middle">+{aMinusB.length - 5} more</text>}

          {/* Intersection elements */}
          <text x="180" y="105" fill="#86efac" fontSize="10" textAnchor="middle">{intersection.slice(0, 4).join(', ')}</text>

          {/* B-only elements */}
          <text x="255" y="112" fill="#fff" fontSize="10" textAnchor="middle">{bMinusA.slice(0, 5).join(', ')}</text>
          {bMinusA.length > 5 && <text x="255" y="126" fill="#9ca3af" fontSize="9" textAnchor="middle">+{bMinusA.length - 5} more</text>}

          {/* Outside elements */}
          <text x="26" y="170" fill="#6b7280" fontSize="9">{outside.slice(0, 6).join(', ')}{outside.length > 6 ? '...' : ''}</text>
        </svg>

        {highlighted && (
          <div style={{ background: '#111827', borderRadius: 8, padding: 10, marginTop: 8, border: `1px solid ${REGION_INFO[highlighted].color}` }}>
            <p style={{ color: '#f9fafb', fontWeight: 700, fontSize: 13 }}>{REGION_INFO[highlighted].label}</p>
            <p style={{ color: '#9ca3af', fontSize: 12 }}>{REGION_INFO[highlighted].formula}</p>
            <p style={{ color: '#f9fafb', fontSize: 12, marginTop: 4 }}>
              Elements: {getRegionElements(highlighted).join(', ') || '∅ (empty)'}
            </p>
            <p style={{ color: '#6b7280', fontSize: 11, marginTop: 2 }}>n = {getRegionElements(highlighted).length}</p>
          </div>
        )}
      </div>

      {/* Results grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {[
          { label: 'A ∪ B', value: union, color: '#f9fafb' },
          { label: 'A ∩ B', value: intersection, color: '#86efac' },
          { label: 'A − B', value: aMinusB, color: ORANGE },
          { label: 'B − A', value: bMinusA, color: '#a78bfa' },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ background: '#1f2937', borderRadius: 8, padding: 10 }}>
            <p style={{ color, fontWeight: 700, fontSize: 12 }}>{label} <span style={{ color: '#6b7280', fontWeight: 400 }}>n = {value.length}</span></p>
            <p style={{ color: '#d1d5db', fontSize: 11, marginTop: 2 }}>{'{'}{value.slice(0, 6).join(', ')}{value.length > 6 ? '...' : ''} {'}'}</p>
          </div>
        ))}
      </div>

      <div style={{ background: '#1f2937', borderRadius: 8, padding: 10, marginTop: 8, border: '1px solid #374151' }}>
        <p style={{ color: '#9ca3af', fontSize: 12, textAlign: 'center' }}>
          n(A∪B) = n(A) + n(B) − n(A∩B) &nbsp;=&nbsp; {setA.length} + {setB.length} − {intersection.length} = <span style={{ color: ORANGE, fontWeight: 700 }}>{formulaCheck}</span>
          &nbsp;(actual: <span style={{ color: ORANGE, fontWeight: 700 }}>{union.length}</span>)
        </p>
      </div>
    </div>
  );
}
