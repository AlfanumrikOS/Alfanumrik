'use client';

import { useState, useCallback } from 'react';

/**
 * Chemical Equation Balancer — Interactive Simulation
 *
 * CBSE Class 10, Chapter 1: Chemical Reactions and Equations
 * Board Exam Relevance: HIGH (2-3 marks guaranteed)
 *
 * Learning objective: Students understand atom conservation by
 * adjusting coefficients until both sides have equal atoms.
 *
 * Guided flow:
 * 1. See an unbalanced equation
 * 2. Count atoms on each side (shown visually)
 * 3. Adjust coefficients using +/- buttons
 * 4. Atoms recount in real-time
 * 5. Equation turns green when balanced
 * 6. Reflection: "Why must atoms be equal on both sides?"
 */

interface Element {
  symbol: string;
  count: number;
}

interface Compound {
  formula: string;
  elements: Element[];
}

interface Equation {
  name: string;
  nameHi: string;
  reactants: Compound[];
  products: Compound[];
  solution: number[]; // correct coefficients in order [r1, r2, ..., p1, p2, ...]
  hint: string;
  hintHi: string;
}

const EQUATIONS: Equation[] = [
  {
    name: 'Hydrogen + Oxygen → Water',
    nameHi: 'हाइड्रोजन + ऑक्सीजन → पानी',
    reactants: [
      { formula: 'H₂', elements: [{ symbol: 'H', count: 2 }] },
      { formula: 'O₂', elements: [{ symbol: 'O', count: 2 }] },
    ],
    products: [
      { formula: 'H₂O', elements: [{ symbol: 'H', count: 2 }, { symbol: 'O', count: 1 }] },
    ],
    solution: [2, 1, 2],
    hint: 'Start with oxygen — it appears in only one product.',
    hintHi: 'ऑक्सीजन से शुरू करो — यह सिर्फ एक उत्पाद में है।',
  },
  {
    name: 'Iron + Oxygen → Iron Oxide (Rust)',
    nameHi: 'लोहा + ऑक्सीजन → आयरन ऑक्साइड (जंग)',
    reactants: [
      { formula: 'Fe', elements: [{ symbol: 'Fe', count: 1 }] },
      { formula: 'O₂', elements: [{ symbol: 'O', count: 2 }] },
    ],
    products: [
      { formula: 'Fe₂O₃', elements: [{ symbol: 'Fe', count: 2 }, { symbol: 'O', count: 3 }] },
    ],
    solution: [4, 3, 2],
    hint: 'Balance Fe first, then find the LCM of oxygen atoms.',
    hintHi: 'पहले Fe संतुलित करो, फिर ऑक्सीजन का LCM खोजो।',
  },
  {
    name: 'Methane Combustion',
    nameHi: 'मीथेन का दहन',
    reactants: [
      { formula: 'CH₄', elements: [{ symbol: 'C', count: 1 }, { symbol: 'H', count: 4 }] },
      { formula: 'O₂', elements: [{ symbol: 'O', count: 2 }] },
    ],
    products: [
      { formula: 'CO₂', elements: [{ symbol: 'C', count: 1 }, { symbol: 'O', count: 2 }] },
      { formula: 'H₂O', elements: [{ symbol: 'H', count: 2 }, { symbol: 'O', count: 1 }] },
    ],
    solution: [1, 2, 1, 2],
    hint: 'Balance C first (easy), then H, then O last.',
    hintHi: 'पहले C संतुलित करो (आसान), फिर H, फिर O आखिर में।',
  },
  {
    name: 'Magnesium + Hydrochloric Acid',
    nameHi: 'मैग्नीशियम + हाइड्रोक्लोरिक एसिड',
    reactants: [
      { formula: 'Mg', elements: [{ symbol: 'Mg', count: 1 }] },
      { formula: 'HCl', elements: [{ symbol: 'H', count: 1 }, { symbol: 'Cl', count: 1 }] },
    ],
    products: [
      { formula: 'MgCl₂', elements: [{ symbol: 'Mg', count: 1 }, { symbol: 'Cl', count: 2 }] },
      { formula: 'H₂', elements: [{ symbol: 'H', count: 2 }] },
    ],
    solution: [1, 2, 1, 1],
    hint: 'Cl appears twice in MgCl₂ — you need 2 HCl.',
    hintHi: 'MgCl₂ में Cl दो बार है — तुम्हें 2 HCl चाहिए।',
  },
  {
    name: 'Photosynthesis',
    nameHi: 'प्रकाश संश्लेषण',
    reactants: [
      { formula: 'CO₂', elements: [{ symbol: 'C', count: 1 }, { symbol: 'O', count: 2 }] },
      { formula: 'H₂O', elements: [{ symbol: 'H', count: 2 }, { symbol: 'O', count: 1 }] },
    ],
    products: [
      { formula: 'C₆H₁₂O₆', elements: [{ symbol: 'C', count: 6 }, { symbol: 'H', count: 12 }, { symbol: 'O', count: 6 }] },
      { formula: 'O₂', elements: [{ symbol: 'O', count: 2 }] },
    ],
    solution: [6, 6, 1, 6],
    hint: 'Balance C first (need 6 CO₂), then H (need 6 H₂O), then check O.',
    hintHi: 'C पहले (6 CO₂ चाहिए), फिर H (6 H₂O), फिर O जाँचो।',
  },
];

