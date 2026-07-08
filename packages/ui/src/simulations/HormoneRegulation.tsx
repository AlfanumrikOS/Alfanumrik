'use client';
import { useState, useEffect, useRef } from 'react';

type System = 'thyroid' | 'insulin' | 'adrenaline';

const SYSTEMS = {
  thyroid: {
    label: 'Thyroid Axis',
    nodes: [
      { id: 'hypo', label: 'Hypothalamus', color: '#CE93D8', x: 240, y: 30, hormone: 'TRH (Thyrotropin-releasing hormone)' },
      { id: 'pitu', label: 'Pituitary', color: '#90CAF9', x: 240, y: 105, hormone: 'TSH (Thyroid-stimulating hormone)' },
      { id: 'thyroid', label: 'Thyroid Gland', color: '#A5D6A7', x: 240, y: 180, hormone: 'T3 / T4 (Thyroid hormones)' },
    ],
    feedback: 'Low T3/T4 → more TRH/TSH released. High T3/T4 → TRH/TSH suppressed.',
  },
  insulin: {
    label: 'Insulin-Glucagon',
    nodes: [
      { id: 'food', label: 'High Blood Glucose', color: '#FFCC80', x: 240, y: 30, hormone: 'After eating carbohydrates' },
      { id: 'beta', label: 'β-cells (Pancreas)', color: '#80DEEA', x: 240, y: 105, hormone: 'Insulin secreted' },
      { id: 'liver2', label: 'Liver / Cells', color: '#A5D6A7', x: 240, y: 180, hormone: 'Glucose absorbed → blood glucose falls' },
    ],
    feedback: 'High glucose → insulin released → cells absorb glucose → blood glucose normalizes.',
  },
  adrenaline: {
    label: 'Adrenaline (Fight/Flight)',
    nodes: [
      { id: 'brain', label: 'Brain (Stress)', color: '#EF9A9A', x: 240, y: 30, hormone: 'Perceived threat → nerve signals' },
      { id: 'adrenal', label: 'Adrenal Medulla', color: '#FFAB91', x: 240, y: 105, hormone: 'Adrenaline (Epinephrine) released' },
      { id: 'body', label: 'Heart, Muscles, Liver', color: '#80CBC4', x: 240, y: 180, hormone: 'HR↑, glucose↑, airways↑ → threat resolved' },
    ],
    feedback: 'Threat perceived → adrenaline surges → body primed → threat gone → cortisol feedback dampens response.',
  },
};

