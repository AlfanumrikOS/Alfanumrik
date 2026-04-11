'use client';
import { useState } from 'react';

const ELEMENTS = [
  { symbol: 'H', name: 'Hydrogen', z: 1, correct: 'Non-Metal' },
  { symbol: 'He', name: 'Helium', z: 2, correct: 'Non-Metal' },
  { symbol: 'Li', name: 'Lithium', z: 3, correct: 'Metal' },
  { symbol: 'C', name: 'Carbon', z: 6, correct: 'Non-Metal' },
  { symbol: 'Na', name: 'Sodium', z: 11, correct: 'Metal' },
  { symbol: 'Mg', name: 'Magnesium', z: 12, correct: 'Metal' },
  { symbol: 'Al', name: 'Aluminium', z: 13, correct: 'Metalloid' },
  { symbol: 'S', name: 'Sulfur', z: 16, correct: 'Non-Metal' },
  { symbol: 'Cl', name: 'Chlorine', z: 17, correct: 'Non-Metal' },
  { symbol: 'Ar', name: 'Argon', z: 18, correct: 'Non-Metal' },
  { symbol: 'Fe', name: 'Iron', z: 26, correct: 'Metal' },
  { symbol: 'Cu', name: 'Copper', z: 29, correct: 'Metal' },
];

const ZONES = ['Metal', 'Non-Metal', 'Metalloid'] as const;
type Zone = typeof ZONES[number];

export default function ElementClassifier() {
  const [placed, setPlaced] = useState<Record<string, Zone>>({});

  const cycleZone = (symbol: string) => {
    setPlaced(prev => {
      const current = prev[symbol];
      if (!current) return { ...prev, [symbol]: 'Metal' };
      const idx = ZONES.indexOf(current);
      if (idx === ZONES.length - 1) {
        const next = { ...prev };
        delete next[symbol];
        return next;
      }
      return { ...prev, [symbol]: ZONES[idx + 1] };
    });
  };

  const score = ELEMENTS.filter(e => placed[e.symbol] === e.correct).length;
  const total = Object.keys(placed).length;

  const zoneColors: Record<Zone, string> = {
    Metal: 'var(--orange)',
    'Non-Metal': 'var(--purple)',
    Metalloid: '#16a34a',
  };

  return (
    <div style={{ background: 'var(--surface-1)', borderRadius: 12, padding: 16, maxWidth: 600, margin: '0 auto', fontFamily: 'inherit' }}>
      <h3 style={{ color: 'var(--text-1)', fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Element Classifier</h3>
      <p style={{ color: 'var(--text-2)', fontSize: 12, marginBottom: 12 }}>Click each element to cycle through Metal / Non-Metal / Metalloid</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        {ELEMENTS.map(el => {
          const zone = placed[el.symbol];
          const isCorrect = zone && zone === el.correct;
          const isWrong = zone && zone !== el.correct;
          return (
            <button key={el.symbol} onClick={() => cycleZone(el.symbol)} style={{
              border: `2px solid ${zone ? zoneColors[zone] : 'var(--text-2)'}`,
              borderRadius: 8, padding: '6px 10px', background: zone ? `${zoneColors[zone]}22` : 'var(--surface-2)',
              cursor: 'pointer', minWidth: 72, textAlign: 'center',
            }}>
              <div style={{ fontWeight: 700, fontSize: 15, color: zone ? zoneColors[zone] : 'var(--text-1)' }}>{el.symbol}</div>
              <div style={{ fontSize: 10, color: 'var(--text-2)' }}>Z={el.z}</div>
              {zone && <div style={{ fontSize: 10, color: zoneColors[zone] }}>{zone}</div>}
              {zone && <span style={{ fontSize: 14 }}>{isCorrect ? '✓' : isWrong ? '✗' : ''}</span>}
            </button>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {ZONES.map(z => (
          <div key={z} style={{ flex: 1, minWidth: 100, border: `2px dashed ${zoneColors[z]}`, borderRadius: 8, padding: 8, background: `${zoneColors[z]}11` }}>
            <div style={{ fontWeight: 700, fontSize: 12, color: zoneColors[z], marginBottom: 4 }}>{z}</div>
            <div style={{ fontSize: 11, color: 'var(--text-2)' }}>
              {ELEMENTS.filter(e => placed[e.symbol] === z).map(e => e.symbol).join(', ') || 'None placed'}
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 13, color: 'var(--text-1)', fontWeight: 700 }}>Score: {score}/{total} correct</span>
        <button onClick={() => setPlaced({})} style={{ fontSize: 12, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--text-2)', background: 'var(--surface-2)', cursor: 'pointer', color: 'var(--text-1)' }}>Reset</button>
      </div>
      <div style={{ padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 8, fontSize: 12, color: 'var(--text-1)' }}>
        <b style={{ color: 'var(--orange)' }}>Metals:</b> left of staircase &nbsp;|&nbsp;
        <b style={{ color: 'var(--purple)' }}>Non-metals:</b> right &nbsp;|&nbsp;
        <b style={{ color: '#16a34a' }}>Metalloids:</b> along staircase
      </div>
    </div>
  );
}
