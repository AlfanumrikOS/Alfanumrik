'use client';
import { useState } from 'react';

export default function FreeBodyDiagram() {
  const [mass, setMass] = useState(5);
  const [applied, setApplied] = useState(40);
  const [mu, setMu] = useState(0.3);

  const g = 10;
  const W = mass * g;
  const N = W;
  const friction = mu * N;
  const netForce = Math.max(0, applied - friction);
  const acc = netForce / mass;
  const isEquilibrium = netForce < 0.5;

  const scale = 1.2;
  const cx = 280, cy = 160;
  const boxW = 70, boxH = 50;

  const arrow = (x1: number, y1: number, x2: number, y2: number, color: string, label: string, labelSide: 'top' | 'bottom' | 'left' | 'right') => {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 2) return null;
    const ux = dx / len, uy = dy / len;
    const headSize = 8;
    const lx = labelSide === 'right' ? x2 + 10 : labelSide === 'left' ? x2 - 10 : x2;
    const ly = labelSide === 'top' ? y2 - 10 : labelSide === 'bottom' ? y2 + 16 : y2 + 4;
    return (
      <g key={label}>
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth="3" />
        <polygon
          points={`${x2},${y2} ${x2 - ux * headSize + uy * headSize * 0.5},${y2 - uy * headSize - ux * headSize * 0.5} ${x2 - ux * headSize - uy * headSize * 0.5},${y2 - uy * headSize + ux * headSize * 0.5}`}
          fill={color}
        />
        <text x={lx} y={ly} fill={color} fontSize="12" fontWeight="bold" textAnchor={labelSide === 'right' ? 'start' : labelSide === 'left' ? 'end' : 'middle'}>{label}</text>
      </g>
    );
  };

  const wLen = Math.min(100, W * scale);
  const nLen = Math.min(100, N * scale);
  const aLen = Math.min(120, applied * 1.0);
  const fLen = Math.min(80, friction * 1.0);

  return (
    <div style={{ background: 'var(--surface-1)', borderRadius: 12, padding: 16, maxWidth: 600, margin: '0 auto', fontFamily: 'inherit' }}>
      <h3 style={{ color: 'var(--text-1)', fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Free Body Diagram</h3>

      <svg viewBox="0 0 560 280" style={{ width: '100%', background: 'var(--surface-2)', borderRadius: 8, display: 'block' }}>
        {/* Ground */}
        <line x1="60" y1="190" x2="500" y2="190" stroke="#6b7280" strokeWidth="2" />
        {[...Array(12)].map((_, i) => (
          <line key={i} x1={70 + i * 36} y1="190" x2={60 + i * 36} y2="205" stroke="#6b7280" strokeWidth="1" />
        ))}

        {/* Box */}
        <rect x={cx - boxW / 2} y={cy - boxH / 2} width={boxW} height={boxH} fill="#374151" stroke="#9ca3af" strokeWidth="2" rx="4" />
        <text x={cx} y={cy + 6} textAnchor="middle" fill="#d1d5db" fontSize="13" fontWeight="bold">{mass}kg</text>

        {/* Weight (down) */}
        {arrow(cx, cy + boxH / 2, cx, cy + boxH / 2 + wLen, '#f97316', `W=${W}N`, 'bottom')}
        {/* Normal (up) */}
        {arrow(cx, cy - boxH / 2, cx, cy - boxH / 2 - nLen, '#10b981', `N=${N}N`, 'top')}
        {/* Applied force (right) */}
        {applied > 0 && arrow(cx + boxW / 2, cy, cx + boxW / 2 + aLen, cy, '#7c3aed', `F=${applied}N`, 'right')}
        {/* Friction (left) */}
        {friction > 0 && arrow(cx - boxW / 2, cy, cx - boxW / 2 - fLen, cy, '#ef4444', `f=${friction.toFixed(1)}N`, 'left')}

        {/* Equilibrium badge */}
        {isEquilibrium && (
          <g>
            <rect x="200" y="8" width="160" height="28" rx="8" fill="#10b981" opacity="0.9" />
            <text x="280" y="27" textAnchor="middle" fill="#fff" fontSize="13" fontWeight="bold">Equilibrium</text>
          </g>
        )}

        {/* Net info */}
        <text x="280" y="270" textAnchor="middle" fill="#9ca3af" fontSize="12">
          Net F = {netForce.toFixed(1)}N &nbsp;|&nbsp; a = {acc.toFixed(2)} m/s²
        </text>
      </svg>

      <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
        <div>
          <label style={{ color: 'var(--text-2)', fontSize: 13 }}>Mass: {mass} kg</label>
          <input type="range" min={1} max={20} value={mass} onChange={e => setMass(+e.target.value)} style={{ width: '100%' }} />
        </div>
        <div>
          <label style={{ color: 'var(--text-2)', fontSize: 13 }}>Applied F: {applied} N</label>
          <input type="range" min={0} max={100} value={applied} onChange={e => setApplied(+e.target.value)} style={{ width: '100%' }} />
        </div>
        <div>
          <label style={{ color: 'var(--text-2)', fontSize: 13 }}>μ: {mu.toFixed(2)}</label>
          <input type="range" min={0} max={1} step={0.05} value={mu} onChange={e => setMu(+e.target.value)} style={{ width: '100%' }} />
        </div>
      </div>
      <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 8, fontSize: 13, color: 'var(--text-1)', textAlign: 'center' }}>
        F_net = ma = <b style={{ color: 'var(--orange,#f97316)' }}>{netForce.toFixed(1)} N</b> &nbsp;|&nbsp; f = μN = <b style={{ color: 'var(--purple,#7c3aed)' }}>{friction.toFixed(1)} N</b>
      </div>
    </div>
  );
}
