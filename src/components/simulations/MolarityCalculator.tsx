'use client';
import { useState } from 'react';

type CalcMode = 'Find Molarity' | 'Find Volume';

export default function MolarityCalculator() {
  const [mode, setMode] = useState<CalcMode>('Find Molarity');
  const [moles, setMoles] = useState(1);
  const [volume, setVolume] = useState(1);
  const [targetM, setTargetM] = useState(1);
  const [molarMass, setMolarMass] = useState(58.44);
  const [mass, setMass] = useState(58.44);
  const [useGrams, setUseGrams] = useState(false);

  const effectiveMoles = useGrams ? mass / molarMass : moles;
  const molarity = mode === 'Find Molarity' ? effectiveMoles / volume : targetM;
  const displayVolume = mode === 'Find Volume' ? (effectiveMoles / targetM).toFixed(3) : volume.toFixed(2);

  const concentration = Math.min(1, molarity / 5);
  const r = Math.round(100 + concentration * 100);
  const g = Math.round(160 - concentration * 120);
  const b = Math.round(220 - concentration * 150);
  const fillHeight = mode === 'Find Volume' ? Math.min(120, (effectiveMoles / targetM) * 60) : Math.min(120, volume * 60);

  return (
    <div style={{ background: 'var(--surface-1)', borderRadius: 12, padding: 16, maxWidth: 600, margin: '0 auto', fontFamily: 'inherit' }}>
      <h3 style={{ color: 'var(--text-1)', fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Molarity Calculator</h3>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {(['Find Molarity', 'Find Volume'] as CalcMode[]).map(m => (
          <button key={m} onClick={() => setMode(m)} style={{
            flex: 1, padding: '6px 10px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 13,
            background: mode === m ? 'var(--orange)' : 'var(--surface-2)', color: mode === m ? '#fff' : 'var(--text-1)',
          }}>{m}</button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ flex: 2, minWidth: 200 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-2)', marginBottom: 8 }}>
            <input type="checkbox" checked={useGrams} onChange={e => setUseGrams(e.target.checked)} />
            Use mass (grams) instead of moles
          </label>
          {useGrams ? (
            <>
              <label style={{ fontSize: 12, color: 'var(--text-2)' }}>Mass: {mass.toFixed(1)} g</label>
              <input type="range" min={1} max={500} step={0.1} value={mass} onChange={e => setMass(+e.target.value)} style={{ width: '100%' }} />
              <label style={{ fontSize: 12, color: 'var(--text-2)' }}>Molar Mass: {molarMass} g/mol</label>
              <input type="number" value={molarMass} onChange={e => setMolarMass(+e.target.value)} style={{ width: '100%', padding: '4px 8px', borderRadius: 4, border: '1px solid #ccc', fontSize: 12 }} />
            </>
          ) : (
            <>
              <label style={{ fontSize: 12, color: 'var(--text-2)' }}>Moles of solute: {effectiveMoles.toFixed(2)} mol</label>
              <input type="range" min={0.1} max={5} step={0.1} value={moles} onChange={e => setMoles(+e.target.value)} style={{ width: '100%' }} />
            </>
          )}
          {mode === 'Find Molarity' && (
            <>
              <label style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 8, display: 'block' }}>Volume: {volume.toFixed(2)} L</label>
              <input type="range" min={0.1} max={2} step={0.05} value={volume} onChange={e => setVolume(+e.target.value)} style={{ width: '100%' }} />
            </>
          )}
          {mode === 'Find Volume' && (
            <>
              <label style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 8, display: 'block' }}>Target Molarity: {targetM.toFixed(2)} M</label>
              <input type="range" min={0.1} max={5} step={0.1} value={targetM} onChange={e => setTargetM(+e.target.value)} style={{ width: '100%' }} />
            </>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 120, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <svg viewBox="0 0 100 160" style={{ width: 80, height: 130 }}>
            <path d="M20,10 L10,140 Q10,150 20,150 L80,150 Q90,150 90,140 L80,10 Z" fill={`rgba(${r},${g},${b},0.2)`} stroke="#888" strokeWidth={2} />
            <rect x={12} y={150 - fillHeight} width={76} height={fillHeight} fill={`rgba(${r},${g},${b},0.6)`} clipPath="url(#beakerClip)" />
            <clipPath id="beakerClip"><path d="M12,10 L12,150 L88,150 L88,10 Z" /></clipPath>
            <text x={50} y={85} textAnchor="middle" fontSize="10" fontWeight="700" fill="#333">{molarity.toFixed(2)}M</text>
          </svg>
          <div style={{ fontSize: 11, color: 'var(--text-2)' }}>Concentration</div>
        </div>
      </div>
      <div style={{ padding: '10px 12px', background: 'var(--surface-2)', borderRadius: 8, fontSize: 12, color: 'var(--text-1)', marginBottom: 8 }}>
        <div style={{ fontWeight: 700, color: 'var(--orange)', marginBottom: 4 }}>Step-by-step:</div>
        {useGrams && <div>Moles = {mass} g ÷ {molarMass} g/mol = <b>{effectiveMoles.toFixed(3)} mol</b></div>}
        {mode === 'Find Molarity' && <div>M = {effectiveMoles.toFixed(3)} mol ÷ {volume} L = <b style={{ color: 'var(--orange)' }}>{molarity.toFixed(3)} mol/L</b></div>}
        {mode === 'Find Volume' && <div>V = {effectiveMoles.toFixed(3)} mol ÷ {targetM} M = <b style={{ color: 'var(--orange)' }}>{displayVolume} L</b></div>}
      </div>
      <div style={{ padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 8, fontSize: 13, color: 'var(--text-1)', textAlign: 'center' }}>
        Formula: <b style={{ color: 'var(--orange)' }}>M = n / V (mol/L)</b>
      </div>
    </div>
  );
}
