'use client';
import { useState } from 'react';

type Shape = 'Linear' | 'Bent' | 'Trigonal Planar' | 'Tetrahedral' | 'Trigonal Bipyramidal';

const SHAPES: Record<Shape, {
  example: string; angle: string; formula: string;
  bondPairs: number; lonePairs: number; description: string;
}> = {
  Linear: { example: 'CO₂', angle: '180°', formula: 'O=C=O', bondPairs: 2, lonePairs: 0, description: '2 bond pairs, 0 lone pairs' },
  Bent: { example: 'H₂O', angle: '104.5°', formula: 'H-O-H', bondPairs: 2, lonePairs: 2, description: '2 bond pairs, 2 lone pairs' },
  'Trigonal Planar': { example: 'BF₃', angle: '120°', formula: 'BF₃', bondPairs: 3, lonePairs: 0, description: '3 bond pairs, 0 lone pairs' },
  Tetrahedral: { example: 'CH₄', angle: '109.5°', formula: 'CH₄', bondPairs: 4, lonePairs: 0, description: '4 bond pairs, 0 lone pairs' },
  'Trigonal Bipyramidal': { example: 'PCl₅', angle: '90°/120°', formula: 'PCl₅', bondPairs: 5, lonePairs: 0, description: '5 bond pairs, 0 lone pairs' },
};

function ShapeDiagram({ shape }: { shape: Shape }) {
  const cx = 130, cy = 100;
  const R = 65;

  if (shape === 'Linear') {
    return (
      <g>
        <circle cx={cx} cy={cy} r={14} fill="var(--orange)" />
        <text x={cx} y={cy + 4} textAnchor="middle" fontSize="11" fontWeight="700" fill="#fff">C</text>
        {[-1, 1].map((d, i) => (
          <g key={i}>
            <line x1={cx + d * 18} y1={cy} x2={cx + d * 68} y2={cy} stroke="#888" strokeWidth={4} />
            <line x1={cx + d * 18} y1={cy - 4} x2={cx + d * 68} y2={cy - 4} stroke="#888" strokeWidth={2} />
            <circle cx={cx + d * 75} cy={cy} r={12} fill="#ef4444" />
            <text x={cx + d * 75} y={cy + 4} textAnchor="middle" fontSize="10" fill="#fff">O</text>
          </g>
        ))}
        <text x={cx} y={cy + 40} textAnchor="middle" fontSize="11" fill="var(--text-2)">180°</text>
      </g>
    );
  }
  if (shape === 'Bent') {
    const angle = 104.5 * Math.PI / 180;
    const half = angle / 2;
    return (
      <g>
        <circle cx={cx} cy={cy} r={14} fill="#3b82f6" />
        <text x={cx} y={cy + 4} textAnchor="middle" fontSize="11" fontWeight="700" fill="#fff">O</text>
        {[[-half, 'H'], [half, 'H']].map(([a, label], i) => {
          const bx = cx + Math.sin(a as number) * R;
          const by = cy + Math.cos(a as number) * R;
          return (
            <g key={i}>
              <line x1={cx} y1={cy} x2={bx} y2={by} stroke="#888" strokeWidth={3} />
              <circle cx={bx} cy={by} r={11} fill="#888" />
              <text x={bx} y={by + 4} textAnchor="middle" fontSize="10" fill="#fff">{label as string}</text>
            </g>
          );
        })}
        {/* Lone pairs */}
        {[[-0.4, -1], [0.4, -1]].map(([dx, dy], i) => (
          <ellipse key={i} cx={cx + (dx as number) * 22} cy={cy + (dy as number) * 18} rx={10} ry={6}
            fill="rgba(59,130,246,0.3)" stroke="#3b82f6" strokeWidth={1} strokeDasharray="2 1" />
        ))}
        <text x={cx} y={cy + 55} textAnchor="middle" fontSize="11" fill="var(--text-2)">104.5°</text>
      </g>
    );
  }
  if (shape === 'Trigonal Planar') {
    return (
      <g>
        <circle cx={cx} cy={cy} r={14} fill="var(--purple)" />
        <text x={cx} y={cy + 4} textAnchor="middle" fontSize="11" fontWeight="700" fill="#fff">B</text>
        {[0, 120, 240].map((a, i) => {
          const rad = (a - 90) * Math.PI / 180;
          const bx = cx + Math.cos(rad) * R, by = cy + Math.sin(rad) * R;
          return (
            <g key={i}>
              <line x1={cx} y1={cy} x2={bx} y2={by} stroke="#888" strokeWidth={3} />
              <circle cx={bx} cy={by} r={11} fill="#16a34a" />
              <text x={bx} y={by + 4} textAnchor="middle" fontSize="10" fill="#fff">F</text>
            </g>
          );
        })}
        <text x={cx} y={cy + 70} textAnchor="middle" fontSize="11" fill="var(--text-2)">120°</text>
      </g>
    );
  }
  if (shape === 'Tetrahedral') {
    const positions = [[-55, -45], [55, -45], [-40, 40], [40, 40]];
    const wedge = [false, false, true, true];
    return (
      <g>
        <circle cx={cx} cy={cy} r={14} fill="var(--orange)" />
        <text x={cx} y={cy + 4} textAnchor="middle" fontSize="11" fontWeight="700" fill="#fff">C</text>
        {positions.map(([dx, dy], i) => {
          const bx = cx + dx, by = cy + dy;
          return (
            <g key={i}>
              {wedge[i]
                ? <polygon points={`${cx},${cy - 4} ${cx},${cy + 4} ${bx},${by}`} fill={`rgba(100,100,200,0.5)`} stroke="#888" strokeWidth={1} />
                : <line x1={cx} y1={cy} x2={bx} y2={by} stroke={dy < 0 ? '#888' : '#888'} strokeWidth={dy < 0 ? 1.5 : 3} strokeDasharray={dy < 0 ? '' : ''} />
              }
              <circle cx={bx} cy={by} r={11} fill="#6b7280" />
              <text x={bx} y={by + 4} textAnchor="middle" fontSize="10" fill="#fff">H</text>
            </g>
          );
        })}
        <text x={cx} y={cy + 70} textAnchor="middle" fontSize="11" fill="var(--text-2)">109.5°</text>
      </g>
    );
  }
  // Trigonal Bipyramidal
  return (
    <g>
      <circle cx={cx} cy={cy} r={14} fill="var(--purple)" />
      <text x={cx} y={cy + 4} textAnchor="middle" fontSize="11" fontWeight="700" fill="#fff">P</text>
      {/* Axial */}
      {[[-1, 55], [1, 55]].map(([d, dist], i) => (
        <g key={i}>
          <line x1={cx} y1={cy} x2={cx} y2={cy + (d as number) * (dist as number)} stroke="#888" strokeWidth={3} />
          <circle cx={cx} cy={cy + (d as number) * (dist as number)} r={11} fill="#f59e0b" />
          <text x={cx} y={cy + (d as number) * (dist as number) + 4} textAnchor="middle" fontSize="10" fill="#fff">Cl</text>
        </g>
      ))}
      {/* Equatorial */}
      {[0, 120, 240].map((a, i) => {
        const rad = (a - 90) * Math.PI / 180;
        const bx = cx + Math.cos(rad) * 58, by = cy + Math.sin(rad) * 58;
        return (
          <g key={i}>
            <line x1={cx} y1={cy} x2={bx} y2={by} stroke="#888" strokeWidth={3} />
            <circle cx={bx} cy={by} r={11} fill="#f59e0b" />
            <text x={bx} y={by + 4} textAnchor="middle" fontSize="10" fill="#fff">Cl</text>
          </g>
        );
      })}
      <text x={cx} y={cy + 80} textAnchor="middle" fontSize="11" fill="var(--text-2)">90°/120°</text>
    </g>
  );
}

