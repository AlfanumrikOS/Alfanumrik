'use client';
import { useState, useEffect } from 'react';

export default function WaterElectrolysis() {
  const [voltage, setVoltage] = useState(6);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (voltage < 2) return;
    const id = setInterval(() => setTick(t => t + 1), Math.max(50, 300 - voltage * 20));
    return () => clearInterval(id);
  }, [voltage]);

  const active = voltage >= 2;
  const h2Vol = Math.min(100, active ? (tick * voltage * 0.6) % 100 : 0);
  const o2Vol = Math.min(50, active ? (tick * voltage * 0.3) % 50 : 0);

  const h2Bubbles = active ? Array.from({ length: 5 }, (_, i) => ({
    x: 165 + (i % 2) * 10,
    y: 200 - ((tick * 8 + i * 20) % 100),
    r: 3,
  })) : [];

  const o2Bubbles = active ? Array.from({ length: 3 }, (_, i) => ({
    x: 385 + (i % 2) * 8,
    y: 200 - ((tick * 5 + i * 25) % 100),
    r: 4,
  })) : [];

  return (
    <div style={{ background: 'var(--surface-1)', borderRadius: 12, padding: 16, maxWidth: 600, margin: '0 auto', fontFamily: 'inherit' }}>
      <h3 style={{ color: 'var(--text-1)', fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Water Electrolysis</h3>
      <div style={{ marginBottom: 8 }}>
        <label style={{ fontSize: 12, color: 'var(--text-2)' }}>Voltage: {voltage}V {voltage < 2 ? '(min 2V needed)' : ''}</label>
        <input type="range" min={1} max={12} value={voltage} onChange={e => setVoltage(+e.target.value)} style={{ width: '100%', marginTop: 4 }} />
      </div>
      <svg viewBox="0 0 560 300" style={{ width: '100%', borderRadius: 8, background: 'var(--surface-2)', display: 'block' }}>
        {/* U-tube */}
        <path d="M120,60 L120,240 Q120,260 140,260 L420,260 Q440,260 440,240 L440,60" fill="none" stroke="#888" strokeWidth={3} />
        {/* Water fill */}
        <clipPath id="utube">
          <path d="M123,63 L123,240 Q123,257 140,257 L420,257 Q437,257 437,240 L437,63 Z" />
        </clipPath>
        <rect x="120" y="140" width="323" height="120" fill="rgba(100,160,220,0.4)" clipPath="url(#utube)" />
        {/* Cathode (left) */}
        <rect x="155" y="100" width="10" height="130" rx="4" fill="#888" />
        <text x="160" y="95" textAnchor="middle" fontSize="11" fill="#4488cc">Cathode (−)</text>
        {/* Anode (right) */}
        <rect x="390" y="100" width="10" height="130" rx="4" fill="#888" />
        <text x="395" y="95" textAnchor="middle" fontSize="11" fill="#cc4444">Anode (+)</text>
        {/* H2 collection tube */}
        <rect x="130" y="55" width="50" height="90" rx="4" fill="rgba(180,220,255,0.5)" stroke="#4488cc" strokeWidth={2} />
        <rect x="131" y="56" width="48" height={90 - h2Vol * 0.88} rx="3" fill="rgba(200,240,255,0.9)" />
        <text x="155" y="50" textAnchor="middle" fontSize="11" fontWeight="700" fill="#4488cc">H₂ {h2Vol.toFixed(0)}%</text>
        {/* O2 collection tube */}
        <rect x="375" y="55" width="50" height="90" rx="4" fill="rgba(255,200,180,0.5)" stroke="#cc4444" strokeWidth={2} />
        <rect x="376" y="56" width="48" height={90 - o2Vol * 1.76} rx="3" fill="rgba(255,220,200,0.9)" />
        <text x="400" y="50" textAnchor="middle" fontSize="11" fontWeight="700" fill="#cc4444">O₂ {o2Vol.toFixed(0)}%</text>
        {/* Bubbles */}
        {h2Bubbles.map((b, i) => <circle key={i} cx={b.x} cy={b.y + 90} r={b.r} fill="rgba(200,240,255,0.8)" />)}
        {o2Bubbles.map((b, i) => <circle key={i} cx={b.x} cy={b.y + 90} r={b.r} fill="rgba(255,200,180,0.8)" />)}
        {/* Power supply */}
        <rect x="225" y="20" width="110" height="40" rx="6" fill="var(--surface-1)" stroke={active ? 'var(--orange)' : '#888'} strokeWidth={2} />
        <text x="280" y="38" textAnchor="middle" fontSize="12" fontWeight="700" fill={active ? 'var(--orange)' : 'var(--text-2)'}>{voltage}V ⚡</text>
        <line x1="225" y1="40" x2="165" y2="100" stroke="#4488cc" strokeWidth={2} />
        <line x1="335" y1="40" x2="395" y2="100" stroke="#cc4444" strokeWidth={2} />
        <text x="280" y="285" textAnchor="middle" fontSize="10" fill="var(--text-2)">H₂ : O₂ = 2 : 1 (by volume)</text>
      </svg>
      <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 8, fontSize: 13, color: 'var(--text-1)', textAlign: 'center' }}>
        Formula: <b style={{ color: 'var(--orange)' }}>2H₂O → 2H₂ + O₂</b>
      </div>
    </div>
  );
}
