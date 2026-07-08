'use client';
import { useState, useEffect } from 'react';

export default function GalvanicCell() {
  const [resistance, setResistance] = useState(10);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 300);
    return () => clearInterval(id);
  }, []);

  const eCell = 1.10;
  const current = (eCell / resistance).toFixed(3);

  const znIonX = Array.from({ length: 4 }, (_, i) => ({
    x: 120 + ((tick * 12 + i * 40) % 80),
    y: 145 + (i % 2) * 20,
    opacity: ((tick + i * 2) % 8) / 8,
  }));

  const cuIonY = Array.from({ length: 4 }, (_, i) => ({
    x: 380 + (i % 2 - 0.5) * 20,
    y: 120 + ((tick * 10 + i * 35) % 70),
    opacity: ((tick + i * 3) % 7) / 7,
  }));

  const saltBridgeNa = Array.from({ length: 3 }, (_, i) => ({
    x: 240 + ((tick * 6 + i * 30) % 80),
    y: 100 + (i % 2) * 8,
  }));

  const saltBridgeSO4 = Array.from({ length: 3 }, (_, i) => ({
    x: 315 - ((tick * 6 + i * 30) % 80),
    y: 106 + (i % 2) * 8,
  }));

  return (
    <div style={{ background: 'var(--surface-1)', borderRadius: 12, padding: 16, maxWidth: 600, margin: '0 auto', fontFamily: 'inherit' }}>
      <h3 style={{ color: 'var(--text-1)', fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Galvanic Cell (Daniell Cell)</h3>
      <div style={{ marginBottom: 8 }}>
        <label style={{ fontSize: 12, color: 'var(--text-2)' }}>External resistance: {resistance} Ω → Current: {current} A</label>
        <input type="range" min={1} max={100} value={resistance} onChange={e => setResistance(+e.target.value)} style={{ width: '100%', marginTop: 4 }} />
      </div>
      <svg viewBox="0 0 560 290" style={{ width: '100%', borderRadius: 8, background: 'var(--surface-2)', display: 'block' }}>
        {/* Zn beaker */}
        <rect x={40} y={110} width={160} height={130} rx={8} fill="rgba(100,160,220,0.2)" stroke="#888" strokeWidth={2} />
        <rect x={42} y={170} width={156} height={68} rx={6} fill="rgba(100,160,220,0.4)" />
        <text x={120} y={240} textAnchor="middle" fontSize="11" fill="#4488cc">ZnSO₄ (aq)</text>
        {/* Zn electrode */}
        <rect x={110} y={115} width={14} height={100} rx={4} fill="#aaa" />
        <text x={117} y={108} textAnchor="middle" fontSize="11" fontWeight="700" fill="#888">Zn</text>
        <text x={117} y={255} textAnchor="middle" fontSize="10" fill="#ef4444">Anode (−)</text>
        <text x={117} y={267} textAnchor="middle" fontSize="10" fill="var(--text-2)">Oxidation</text>
        {/* Zn²⁺ ions leaving */}
        {znIonX.map((ion, i) => (
          <text key={i} x={ion.x} y={ion.y} fontSize="10" fill={`rgba(100,160,220,${ion.opacity})`}>Zn²⁺</text>
        ))}

        {/* Cu beaker */}
        <rect x={360} y={110} width={160} height={130} rx={8} fill="rgba(220,160,60,0.2)" stroke="#888" strokeWidth={2} />
        <rect x={362} y={170} width={156} height={68} rx={6} fill="rgba(220,160,60,0.3)" />
        <text x={440} y={240} textAnchor="middle" fontSize="11" fill="#b87333">CuSO₄ (aq)</text>
        {/* Cu electrode */}
        <rect x={430} y={115} width={14} height={100} rx={4} fill="#b87333" />
        <text x={437} y={108} textAnchor="middle" fontSize="11" fontWeight="700" fill="#b87333">Cu</text>
        <text x={437} y={255} textAnchor="middle" fontSize="10" fill="#16a34a">Cathode (+)</text>
        <text x={437} y={267} textAnchor="middle" fontSize="10" fill="var(--text-2)">Reduction</text>
        {/* Cu²⁺ depositing */}
        {cuIonY.map((ion, i) => (
          <text key={i} x={ion.x} y={ion.y + 130} fontSize="10" fill={`rgba(184,115,51,${1 - ion.opacity})`}>Cu²⁺</text>
        ))}

        {/* Salt bridge */}
        <rect x={220} y={85} width={120} height={30} rx={10} fill="rgba(200,200,200,0.5)" stroke="#888" strokeWidth={1.5} />
        <text x={280} y={103} textAnchor="middle" fontSize="11" fill="var(--text-2)">Salt Bridge</text>
        <line x1={220} y1={100} x2={200} y2={130} stroke="#888" strokeWidth={1.5} />
        <line x1={340} y1={100} x2={360} y2={130} stroke="#888" strokeWidth={1.5} />
        {saltBridgeNa.map((ion, i) => (
          <text key={i} x={ion.x} y={ion.y} fontSize="9" fill="rgba(100,100,200,0.8)">Na⁺→</text>
        ))}
        {saltBridgeSO4.map((ion, i) => (
          <text key={i} x={ion.x} y={ion.y} fontSize="9" fill="rgba(200,100,100,0.8)">←SO₄</text>
        ))}

        {/* External circuit with voltmeter */}
        <path d="M117,115 L117,50 L280,50 L443,50 L443,115" fill="none" stroke="#f97316" strokeWidth={2.5} />
        <circle cx={280} cy={50} r={20} fill="var(--surface-1)" stroke="#f97316" strokeWidth={2} />
        <text x={280} y={48} textAnchor="middle" fontSize="10" fontWeight="700" fill="var(--orange)">V</text>
        <text x={280} y={60} textAnchor="middle" fontSize="9" fill="var(--orange)">{eCell}V</text>
        {/* Electron flow arrow */}
        <text x={185} y={44} textAnchor="middle" fontSize="10" fill="var(--orange)">e⁻ →</text>
        <text x={375} y={44} textAnchor="middle" fontSize="10" fill="var(--orange)">→ e⁻</text>

        {/* E° values */}
        <text x={60} y={285} fontSize="10" fill="#888">Zn/Zn²⁺: E° = −0.76V</text>
        <text x={360} y={285} fontSize="10" fill="#888">Cu/Cu²⁺: E° = +0.34V</text>
      </svg>
      <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 8, fontSize: 13, color: 'var(--text-1)', textAlign: 'center' }}>
        <b style={{ color: 'var(--orange)' }}>E_cell = E°_cathode − E°_anode = 0.34 − (−0.76) = 1.10 V</b>
      </div>
    </div>
  );
}