export default function MolecularGeometry() {
  const [shape, setShape] = useState<Shape>('Tetrahedral');
  const info = SHAPES[shape];

  return (
    <div style={{ background: 'var(--surface-1)', borderRadius: 12, padding: 16, maxWidth: 600, margin: '0 auto', fontFamily: 'inherit' }}>
      <h3 style={{ color: 'var(--text-1)', fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Molecular Geometry (VSEPR)</h3>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {(Object.keys(SHAPES) as Shape[]).map(s => (
          <button key={s} onClick={() => setShape(s)} style={{
            padding: '5px 10px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
            background: shape === s ? 'var(--orange)' : 'var(--surface-2)', color: shape === s ? '#fff' : 'var(--text-1)',
          }}>{s}</button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <svg viewBox="0 0 260 200" style={{ flex: '0 0 180px', borderRadius: 8, background: 'var(--surface-2)' }}>
          <ShapeDiagram shape={shape} />
        </svg>
        <div style={{ flex: 1, minWidth: 140 }}>
          <div style={{ padding: '10px 12px', background: 'var(--surface-2)', borderRadius: 8, fontSize: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--orange)', marginBottom: 6 }}>{shape}</div>
            <div style={{ color: 'var(--text-1)', marginBottom: 3 }}>Example: <b>{info.example}</b></div>
            <div style={{ color: 'var(--text-1)', marginBottom: 3 }}>Formula: <b style={{ color: 'var(--purple)' }}>{info.formula}</b></div>
            <div style={{ color: 'var(--text-1)', marginBottom: 3 }}>Bond angle: <b style={{ color: '#16a34a' }}>{info.angle}</b></div>
            <div style={{ color: 'var(--text-2)', marginBottom: 3 }}>{info.description}</div>
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <span style={{ padding: '2px 8px', borderRadius: 12, background: 'rgba(249,115,22,0.15)', fontSize: 11, color: 'var(--orange)' }}>
                Bond: {info.bondPairs}
              </span>
              <span style={{ padding: '2px 8px', borderRadius: 12, background: 'rgba(124,58,237,0.15)', fontSize: 11, color: 'var(--purple)' }}>
                Lone: {info.lonePairs}
              </span>
            </div>
          </div>
        </div>
      </div>
      <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 8, fontSize: 12, color: 'var(--text-1)', textAlign: 'center' }}>
        <b style={{ color: 'var(--orange)' }}>VSEPR:</b> electron pairs repel → minimise repulsion → determine shape
      </div>
    </div>
  );
}