export default function HormoneRegulation() {
  const svgRef = useRef<SVGSVGElement>(null);
  const animRef = useRef<number>(0);
  const tRef = useRef(0);
  const [system, setSystem] = useState<System>('thyroid');
  const [level, setLevel] = useState(50);
  const [animDot, setAnimDot] = useState(0);

  const s = SYSTEMS[system];
  const isLow = level < 35;
  const isHigh = level > 65;

  useEffect(() => {
    const loop = () => {
      tRef.current++;
      setAnimDot(tRef.current % 120);
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animRef.current);
  }, []);

  const dotProgress = animDot / 120;
  const getDotPos = (p: number) => {
    if (p < 0.33) { const t = p / 0.33; return [240, 30 + t * 75]; }
    if (p < 0.66) { const t = (p - 0.33) / 0.33; return [240, 105 + t * 75]; }
    const t = (p - 0.66) / 0.34;
    return [240 - t * 100, 180 + t * 0];
  };
  const [dotX, dotY] = getDotPos(dotProgress);
  const fbDot = getDotPos(1 - dotProgress);

  const signalStrength = isLow ? (isHigh ? 0.2 : 0.8) : (isHigh ? 0.2 : 0.5);

  return (
    <div style={{ background: 'var(--surface-1)', borderRadius: 12, padding: 16, maxWidth: 600, margin: '0 auto', fontFamily: 'inherit' }}>
      <h3 style={{ color: 'var(--text-1)', fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Hormone Regulation</h3>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        {(Object.keys(SYSTEMS) as System[]).map(sys => (
          <button key={sys} onClick={() => setSystem(sys)} style={{ flex: 1, padding: '4px 6px', background: system === sys ? 'var(--purple)' : 'var(--surface-2)', color: system === sys ? '#fff' : 'var(--text-1)', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 11 }}>
            {SYSTEMS[sys].label}
          </button>
        ))}
      </div>
      <svg ref={svgRef} viewBox="0 0 560 240" style={{ width: '100%', background: 'var(--surface-2)', borderRadius: 8, display: 'block' }}>
        {s.nodes.map((n, i) => {
          if (i < s.nodes.length - 1) {
            const next = s.nodes[i + 1];
            return <line key={i} x1={n.x + 60} y1={n.y + 28} x2={next.x + 60} y2={next.y}
              stroke={isLow ? '#4CAF50' : '#E53935'} strokeWidth={2 + signalStrength * 2}
              markerEnd="url(#harrow)" opacity={0.7} />;
          }
          return null;
        })}
        <line x1={300 + 60} y1={180 + 14} x2={300 + 60} y2={30 + 14}
          stroke="#F97316" strokeWidth={2} strokeDasharray="5,3" opacity={0.7}
          markerEnd="url(#fbarrow)" />
        <text x={400} y={105} fontSize={10} fill="#F97316" fontWeight={700}>Negative</text>
        <text x={400} y={118} fontSize={10} fill="#F97316" fontWeight={700}>Feedback</text>
        <defs>
          <marker id="harrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L0,6 L6,3 z" fill={isLow ? '#4CAF50' : '#E53935'} />
          </marker>
          <marker id="fbarrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L0,6 L6,3 z" fill="#F97316" />
          </marker>
        </defs>
        {s.nodes.map(n => (
          <g key={n.id}>
            <rect x={n.x} y={n.y} width={160} height={50} rx={8} fill={n.color} stroke="#aaa" strokeWidth={1} />
            <text x={n.x + 80} y={n.y + 18} textAnchor="middle" fontSize={11} fontWeight={700} fill="#333">{n.label}</text>
            <text x={n.x + 80} y={n.y + 34} textAnchor="middle" fontSize={9} fill="#555">{n.hormone.substring(0, 30)}</text>
          </g>
        ))}
        <circle cx={dotX + 60} cy={dotY + 14} r={7} fill="#1565C0" opacity={0.85} />
        <circle cx={fbDot[0] + 60} cy={fbDot[1] + 14} r={5} fill="#F97316" opacity={0.7} />
        <text x={16} y={220} fontSize={11} fill={isLow ? '#C62828' : '#1565C0'} fontWeight={700}>
          Hormone level: {isLow ? 'LOW → ↑ signals' : isHigh ? 'HIGH → ↓ signals (feedback)' : 'NORMAL'}
        </text>
      </svg>
      <div style={{ marginTop: 8 }}>
        <label style={{ fontSize: 12, color: 'var(--text-2)' }}>Hormone level: {level}%
          <input type="range" min={0} max={100} value={level} onChange={e => setLevel(+e.target.value)} style={{ marginLeft: 8, width: 120 }} />
          <span style={{ marginLeft: 8, color: isLow ? '#C62828' : isHigh ? '#1565C0' : '#4CAF50', fontWeight: 700 }}>{isLow ? 'LOW' : isHigh ? 'HIGH' : 'Normal'}</span>
        </label>
      </div>
      <div style={{ marginTop: 8, padding: '6px 10px', background: 'var(--surface-2)', borderRadius: 8, fontSize: 12, color: 'var(--text-2)' }}>
        {s.feedback}
      </div>
      <div style={{ marginTop: 8, padding: '8px 12px', background: '#FFF3E0', borderRadius: 8, fontSize: 13, color: '#E65100', borderLeft: '3px solid #F97316' }}>
        Negative feedback: <strong>output inhibits input</strong> → maintains homeostasis
      </div>
    </div>
  );
}