function countAtoms(compounds: Compound[], coefficients: number[]): Record<string, number> {
  const counts: Record<string, number> = {};
  compounds.forEach((compound, i) => {
    const coeff = coefficients[i] || 1;
    compound.elements.forEach(el => {
      counts[el.symbol] = (counts[el.symbol] || 0) + el.count * coeff;
    });
  });
  return counts;
}

function isBalanced(eq: Equation, coeffs: number[]): boolean {
  const reactantCoeffs = coeffs.slice(0, eq.reactants.length);
  const productCoeffs = coeffs.slice(eq.reactants.length);
  const left = countAtoms(eq.reactants, reactantCoeffs);
  const right = countAtoms(eq.products, productCoeffs);
  const allSymbols = Array.from(new Set([...Object.keys(left), ...Object.keys(right)]));
  for (const sym of allSymbols) {
    if ((left[sym] || 0) !== (right[sym] || 0)) return false;
  }
  // At least one coefficient must be > 0
  return coeffs.every(c => c >= 1);
}

// Atom colors for visual distinction
const ATOM_COLORS: Record<string, string> = {
  H: '#3B82F6', O: '#EF4444', C: '#1F2937', N: '#8B5CF6',
  Fe: '#D97706', Mg: '#059669', Cl: '#06B6D4', Na: '#F59E0B',
  Ca: '#EC4899', S: '#FBBF24', K: '#7C3AED', P: '#10B981',
};

interface Props {
  isHi?: boolean;
}

