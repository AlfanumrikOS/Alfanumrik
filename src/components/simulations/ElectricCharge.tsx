'use client';
import { useState } from 'react';

export default function ElectricCharge() {
  const [aPos, setAPos] = useState<'+' | '-'>('+');
  const [bPos, setBPos] = useState<'+' | '-'>('-');
  const [dist, setDist] = useState(150);

  const attract = aPos !== bPos;
  const k = 9e9, q = 1e-6;
  const rMeters = dist / 100;
  const F = ((k * q * q) / (rMeters * rMeters)).toFixed(3);
  const arrowLen = Math.min(80, 900 / (dist * dist / 100));

  const W = 400, H = 260;
  const cx = W / 2;
  const ax = cx - dist / 2, bx = cx + dist / 2;
  const cy = H / 2;

  const arrowColor = attract ? '#ef4444' : '#3b82f6';

  const chargeCircle = (x: number, sign: '+' | '-', label: string) => {
    const fill = sign === '+' ? '#ef4444' : '#3b82f6';
    return (
      <g key={label}>
        <circle cx={x} cy={cy} r={28} fill={fill} opacity={0.9} />
        <text x={x} y={cy + 5} textAnchor="middle" fill="#fff" fontWeight="bold" fontSize={22}>{sign}</text>
        <text x={x} y={cy + 48} textAnchor="middle" fill="var(--text-2)" fontSize={12}>{label}</text>
      </g>
    );
  };

  const forceArrow = (fromX: number, toX: number) => {
    const dx = toX - fromX;
    const mid = fromX + dx * 0.5;
    return (
      <g>
        <line x1={fromX + (dx > 0 ? 30 : -30)} y1={cy} x2={toX - (dx > 0 ? 30 : -30)} y2={cy} stroke={arrowColor} strokeWidth={3} markerEnd="url(#arrow)" />
      </g>
    );
  };

  const aArrowDest = attract ? bx - arrowLen - 28 : ax - arrowLen;
  const bArrowDest = attract ? ax + arrowLen + 28 : bx + arrowLen;

  return (
    <div style={{ background: 'var(--surface-1)', borderRadius: 12, padding: 16, maxWidth: 600, margin: '0 auto', fontFamily: 'inherit' }}>
      <h3 style={{ color: 'var(--text-1)', fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Electric Charges — Coulomb's Law</h3>

      <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        {(['+', '-'] as const).map(s => (
          <button key={`a${s}`} onClick={() => setAPos(s)} style={{ padding: '5px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12, background: aPos === s ? '#ef4444' : 'var(--surface-2)', color: aPos === s ? '#fff' : 'var(--text-1)' }}>{s}A</button>
        ))}
        {(['+', '-'] as const).map(s => (
          <button key={`b${s}`} onClick={() => setBPos(s)} style={{ padding: '5px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12, background: bPos === s ? '#ef4444' : 'var(--surface-2)', color: bPos === s ? '#fff' : 'var(--text-1)' }}>{s}B</button>
        ))}
        <span style={{ marginLeft: 8, fontSize: 12, color: attract ? '#ef4444' : '#3b82f6', fontWeight: 700, alignSelf: 'center' }}>
          {attract ? 'ATTRACT' : 'REPEL'}
        </span>
      </div>

      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ background: 'var(--surface-2)', borderRadius: 8, display: 'block' }}>
        <defs>
          <marker id="arrow" markerWidth="8" markerHeight="8" refX="4" refY="3" orient="auto">
            <path d="M0,0 L0,6 L8,3 z" fill={arrowColor} />
          </marker>
        </defs>
        {/* distance line */}
        <line x1={ax} y1={cy + 60} x2={bx} y2={cy + 60} stroke="#888" strokeWidth={1} strokeDasharray="4,3" />
        <text x={cx} y={cy + 75} textAnchor="middle" fill="var(--text-2)" fontSize={11}>{(rMeters).toFixed(2)} m</text>
        {/* force arrows */}
        {attract ? (
          <>
            <line x1={ax + 30} y1={cy - 5} x2={bx - 30} y2={cy - 5} stroke={arrowColor} strokeWidth={3} markerEnd="url(#arrow)" />
            <line x1={bx - 30} y1={cy + 5} x2={ax + 30} y2={cy + 5} stroke={arrowColor} strokeWidth={3} markerEnd="url(#arrow)" />
          </>
        ) : (
          <>
            <line x1={ax - 5} y1={cy - 5} x2={ax - 5 - arrowLen} y2={cy - 5} stroke={arrowColor} strokeWidth={3} markerEnd="url(#arrow)" />
            <line x1={bx + 5} y1={cy + 5} x2={bx + 5 + arrowLen} y2={cy + 5} stroke={arrowColor} strokeWidth={3} markerEnd="url(#arrow)" />
          </>
        )}
        {chargeCircle(ax, aPos, 'A')}
        {chargeCircle(bx, bPos, 'B')}
      </svg>

      <div style={{ marginTop: 10 }}>
        <label style={{ color: 'var(--text-2)', fontSize: 13 }}>Distance: {(rMeters).toFixed(2)} m</label>
        <input type="range" min={50} max={250} value={dist} onChange={e => setDist(+e.target.value)} style={{ width: '100%' }} />
      </div>
      <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 8, fontSize: 13, color: 'var(--text-1)', textAlign: 'center' }}>
        F = k·q₁·q₂ / r² = <b style={{ color: 'var(--orange)' }}>{F} N</b> &nbsp;(k=9×10⁹, q=1μC)
      </div>
    </div>
  );
}
