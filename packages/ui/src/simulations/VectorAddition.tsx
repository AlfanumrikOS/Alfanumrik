'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

export const metadata = {
  id: 'vector-addition',
  name: 'Vector Addition',
  subject: 'Mathematics',
  grade: '11-12',
  description: 'Visualize vector addition using parallelogram law — components, resultant, and direction',
};

const ORANGE = '#F97316';
const PURPLE = '#7C3AED';
const SCALE = 28; // pixels per unit

function drawArrow(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number,
  x2: number, y2: number,
  color: string,
  width: number,
  dashed = false,
) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  if (dashed) ctx.setLineDash([6, 4]);
  else ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  // arrowhead
  if (!dashed) {
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const hw = 9;
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - hw * Math.cos(angle - 0.4), y2 - hw * Math.sin(angle - 0.4));
    ctx.lineTo(x2 - hw * Math.cos(angle + 0.4), y2 - hw * Math.sin(angle + 0.4));
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

export default function VectorAddition() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [magA, setMagA] = useState(5);
  const [angleA, setAngleA] = useState(40);
  const [magB, setMagB] = useState(4);
  const [angleB, setAngleB] = useState(120);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;
    const cx = W / 2;
    const cy = H / 2;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, W, H);

    // Grid
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    for (let gx = cx % SCALE; gx <= W; gx += SCALE) {
      ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke();
    }
    for (let gy = cy % SCALE; gy <= H; gy += SCALE) {
      ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
    }

    // Axes
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(W, cy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, H); ctx.stroke();

    // Axis labels
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '12px sans-serif';
    ctx.fillText('X', W - 14, cy - 6);
    ctx.fillText('Y', cx + 6, 14);

    const aRad = (angleA * Math.PI) / 180;
    const bRad = (angleB * Math.PI) / 180;
    const Ax = magA * Math.cos(aRad);
    const Ay = magA * Math.sin(aRad);
    const Bx = magB * Math.cos(bRad);
    const By = magB * Math.sin(bRad);
    const Rx = Ax + Bx;
    const Ry = Ay + By;
    const magR = Math.sqrt(Rx * Rx + Ry * Ry);
    const angleR = (Math.atan2(Ry, Rx) * 180) / Math.PI;

    const toCanvas = (vx: number, vy: number) => [cx + vx * SCALE, cy - vy * SCALE] as [number, number];
    const [o1, o2] = toCanvas(0, 0);

    // Parallelogram dashed sides
    const [ax, ay] = toCanvas(Ax, Ay);
    const [bx, by] = toCanvas(Bx, By);
    const [rx, ry] = toCanvas(Rx, Ry);
    drawArrow(ctx, ax, ay, rx, ry, 'rgba(147,197,114,0.4)', 1.5, true);
    drawArrow(ctx, bx, by, rx, ry, 'rgba(147,197,114,0.4)', 1.5, true);

    // Component dashed lines for A
    drawArrow(ctx, o1, o2, toCanvas(Ax, 0)[0], toCanvas(Ax, 0)[1], `${ORANGE}66`, 1, true);
    drawArrow(ctx, toCanvas(Ax, 0)[0], toCanvas(Ax, 0)[1], ax, ay, `${ORANGE}66`, 1, true);

    // Component dashed lines for B
    drawArrow(ctx, o1, o2, toCanvas(Bx, 0)[0], toCanvas(Bx, 0)[1], `${PURPLE}66`, 1, true);
    drawArrow(ctx, toCanvas(Bx, 0)[0], toCanvas(Bx, 0)[1], bx, by, `${PURPLE}66`, 1, true);

    // Vector A (orange)
    drawArrow(ctx, o1, o2, ax, ay, ORANGE, 2.5);
    ctx.fillStyle = ORANGE;
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText('A', ax + 8, ay - 6);

    // Vector B (purple)
    drawArrow(ctx, o1, o2, bx, by, PURPLE, 2.5);
    ctx.fillStyle = PURPLE;
    ctx.fillText('B', bx + 8, by - 6);

    // Resultant R (white)
    drawArrow(ctx, o1, o2, rx, ry, '#ffffff', 3);
    ctx.fillStyle = '#ffffff';
    ctx.fillText('R', rx + 8, ry - 6);

    // Origin dot
    ctx.beginPath();
    ctx.arc(o1, o2, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    return { Ax, Ay, Bx, By, Rx, Ry, magR, angleR };
  }, [magA, angleA, magB, angleB]);

  useEffect(() => { draw(); }, [draw]);

  const aRad = (angleA * Math.PI) / 180;
  const bRad = (angleB * Math.PI) / 180;
  const Ax = magA * Math.cos(aRad);
  const Ay = magA * Math.sin(aRad);
  const Bx = magB * Math.cos(bRad);
  const By = magB * Math.sin(bRad);
  const Rx = Ax + Bx;
  const Ry = Ay + By;
  const magR = Math.sqrt(Rx * Rx + Ry * Ry);
  const angleR = (Math.atan2(Ry, Rx) * 180) / Math.PI;

  const sliderStyle = { width: '100%', accentColor: ORANGE };
  const labelStyle = { color: '#d1d5db', fontSize: 13, marginBottom: 2 };
  const valueStyle = { color: '#f9fafb', fontWeight: 700, fontSize: 13 };

  return (
    <div style={{ background: '#111827', minHeight: '100vh', padding: 16, fontFamily: 'Plus Jakarta Sans, sans-serif', color: '#f9fafb' }}>
      <h2 style={{ textAlign: 'center', color: ORANGE, fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Vector Addition</h2>
      <p style={{ textAlign: 'center', color: '#9ca3af', fontSize: 12, marginBottom: 12 }}>Parallelogram Law of Vector Addition</p>

      <canvas
        ref={canvasRef}
        width={360} height={300}
        style={{ display: 'block', margin: '0 auto', borderRadius: 10, maxWidth: '100%', border: '1px solid rgba(255,255,255,0.1)' }}
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 16 }}>
        {/* Vector A */}
        <div style={{ background: '#1f2937', borderRadius: 10, padding: 12, border: `1px solid ${ORANGE}44` }}>
          <p style={{ color: ORANGE, fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Vector A</p>
          <p style={labelStyle}>Magnitude: <span style={valueStyle}>{magA}</span></p>
          <input type="range" min={1} max={10} value={magA} onChange={e => setMagA(Number(e.target.value))} style={sliderStyle} />
          <p style={{ ...labelStyle, marginTop: 6 }}>Angle: <span style={valueStyle}>{angleA}°</span></p>
          <input type="range" min={0} max={360} value={angleA} onChange={e => setAngleA(Number(e.target.value))} style={sliderStyle} />
          <p style={{ color: '#6b7280', fontSize: 11, marginTop: 6 }}>({Ax.toFixed(2)}, {Ay.toFixed(2)})</p>
        </div>
        {/* Vector B */}
        <div style={{ background: '#1f2937', borderRadius: 10, padding: 12, border: `1px solid ${PURPLE}44` }}>
          <p style={{ color: PURPLE, fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Vector B</p>
          <p style={labelStyle}>Magnitude: <span style={valueStyle}>{magB}</span></p>
          <input type="range" min={1} max={10} value={magB} onChange={e => setMagB(Number(e.target.value))} style={sliderStyle} />
          <p style={{ ...labelStyle, marginTop: 6 }}>Angle: <span style={valueStyle}>{angleB}°</span></p>
          <input type="range" min={0} max={360} value={angleB} onChange={e => setAngleB(Number(e.target.value))} style={sliderStyle} />
          <p style={{ color: '#6b7280', fontSize: 11, marginTop: 6 }}>({Bx.toFixed(2)}, {By.toFixed(2)})</p>
        </div>
      </div>

      <div style={{ background: '#1f2937', borderRadius: 10, padding: 14, marginTop: 12, border: '1px solid rgba(255,255,255,0.1)' }}>
        <p style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: '#ffffff' }}>Resultant R</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, textAlign: 'center' }}>
          <div style={{ background: '#111827', borderRadius: 8, padding: 10 }}>
            <p style={{ color: '#9ca3af', fontSize: 11 }}>Components</p>
            <p style={{ color: '#fff', fontSize: 13, fontWeight: 700 }}>({Rx.toFixed(2)}, {Ry.toFixed(2)})</p>
          </div>
          <div style={{ background: '#111827', borderRadius: 8, padding: 10 }}>
            <p style={{ color: '#9ca3af', fontSize: 11 }}>|R|</p>
            <p style={{ color: '#fff', fontSize: 13, fontWeight: 700 }}>{magR.toFixed(3)}</p>
          </div>
          <div style={{ background: '#111827', borderRadius: 8, padding: 10 }}>
            <p style={{ color: '#9ca3af', fontSize: 11 }}>Direction</p>
            <p style={{ color: '#fff', fontSize: 13, fontWeight: 700 }}>{angleR.toFixed(1)}°</p>
          </div>
        </div>
        <p style={{ color: '#6b7280', fontSize: 11, marginTop: 8, textAlign: 'center' }}>
          |R| = {magR.toFixed(3)} &nbsp;|&nbsp; R = {Rx.toFixed(2)}x̂ + {Ry.toFixed(2)}ŷ
        </p>
      </div>
    </div>
  );
}