export default function ChemicalBalancer({ isHi = false }: Props) {
  const [eqIdx, setEqIdx] = useState(0);
  const eq = EQUATIONS[eqIdx];
  const totalCompounds = eq.reactants.length + eq.products.length;
  const [coeffs, setCoeffs] = useState<number[]>(Array(totalCompounds).fill(1));
  const [showHint, setShowHint] = useState(false);
  const [solved, setSolved] = useState(false);

  const balanced = isBalanced(eq, coeffs);

  const updateCoeff = useCallback((idx: number, delta: number) => {
    setCoeffs(prev => {
      const next = [...prev];
      next[idx] = Math.max(1, Math.min(10, next[idx] + delta));
      return next;
    });
    setSolved(false);
  }, []);

  const checkAnswer = useCallback(() => {
    if (balanced) setSolved(true);
  }, [balanced]);

  const nextEquation = useCallback(() => {
    const next = (eqIdx + 1) % EQUATIONS.length;
    setEqIdx(next);
    setCoeffs(Array(EQUATIONS[next].reactants.length + EQUATIONS[next].products.length).fill(1));
    setShowHint(false);
    setSolved(false);
  }, [eqIdx]);

  const reactantCoeffs = coeffs.slice(0, eq.reactants.length);
  const productCoeffs = coeffs.slice(eq.reactants.length);
  const leftAtoms = countAtoms(eq.reactants, reactantCoeffs);
  const rightAtoms = countAtoms(eq.products, productCoeffs);
  const allSymbols = Array.from(new Set([...Object.keys(leftAtoms), ...Object.keys(rightAtoms)]));

  return (
    <div style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", maxWidth: 600, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#6366F1', marginBottom: 4 }}>
          {isHi ? '⚗️ रासायनिक समीकरण संतुलक' : '⚗️ Chemical Equation Balancer'}
        </div>
        <div style={{ fontSize: 12, color: '#64748B' }}>
          {isHi ? eq.nameHi : eq.name}
        </div>
      </div>

      {/* Equation with coefficient controls */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 16, padding: '12px 8px', background: solved ? '#f0fdf4' : balanced ? '#fefce8' : '#fff', border: `2px solid ${solved ? '#22c55e' : balanced ? '#eab308' : '#e2e8f0'}`, borderRadius: 12, transition: 'all 0.3s' }}>
        {eq.reactants.map((comp, i) => (
          <div key={`r-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            {i > 0 && <span style={{ fontSize: 16, color: '#94A3B8', margin: '0 2px' }}>+</span>}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
              <button onClick={() => updateCoeff(i, 1)} aria-label={`Increase ${comp.formula} coefficient`} style={{ width: 24, height: 20, border: '1px solid #e2e8f0', borderRadius: 4, background: '#f8fafc', cursor: 'pointer', fontSize: 12, lineHeight: 1 }}>▲</button>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', background: '#f1f5f9', borderRadius: 8, minWidth: 50, justifyContent: 'center' }}>
                <span style={{ fontSize: 18, fontWeight: 700, color: '#1e293b', fontFamily: 'monospace' }}>{coeffs[i]}</span>
                <span style={{ fontSize: 16, fontWeight: 600 }}>{comp.formula}</span>
              </div>
              <button onClick={() => updateCoeff(i, -1)} aria-label={`Decrease ${comp.formula} coefficient`} style={{ width: 24, height: 20, border: '1px solid #e2e8f0', borderRadius: 4, background: '#f8fafc', cursor: 'pointer', fontSize: 12, lineHeight: 1 }}>▼</button>
            </div>
          </div>
        ))}

        <span style={{ fontSize: 20, fontWeight: 700, color: '#64748B', margin: '0 8px' }}>→</span>

        {eq.products.map((comp, i) => {
          const globalIdx = eq.reactants.length + i;
          return (
            <div key={`p-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              {i > 0 && <span style={{ fontSize: 16, color: '#94A3B8', margin: '0 2px' }}>+</span>}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                <button onClick={() => updateCoeff(globalIdx, 1)} aria-label={`Increase ${comp.formula} coefficient`} style={{ width: 24, height: 20, border: '1px solid #e2e8f0', borderRadius: 4, background: '#f8fafc', cursor: 'pointer', fontSize: 12, lineHeight: 1 }}>▲</button>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', background: '#f1f5f9', borderRadius: 8, minWidth: 50, justifyContent: 'center' }}>
                  <span style={{ fontSize: 18, fontWeight: 700, color: '#1e293b', fontFamily: 'monospace' }}>{coeffs[globalIdx]}</span>
                  <span style={{ fontSize: 16, fontWeight: 600 }}>{comp.formula}</span>
                </div>
                <button onClick={() => updateCoeff(globalIdx, -1)} aria-label={`Decrease ${comp.formula} coefficient`} style={{ width: 24, height: 20, border: '1px solid #e2e8f0', borderRadius: 4, background: '#f8fafc', cursor: 'pointer', fontSize: 12, lineHeight: 1 }}>▼</button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Atom count comparison table */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
          {isHi ? 'परमाणु गणना' : 'Atom Count'}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${allSymbols.length}, 1fr)`, gap: 4 }}>
          {allSymbols.map(sym => {
            const left = leftAtoms[sym] || 0;
            const right = rightAtoms[sym] || 0;
            const match = left === right && left > 0;
            const color = ATOM_COLORS[sym] || '#6B7280';
            return (
              <div key={sym} style={{ textAlign: 'center', padding: '8px 4px', borderRadius: 8, border: `2px solid ${match ? '#22c55e' : '#fca5a5'}`, background: match ? '#f0fdf4' : '#fef2f2', transition: 'all 0.3s' }}>
                <div style={{ fontSize: 14, fontWeight: 700, color }}>{sym}</div>
                <div style={{ display: 'flex', justifyContent: 'center', gap: 4, marginTop: 4, fontSize: 13 }}>
                  <span style={{ fontWeight: 600, color: '#1e293b' }}>{left}</span>
                  <span style={{ color: match ? '#22c55e' : '#ef4444' }}>{match ? '=' : '≠'}</span>
                  <span style={{ fontWeight: 600, color: '#1e293b' }}>{right}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Status + actions */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {!solved && (
          <button onClick={checkAnswer} disabled={!balanced} aria-label={isHi ? 'उत्तर जाँचो' : 'Check answer'} style={{ flex: 1, padding: '10px 16px', borderRadius: 8, border: 'none', fontWeight: 600, fontSize: 14, cursor: balanced ? 'pointer' : 'default', background: balanced ? '#22c55e' : '#e2e8f0', color: balanced ? '#fff' : '#94A3B8' }}>
            {isHi ? (balanced ? '✓ जाँचो' : 'अभी संतुलित नहीं') : (balanced ? '✓ Check Answer' : 'Not balanced yet')}
          </button>
        )}
        {solved && (
          <button onClick={nextEquation} aria-label={isHi ? 'अगला समीकरण' : 'Next equation'} style={{ flex: 1, padding: '10px 16px', borderRadius: 8, border: 'none', fontWeight: 600, fontSize: 14, cursor: 'pointer', background: '#6366F1', color: '#fff' }}>
            {isHi ? '→ अगला समीकरण' : '→ Next Equation'}
          </button>
        )}
        <button onClick={() => setShowHint(!showHint)} aria-label={isHi ? 'संकेत दिखाओ' : 'Show hint'} style={{ padding: '10px 16px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', fontSize: 13, cursor: 'pointer', color: '#6366F1' }}>
          {isHi ? '💡 संकेत' : '💡 Hint'}
        </button>
      </div>

      {/* Hint */}
      {showHint && (
        <div style={{ padding: '10px 14px', background: '#eff6ff', borderRadius: 8, fontSize: 13, color: '#1e40af', marginBottom: 12 }}>
          {isHi ? eq.hintHi : eq.hint}
        </div>
      )}

      {/* Success message */}
      {solved && (
        <div style={{ padding: '12px 16px', background: '#f0fdf4', borderRadius: 8, border: '1px solid #bbf7d0', textAlign: 'center' }}>
          <div style={{ fontSize: 20, marginBottom: 4 }}>🎉</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#166534' }}>
            {isHi ? 'बिल्कुल सही! समीकरण संतुलित है।' : 'Correct! The equation is balanced.'}
          </div>
          <div style={{ fontSize: 12, color: '#15803d', marginTop: 4 }}>
            {isHi
              ? 'द्रव्यमान संरक्षण: अभिक्रिया में परमाणु न बनते हैं न नष्ट होते हैं।'
              : 'Law of Conservation of Mass: Atoms are neither created nor destroyed in a reaction.'}
          </div>
        </div>
      )}

      {/* Equation selector */}
      <div style={{ display: 'flex', gap: 4, marginTop: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
        {EQUATIONS.map((e, i) => (
          <button key={i} onClick={() => { setEqIdx(i); setCoeffs(Array(e.reactants.length + e.products.length).fill(1)); setShowHint(false); setSolved(false); }} aria-label={`Equation ${i + 1}: ${e.name}`} style={{ padding: '4px 10px', borderRadius: 6, border: `1px solid ${i === eqIdx ? '#6366F1' : '#e2e8f0'}`, background: i === eqIdx ? '#6366F1' : '#fff', color: i === eqIdx ? '#fff' : '#64748B', fontSize: 11, cursor: 'pointer' }}>
            {i + 1}
          </button>
        ))}
      </div>
    </div>
  );
}
