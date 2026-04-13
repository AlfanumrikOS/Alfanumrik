'use client';
import { useState, useEffect, useCallback } from 'react';
import { useResponsiveCanvas } from '@/hooks/useResponsiveCanvas';

export const metadata = {
  id: 'magnetic-field',
  name: 'Magnetic Field Visualizer',
  subject: 'Physics',
  grade: '10-12',
  description: 'Visualize magnetic field lines around a current-carrying conductor using the right-hand rule',
};

const MU0 = 4 * Math.PI * 1e-7;

export default function MagneticField() {
  const { canvasRef, containerRef, size } = useResponsiveCanvas(400 / 280);
  const [current, setCurrent] = useState(5);
  const [direction, setDirection] = useState<'out' | 'into'>('out');
  const [showCompass, setShowCompass] = useState(true);

  const bAtR = useCallback((r_m: number) => (MU0 * current) / (2 * Math.PI * r_m), [current]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = size.width;
    const H = size.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0f0f23';
    ctx.fillRect(0, 0, W, H);

    const cx = W / 2;
    const cy = H / 2;

    // Draw field lines (concentric circles), spacing ∝ 1/r so r_n = r_1 * n
    const baseR = 18;
    const numLines = 8;
    for (let n = 1; n <= numLines; n++) {
      const r = baseR * n;
      if (r > Math.min(W, H) / 2 - 10) break;
      const alpha = Math.max(0.15, 1 - n * 0.1);
      ctx.strokeStyle = `rgba(20, 220, 210, ${alpha})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, 2 * Math.PI);
      ctx.stroke();

      // Arrow on each circle at the right side (90deg from top)
      const arrowAngle = Math.PI / 2; // right side, top
      const ax = cx + r * Math.cos(arrowAngle);
      const ay = cy + r * Math.sin(arrowAngle);
      // direction: out of screen => counter-clockwise when viewed from front (right-hand rule)
      // into screen => clockwise
      const tangentDir = direction === 'out' ? -1 : 1;
      const tx = tangentDir * (-Math.sin(arrowAngle));
      const ty = tangentDir * (Math.cos(arrowAngle));
      const arrowLen = 7;
      ctx.strokeStyle = `rgba(20, 220, 210, ${alpha})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(ax + tx * arrowLen - ty * 4, ay + ty * arrowLen + tx * 4);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(ax + tx * arrowLen + ty * 4, ay + ty * arrowLen - tx * 4);
      ctx.stroke();
    }

    // Compass needles at select positions
    if (showCompass) {
      const positions = [
        { angle: 0, r: baseR * 3 },
        { angle: Math.PI / 2, r: baseR * 3 },
        { angle: Math.PI, r: baseR * 3 },
        { angle: 3 * Math.PI / 2, r: baseR * 3 },
        { angle: Math.PI / 4, r: baseR * 5 },
        { angle: 3 * Math.PI / 4, r: baseR * 5 },
        { angle: 5 * Math.PI / 4, r: baseR * 5 },
        { angle: 7 * Math.PI / 4, r: baseR * 5 },
      ];
      positions.forEach(({ angle, r }) => {
        const nx = cx + r * Math.cos(angle);
        const ny = cy + r * Math.sin(angle);
        // Tangent direction is perpendicular to radius
        const tangDir = direction === 'out' ? -1 : 1;
        const tAngle = angle + Math.PI / 2 * tangDir;
        const needleLen = 9;
        ctx.save();
        ctx.translate(nx, ny);
        ctx.rotate(tAngle);
        // Red half
        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.moveTo(0, -needleLen);
        ctx.lineTo(3, 0);
        ctx.lineTo(-3, 0);
        ctx.closePath();
        ctx.fill();
        // White half
        ctx.fillStyle = '#e2e8f0';
        ctx.beginPath();
        ctx.moveTo(0, needleLen);
        ctx.lineTo(3, 0);
        ctx.lineTo(-3, 0);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      });
    }

    // Draw wire cross-section at center
    ctx.fillStyle = '#F97316';
    ctx.beginPath();
    ctx.arc(cx, cy, 12, 0, 2 * Math.PI);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();

    if (direction === 'out') {
      // Dot symbol
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(cx, cy, 4, 0, 2 * Math.PI);
      ctx.fill();
    } else {
      // Cross symbol
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(cx - 6, cy - 6); ctx.lineTo(cx + 6, cy + 6);
      ctx.moveTo(cx + 6, cy - 6); ctx.lineTo(cx - 6, cy + 6);
      ctx.stroke();
    }

    // B field labels at r distances
    const distances_cm = [1, 5, 10];
    ctx.font = '11px monospace';
    ctx.textAlign = 'left';
    distances_cm.forEach((d_cm, i) => {
      const B = bAtR(d_cm / 100);
      const label = `B(${d_cm}cm)=${(B * 1e6).toFixed(1)} μT`;
      ctx.fillStyle = '#14dcce';
      ctx.fillText(label, 8, 18 + i * 16);
    });

    // Mode label
    ctx.fillStyle = '#94a3b8';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`I = ${current} A  ${direction === 'out' ? '⊙ out of screen' : '⊗ into screen'}`, W - 8, H - 8);
  }, [current, direction, showCompass, bAtR, size, canvasRef]);

  useEffect(() => { draw(); }, [draw]);

  const sliderStyle = { width: '100%', accentColor: '#F97316' };
  const labelStyle: React.CSSProperties = { color: '#94a3b8', fontSize: 13 };
  const valueStyle: React.CSSProperties = { color: '#F97316', fontWeight: 700 };

  return (
    <div style={{ background: '#1a1a2e', borderRadius: 12, padding: 16, maxWidth: '100%', fontFamily: 'sans-serif' }}>
      <h2 style={{ color: '#F97316', margin: '0 0 12px', fontSize: 18, fontWeight: 700 }}>Magnetic Field Visualizer</h2>
      <div ref={containerRef} className="w-full" style={{ aspectRatio: '400/280' }}>
        <canvas ref={canvasRef} className="rounded-lg" style={{ display: 'block' }} />
      </div>
      <div style={{ marginTop: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
          <span style={labelStyle}>Current (I)</span>
          <span style={valueStyle}>{current} A</span>
        </div>
        <input type="range" min={1} max={20} value={current}
          onChange={e => setCurrent(Number(e.target.value))} style={sliderStyle} />
      </div>
      <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
        {(['out', 'into'] as const).map(d => (
          <button key={d} onClick={() => setDirection(d)}
            style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: 'none', cursor: 'pointer',
              background: direction === d ? '#7C3AED' : '#1e293b',
              color: direction === d ? '#fff' : '#94a3b8', fontWeight: 700, fontSize: 13 }}>
            {d === 'out' ? '⊙ Out of Screen' : '⊗ Into Screen'}
          </button>
        ))}
      </div>
      <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
        <input type="checkbox" id="compass" checked={showCompass}
          onChange={e => setShowCompass(e.target.checked)}
          style={{ accentColor: '#F97316', width: 16, height: 16, cursor: 'pointer' }} />
        <label htmlFor="compass" style={{ ...labelStyle, cursor: 'pointer' }}>Show compass needles</label>
      </div>
      <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
        {[1, 5, 10].map(d => {
          const B = bAtR(d / 100);
          return (
            <div key={d} style={{ background: '#0f0f23', borderRadius: 8, padding: '8px 10px', textAlign: 'center' }}>
              <div style={{ color: '#64748b', fontSize: 11 }}>B at {d} cm</div>
              <div style={{ color: '#14dcce', fontWeight: 700, fontSize: 14 }}>{(B * 1e6).toFixed(2)} μT</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
