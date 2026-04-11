'use client';
import { useState, useRef, useEffect, useCallback } from 'react';

const STEPS = ['Evaporation', 'Condensation', 'Precipitation', 'Collection'] as const;
type Step = typeof STEPS[number];

export default function WeatherCycle() {
  const [stepIdx, setStepIdx] = useState(0);
  const [tick, setTick] = useState(0);
  const step: Step = STEPS[stepIdx];

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 60);
    return () => clearInterval(id);
  }, []);

  const W = 560, H = 300;
  const cloudCX = W / 2, cloudCY = 70;
  const mountainPts = `80,${H - 40} 160,${H - 130} 220,${H - 80} 280,${H - 40}`;
  const oceanPts = `300,${H - 40} 560,${H - 40} 560,${H - 10} 300,${H - 10}`;
  const riverPts = `220,${H - 80} 280,${H - 40} 340,${H - 40} 380,${H - 30} 420,${H - 20} 500,${H - 20}`;

  const cloudDark = step === 'Condensation' || step === 'Precipitation';
  const cloudFill = cloudDark ? '#4b5563' : '#d1d5db';

  // Arrow offsets with tick for animation
  const t = tick * 0.08;

  const evapArrows = Array.from({ length: 5 }, (_, i) => {
    const bx = 330 + i * 40;
    const by = H - 30 + (Math.sin(t + i) * 4);
    const ey = cloudCY + 40;
    return { x: bx, y1: by, y2: ey };
  });

  const rainDrops = Array.from({ length: 8 }, (_, i) => {
    const x = cloudCX - 70 + i * 20;
    const offset = ((t * 30 + i * 15) % 120);
    return { x, y: cloudCY + 30 + offset };
  });

  const riverLevel = step === 'Collection' ? H - 38 : H - 30;

  return (
    <div style={{ background: 'var(--surface-1)', borderRadius: 12, padding: 16, maxWidth: 600, margin: '0 auto', fontFamily: 'inherit' }}>
      <h3 style={{ color: 'var(--text-1)', fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Water Cycle</h3>
      <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
        {STEPS.map((s, i) => (
          <button key={s} onClick={() => setStepIdx(i)} style={{
            padding: '5px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12,
            background: stepIdx === i ? 'var(--orange)' : 'var(--surface-2)',
            color: stepIdx === i ? '#fff' : 'var(--text-1)', fontWeight: stepIdx === i ? 700 : 400,
          }}>{i + 1}. {s}</button>
        ))}
      </div>

      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ background: 'var(--surface-2)', borderRadius: 8, display: 'block' }}>
        {/* Sky */}
        <rect x={0} y={0} width={W} height={H} fill={step === 'Precipitation' ? '#334155' : '#bfdbfe'} />

        {/* Sun (not during precipitation) */}
        {step !== 'Precipitation' && <circle cx={490} cy={50} r={28} fill="#fcd34d" />}

        {/* Mountain */}
        <polygon points={mountainPts} fill="#6b7280" />
        <polygon points={`140,${H - 130} 160,${H - 155} 180,${H - 130}`} fill="white" />

        {/* Ocean */}
        <polygon points={oceanPts} fill="#3b82f6" opacity={0.85} />
        <text x={430} y={H - 18} textAnchor="middle" fontSize={12} fill="#fff" fontWeight="bold">Ocean</text>

        {/* River */}
        <polyline points={riverPts} fill="none" stroke={step === 'Collection' ? '#60a5fa' : '#93c5fd'} strokeWidth={step === 'Collection' ? 6 : 3} />

        {/* Cloud */}
        <g>
          <ellipse cx={cloudCX} cy={cloudCY + 10} rx={60} ry={28} fill={cloudFill} />
          <ellipse cx={cloudCX - 30} cy={cloudCY + 18} rx={35} ry={22} fill={cloudFill} />
          <ellipse cx={cloudCX + 35} cy={cloudCY + 18} rx={35} ry={22} fill={cloudFill} />
          <text x={cloudCX} y={cloudCY - 5} textAnchor="middle" fontSize={11} fill={cloudDark ? '#fff' : '#374151'} fontWeight="bold">Cloud</text>
        </g>

        {/* Evaporation arrows */}
        {step === 'Evaporation' && evapArrows.map((a, i) => (
          <line key={i} x1={a.x} y1={a.y1} x2={a.x} y2={a.y2} stroke="#60a5fa" strokeWidth={2} markerEnd="url(#arrBlue)" opacity={0.85} />
        ))}

        {/* Condensation droplets */}
        {step === 'Condensation' && Array.from({ length: 6 }, (_, i) => (
          <circle key={i} cx={cloudCX - 40 + i * 16} cy={cloudCY + 35 + (Math.sin(t + i) * 3)} r={4} fill="#93c5fd" />
        ))}

        {/* Precipitation */}
        {step === 'Precipitation' && rainDrops.map((d, i) => (
          <line key={i} x1={d.x} y1={d.y} x2={d.x - 3} y2={d.y + 14} stroke="#93c5fd" strokeWidth={2} />
        ))}

        {/* Collection flow arrow */}
        {step === 'Collection' && (
          <line x1={240} y1={H - 50} x2={460} y2={H - 26} stroke="#3b82f6" strokeWidth={3} markerEnd="url(#arrBlue)" />
        )}

        {/* Labels */}
        <text x={140} y={H - 16} textAnchor="middle" fontSize={11} fill="var(--text-2)">Mountain</text>
        <text x={cloudCX} y={H - 5} textAnchor="middle" fontSize={11} fill="var(--text-2)">River</text>

        {/* Active step label */}
        <rect x={W - 170} y={8} width={162} height={28} rx={6} fill="var(--orange)" opacity={0.9} />
        <text x={W - 89} y={27} textAnchor="middle" fontSize={13} fill="#fff" fontWeight="bold">{step}</text>

        <defs>
          <marker id="arrBlue" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
            <path d="M0,0 L0,6 L6,3 z" fill="#60a5fa" />
          </marker>
        </defs>
      </svg>

      <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 8, fontSize: 13, color: 'var(--text-1)', textAlign: 'center' }}>
        Step <b style={{ color: 'var(--orange)' }}>{stepIdx + 1}/4</b>: <b>{step}</b> — Water cycle drives Earth's fresh water supply
      </div>
    </div>
  );
}
