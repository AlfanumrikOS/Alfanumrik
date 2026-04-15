'use client';
import { useState, useEffect, useRef } from 'react';

type Mode = 'step-up' | 'step-down' | 'isolation';

export default function Transformer() {
  const [mode, setMode] = useState<Mode>('step-up');
  const [n1, setN1] = useState(50);
  const [v1, setV1] = useState(120);
  const [tick, setTick] = useState(0);
  const rafRef = useRef<number>(0);
  const lastRef = useRef<number>(0);

  const n2 = mode === 'step-up' ? n1 * 2 : mode === 'step-down' ? Math.round(n1 / 2) : n1;
  const v2 = +(v1 * n2 / n1).toFixed(1);
  const i1 = 1.0;
  const i2 = +(i1 * n1 / n2).toFixed(3);

  useEffect(() => {
    const loop = (ts: number) => {
      if (ts - lastRef.current > 40) {
        setTick(t => (t + 1) % 60);
        lastRef.current = ts;
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const fluxOffset = (tick / 60) * 40;
  const modeColor: Record<Mode, string> = { 'step-up': '#f97316', 'step-down': '#7c3aed', 'isolation': '#10b981' };
  const col = modeColor[mode];

  return (
    <div style={{ background: 'var(--surface-1)', borderRadius: 12, padding: 16, maxWidth: 600, margin: '0 auto', fontFamily: 'inherit' }}>
      <h3 style={{ color: 'var(--text-1)', fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Transformer</h3>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {(['step-up', 'step-down', 'isolation'] as Mode[]).map(m => (
          <button key={m} onClick={() => setMode(m)} style={{ padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, background: mode === m ? col : 'var(--surface-2)', color: mode === m ? '#fff' : 'var(--text-2)' }}>
            {m === 'step-up' ? 'Step-Up' : m === 'step-down' ? 'Step-Down' : 'Isolation'}
          </button>
        ))}
      </div>

      <svg viewBox="0 0 560 240" style={{ width: '100%', background: 'var(--surface-2)', borderRadius: 8, display: 'block' }}>
        {/* Iron core */}
        <rect x="200" y="40" width="160" height="160" rx="6" fill="#6b7280" opacity="0.5" />
        <rect x="220" y="60" width="120" height="120" rx="4" fill="var(--surface-2, #1e1e2e)" />

        {/* Animated flux arrows in core */}
        {[0, 1, 2].map(i => {
          const offset = ((fluxOffset + i * 13) % 40) - 20;
          return (
            <g key={i} opacity={0.7}>
              <line x1={260} y1={80 + offset} x2={300} y2={80 + offset} stroke={col} strokeWidth="2" markerEnd="url(#arr)" />
              <line x1={300} y1={140 + offset} x2={260} y2={140 + offset} stroke={col} strokeWidth="2" />
            </g>
          );
        })}
        <defs>
          <marker id="arr" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill={col} />
          </marker>
        </defs>

        {/* Primary coil (left) */}
        {Array.from({ length: 5 }).map((_, i) => (
          <ellipse key={i} cx={190} cy={80 + i * 20} rx={20} ry={8} fill="none" stroke="#facc15" strokeWidth="3" />
        ))}
        <line x1="170" y1="60" x2="100" y2="60" stroke="#facc15" strokeWidth="2" />
        <line x1="170" y1="160" x2="100" y2="160" stroke="#facc15" strokeWidth="2" />

        {/* Secondary coil (right) */}
        {Array.from({ length: mode === 'step-up' ? 8 : mode === 'step-down' ? 3 : 5 }).map((_, i) => (
          <ellipse key={i} cx={370} cy={75 + i * (mode === 'step-up' ? 12 : mode === 'step-down' ? 25 : 18)} rx={20} ry={8} fill="none" stroke={col} strokeWidth="3" />
        ))}
        <line x1="390" y1="60" x2="460" y2="60" stroke={col} strokeWidth="2" />
        <line x1="390" y1="180" x2="460" y2="180" stroke={col} strokeWidth="2" />

        {/* Battery symbol on primary */}
        <line x1="80" y1="60" x2="80" y2="160" stroke="#facc15" strokeWidth="2" />
        <line x1="70" y1="90" x2="90" y2="90" stroke="#facc15" strokeWidth="3" />
        <line x1="74" y1="105" x2="86" y2="105" stroke="#facc15" strokeWidth="2" />
        <text x="55" y="130" fill="#facc15" fontSize="10">V₁</text>

        {/* Labels */}
        <text x="170" y="30" textAnchor="middle" fill="var(--text-1,#fff)" fontSize="13" fontWeight="bold">Primary</text>
        <text x="170" y="47" textAnchor="middle" fill="var(--text-2,#aaa)" fontSize="11">N₁ = {n1}</text>
        <text x="370" y="30" textAnchor="middle" fill="var(--text-1,#fff)" fontSize="13" fontWeight="bold">Secondary</text>
        <text x="370" y="47" textAnchor="middle" fill="var(--text-2,#aaa)" fontSize="11">N₂ = {n2}</text>

        {/* Voltage labels */}
        <text x="100" y="200" textAnchor="middle" fill="#facc15" fontSize="12">V₁ = {v1}V</text>
        <text x="460" y="200" textAnchor="middle" fill={col} fontSize="12">V₂ = {v2}V</text>
        <text x="100" y="218" textAnchor="middle" fill="#facc15" fontSize="11">I₁ = {i1}A</text>
        <text x="460" y="218" textAnchor="middle" fill={col} fontSize="11">I₂ = {i2}A</text>
      </svg>

      <div style={{ marginTop: 10, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1 }}>
          <label style={{ color: 'var(--text-2)', fontSize: 13 }}>N₁: {n1} turns</label>
          <input type="range" min={10} max={200} value={n1} onChange={e => setN1(+e.target.value)} style={{ width: '100%' }} />
        </div>
        <div style={{ flex: 1 }}>
          <label style={{ color: 'var(--text-2)', fontSize: 13 }}>V₁: {v1}V</label>
          <input type="range" min={100} max={240} value={v1} onChange={e => setV1(+e.target.value)} style={{ width: '100%' }} />
        </div>
      </div>
      <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 8, fontSize: 13, color: 'var(--text-1)', textAlign: 'center' }}>
        V₁/V₂ = N₁/N₂ = I₂/I₁ &nbsp;→&nbsp; <b style={{ color: col }}>{v1}/{v2} = {n1}/{n2}</b>
      </div>
    </div>
  );
}
