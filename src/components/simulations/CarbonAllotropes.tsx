'use client';
import { useState } from 'react';

type Allotrope = 'Diamond' | 'Graphite' | 'Fullerene';

const PROPS: Record<Allotrope, { hardness: string; conductivity: string; structure: string; use: string; color: string }> = {
  Diamond:   { hardness: 'Hardest natural substance', conductivity: 'Electrical insulator', structure: '3D tetrahedral lattice', use: 'Cutting tools, jewellery', color: '#a5f3fc' },
  Graphite:  { hardness: 'Soft, slippery layers', conductivity: 'Good electrical conductor', structure: 'Layered hexagonal sheets', use: 'Pencils, electrodes, lubricant', color: '#6b7280' },
  Fullerene: { hardness: 'Cage-like, relatively soft', conductivity: 'Semiconductor', structure: 'C₆₀ sphere (pentagons & hexagons)', use: 'Drug delivery, nanotechnology', color: '#fbbf24' },
};

export default function CarbonAllotropes() {
  const [selected, setSelected] = useState<Allotrope>('Diamond');
  const p = PROPS[selected];

  return (
    <div style={{ background: 'var(--surface-1)', borderRadius: 12, padding: 16, maxWidth: 600, margin: '0 auto', fontFamily: 'inherit' }}>
      <h3 style={{ color: 'var(--text-1)', fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Carbon Allotropes</h3>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {(['Diamond', 'Graphite', 'Fullerene'] as Allotrope[]).map(a => (
          <button key={a} onClick={() => setSelected(a)} style={{
            flex: 1, padding: '6px 10px', borderRadius: 8, border: `2px solid ${selected === a ? PROPS[a].color : 'transparent'}`,
            background: selected === a ? `${PROPS[a].color}22` : 'var(--surface-2)',
            cursor: 'pointer', fontWeight: 600, fontSize: 13, color: 'var(--text-1)',
          }}>{a}</button>
        ))}
      </div>
      <svg viewBox="0 0 560 200" style={{ width: '100%', borderRadius: 8, background: 'var(--surface-2)', display: 'block', marginBottom: 10 }}>
        {selected === 'Diamond' && (
          <g transform="translate(140,20)">
            {/* Tetrahedral structure projection */}
            {[
              [140,80], [100,40], [180,40], [100,120], [180,120],
              [60,80], [220,80], [140,10], [140,150],
            ].map(([x,y], i) => (
              <circle key={i} cx={x} cy={y} r={8} fill={p.color} stroke="#fff" strokeWidth={1.5} />
            ))}
            {[
              [[140,80],[100,40]], [[140,80],[180,40]], [[140,80],[100,120]], [[140,80],[180,120]],
              [[100,40],[60,80]], [[180,40],[220,80]], [[100,120],[60,80]], [[180,120],[220,80]],
              [[100,40],[140,10]], [[180,40],[140,10]], [[100,120],[140,150]], [[180,120],[140,150]],
            ].map(([[x1,y1],[x2,y2]], i) => (
              <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={p.color} strokeWidth={2} opacity={0.6} />
            ))}
            <text x={140} y={190} textAnchor="middle" fontSize="12" fill={p.color}>Tetrahedral — all sp³ bonds</text>
          </g>
        )}
        {selected === 'Graphite' && (
          <g transform="translate(80,20)">
            {[0, 1, 2].map(layer => {
              const ly = layer * 45;
              const hexes = [[100,60+ly],[160,60+ly],[220,60+ly],[130,100+ly],[190,100+ly],[100,140+ly]];
              return hexes.map(([hx,hy], i) => {
                const pts = Array.from({length:6},(_,k)=>`${hx+20*Math.cos(k*60*Math.PI/180)},${hy+20*Math.sin(k*60*Math.PI/180)}`).join(' ');
                return <polygon key={`${layer}-${i}`} points={pts} fill="none" stroke={`rgba(107,114,128,${1-layer*0.25})`} strokeWidth={1.5} />;
              });
            })}
            {[100,160,220].map((x,i) => (
              <line key={i} x1={x} y1={60} x2={x} y2={145} stroke="rgba(107,114,128,0.3)" strokeWidth={1} strokeDasharray="3 2" />
            ))}
            <text x={160} y={185} textAnchor="middle" fontSize="12" fill={p.color}>Layered hexagonal sheets — delocalized e⁻</text>
          </g>
        )}
        {selected === 'Fullerene' && (
          <g transform="translate(160,10)">
            {/* C60 simplified as sphere with pentagons and hexagons */}
            <circle cx={120} cy={95} r={80} fill={`${p.color}22`} stroke={p.color} strokeWidth={2} />
            {[0,60,120,180,240,300].map((a,i) => {
              const rad = a * Math.PI / 180;
              const px = 120 + 55*Math.cos(rad), py = 95 + 55*Math.sin(rad);
              const pts = Array.from({length:5},(_,k)=>`${px+14*Math.cos((k*72+a)*Math.PI/180)},${py+14*Math.sin((k*72+a)*Math.PI/180)}`).join(' ');
              return <polygon key={i} points={pts} fill={`${p.color}44`} stroke={p.color} strokeWidth={1.5} />;
            })}
            {[30,90,150,210,270,330].map((a,i) => {
              const rad = a * Math.PI / 180;
              const px = 120 + 70*Math.cos(rad), py = 95 + 70*Math.sin(rad);
              const pts = Array.from({length:6},(_,k)=>`${px+14*Math.cos((k*60+a)*Math.PI/180)},${py+14*Math.sin((k*60+a)*Math.PI/180)}`).join(' ');
              return <polygon key={i} points={pts} fill="none" stroke={p.color} strokeWidth={1.5} />;
            })}
            <text x={120} y={185} textAnchor="middle" fontSize="12" fill={p.color}>C₆₀ Buckminsterfullerene</text>
          </g>
        )}
      </svg>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        {Object.entries(p).filter(([k]) => k !== 'color').map(([key, val]) => (
          <div key={key} style={{ flex: 1, minWidth: 120, padding: '6px 10px', background: 'var(--surface-2)', borderRadius: 8, fontSize: 12 }}>
            <div style={{ color: 'var(--text-2)', textTransform: 'capitalize' }}>{key}</div>
            <div style={{ color: 'var(--text-1)', fontWeight: 600 }}>{val as string}</div>
          </div>
        ))}
      </div>
      <div style={{ padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 8, fontSize: 12, color: 'var(--text-1)', textAlign: 'center' }}>
        <b style={{ color: 'var(--orange)' }}>All are pure carbon</b> — different arrangement → different properties
      </div>
    </div>
  );
}
