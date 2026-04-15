'use client';
import { useState, useRef, useEffect, useCallback } from 'react';

export const metadata = {
  id: 'coulombs-law',
  name: "Coulomb's Law",
  subject: 'Physics',
  grade: '10-12',
  description: "Explore electrostatic forces between charges using Coulomb's law",
};

const K = 8.99e9; // N·m²/C²

export default function CoulombsLaw() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [q1, setQ1] = useState(5);
  const [q2, setQ2] = useState(5);
  const [distance, setDistance] = useState(10);
  const [q1Sign, setQ1Sign] = useState<'+' | '-'>('+');
  const [q2Sign, setQ2Sign] = useState<'+' | '-'>('+');

  const q1Val = q1 * 1e-6 * (q1Sign === '+' ? 1 : -1);
  const q2Val = q2 * 1e-6 * (q2Sign === '+' ? 1 : -1);
  const r = distance / 100; // cm -> m
  const force = K * Math.abs(q1Val) * Math.abs(q2Val) / (r * r);
  const isAttractive = q1Sign !== q2Sign;
  const forceStr = force >= 1000 ? `${(force / 1000).toFixed(2)} kN` : force >= 1 ? `${force.toFixed(2)} N` : `${(force * 1000).toFixed(2)} mN`;

  const drawArrow = useCallback((ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string) => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 2) return;
    const ux = dx / len;
    const uy = dy / len;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    // Arrowhead
    const headLen = 10;
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - headLen * ux + headLen * 0.4 * uy, y2 - headLen * uy - headLen * 0.4 * ux);
    ctx.lineTo(x2 - headLen * ux - headLen * 0.4 * uy, y2 - headLen * uy + headLen * 0.4 * ux);
    ctx.closePath();
    ctx.fill();
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0f0f23';
    ctx.fillRect(0, 0, W, H);

    // Positions: spread based on distance slider (10-200px visual range)
    const margin = 60;
    const q1X = margin;
    const q2X = W - margin;
    const midY = H / 2;
    const chargeR = 22;

    // Arrow length proportional to log(force+1), scaled to canvas
    const arrowScale = Math.min(60, Math.log10(force + 1) * 25);

    if (isAttractive) {
      // Arrows point toward each other
      drawArrow(ctx, q1X + chargeR + 5, midY, q1X + chargeR + 5 + arrowScale, midY, '#22c55e');
      drawArrow(ctx, q2X - chargeR - 5, midY, q2X - chargeR - 5 - arrowScale, midY, '#22c55e');
    } else {
      // Arrows point away
      drawArrow(ctx, q1X, midY, q1X - arrowScale, midY, '#ef4444');
      drawArrow(ctx, q2X, midY, q2X + arrowScale, midY, '#ef4444');
    }

    // Dashed line between charges
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(q1X + chargeR, midY);
    ctx.lineTo(q2X - chargeR, midY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Distance label on dashed line
    ctx.fillStyle = '#64748b';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`r = ${distance} cm`, W / 2, midY - 8);

    // Charge 1
    const c1Color = q1Sign === '+' ? '#ef4444' : '#3b82f6';
    ctx.beginPath();
    ctx.arc(q1X, midY, chargeR, 0, 2 * Math.PI);
    ctx.fillStyle = c1Color;
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(q1Sign, q1X, midY + 5);
    ctx.font = '10px sans-serif';
    ctx.fillStyle = '#e2e8f0';
    ctx.fillText(`q1=${q1}μC`, q1X, midY + chargeR + 14);

    // Charge 2
    const c2Color = q2Sign === '+' ? '#ef4444' : '#3b82f6';
    ctx.beginPath();
    ctx.arc(q2X, midY, chargeR, 0, 2 * Math.PI);
    ctx.fillStyle = c2Color;
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(q2Sign, q2X, midY + 5);
    ctx.font = '10px sans-serif';
    ctx.fillStyle = '#e2e8f0';
    ctx.fillText(`q2=${q2}μC`, q2X, midY + chargeR + 14);

    // Force label
    ctx.fillStyle = '#F97316';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`F = ${forceStr}`, W / 2, H - 12);
  }, [q1, q2, distance, q1Sign, q2Sign, force, isAttractive, forceStr, drawArrow]);

  useEffect(() => { draw(); }, [draw]);

  const sliderStyle = { width: '100%', accentColor: '#F97316' };
  const labelStyle: React.CSSProperties = { color: '#94a3b8', fontSize: 13 };
  const valueStyle: React.CSSProperties = { color: '#F97316', fontWeight: 700 };

  const SignToggle = ({ sign, onToggle, color }: { sign: '+' | '-'; onToggle: () => void; color: string }) => (
    <button onClick={onToggle}
      style={{ padding: '4px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
        background: sign === '+' ? '#ef4444' : '#3b82f6', color: '#fff', fontWeight: 700, fontSize: 16, minWidth: 44, minHeight: 36 }}>
      {sign}
    </button>
  );

  return (
    <div style={{ background: '#1a1a2e', borderRadius: 12, padding: 16, maxWidth: '100%', fontFamily: 'sans-serif' }}>
      <h2 style={{ color: '#F97316', margin: '0 0 12px', fontSize: 18, fontWeight: 700 }}>Coulomb's Law</h2>
      <canvas ref={canvasRef} width={400} height={200} style={{ width: '100%', borderRadius: 8, display: 'block' }} />
      <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ ...labelStyle, fontWeight: 700 }}>Charge q1</span>
            <SignToggle sign={q1Sign} onToggle={() => setQ1Sign(s => s === '+' ? '-' : '+')} color="#ef4444" />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={labelStyle}>Magnitude</span>
            <span style={valueStyle}>{q1} μC</span>
          </div>
          <input type="range" min={1} max={10} value={q1}
            onChange={e => setQ1(Number(e.target.value))} style={sliderStyle} />
        </div>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ ...labelStyle, fontWeight: 700 }}>Charge q2</span>
            <SignToggle sign={q2Sign} onToggle={() => setQ2Sign(s => s === '+' ? '-' : '+')} color="#3b82f6" />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={labelStyle}>Magnitude</span>
            <span style={valueStyle}>{q2} μC</span>
          </div>
          <input type="range" min={1} max={10} value={q2}
            onChange={e => setQ2(Number(e.target.value))} style={sliderStyle} />
        </div>
      </div>
      <div style={{ marginTop: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={labelStyle}>Distance (r)</span>
          <span style={valueStyle}>{distance} cm</span>
        </div>
        <input type="range" min={1} max={20} value={distance}
          onChange={e => setDistance(Number(e.target.value))} style={sliderStyle} />
      </div>
      <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div style={{ background: '#0f0f23', borderRadius: 8, padding: '10px', textAlign: 'center' }}>
          <div style={{ color: '#64748b', fontSize: 11 }}>Electrostatic Force</div>
          <div style={{ color: '#F97316', fontWeight: 700, fontSize: 16 }}>{forceStr}</div>
        </div>
        <div style={{ background: '#0f0f23', borderRadius: 8, padding: '10px', textAlign: 'center' }}>
          <div style={{ color: '#64748b', fontSize: 11 }}>Interaction Type</div>
          <div style={{ color: isAttractive ? '#22c55e' : '#ef4444', fontWeight: 700, fontSize: 16 }}>
            {isAttractive ? 'Attractive' : 'Repulsive'}
          </div>
        </div>
      </div>
    </div>
  );
}
