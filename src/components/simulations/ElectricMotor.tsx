'use client';
import { useState, useRef, useEffect, useCallback } from 'react';

export default function ElectricMotor() {
  const [current, setCurrent] = useState(2.5);
  const [playing, setPlaying] = useState(true);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const angleRef = useRef(0);
  const rafRef = useRef<number>(0);
  const B = 0.5;
  const L = 0.3;
  const N = 50;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    // Background
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, W, H);

    const cx = W / 2, cy = H / 2;

    // N pole (blue)
    ctx.fillStyle = '#3b82f6';
    ctx.fillRect(40, cy - 70, 80, 140);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 28px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('N', 80, cy + 10);

    // S pole (red)
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(W - 120, cy - 70, 80, 140);
    ctx.fillStyle = '#fff';
    ctx.fillText('S', W - 80, cy + 10);

    // Field lines (horizontal, faint)
    ctx.strokeStyle = 'rgba(180,200,255,0.2)';
    ctx.lineWidth = 1;
    for (let y = cy - 50; y <= cy + 50; y += 20) {
      ctx.beginPath();
      ctx.moveTo(120, y);
      ctx.lineTo(W - 120, y);
      ctx.stroke();
    }

    // Rotating coil
    const angle = angleRef.current;
    const aw = 70, ah = 50;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);

    // Coil sides
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 4;
    ctx.strokeRect(-aw, -ah, aw * 2, ah * 2);

    // Force arrows on vertical conductors
    const F = B * current * L;
    const arrowSize = 10 + F * 3;
    // Left conductor — force direction based on angle
    const leftUp = Math.cos(angle) > 0;
    ctx.fillStyle = '#f97316';
    drawArrow(ctx, -aw, 0, -aw, leftUp ? -arrowSize : arrowSize, 6);
    ctx.fillStyle = '#a855f7';
    drawArrow(ctx, aw, 0, aw, leftUp ? arrowSize : -arrowSize, 6);

    ctx.restore();

    // Axle
    ctx.beginPath();
    ctx.arc(cx, cy, 8, 0, Math.PI * 2);
    ctx.fillStyle = '#6b7280';
    ctx.fill();

    // Force labels
    ctx.font = '12px sans-serif';
    ctx.fillStyle = '#f97316';
    ctx.textAlign = 'left';
    ctx.fillText(`F = ${F.toFixed(2)} N`, 20, H - 20);
    ctx.fillStyle = '#a855f7';
    ctx.textAlign = 'right';
    ctx.fillText(`F = ${F.toFixed(2)} N`, W - 20, H - 20);
  }, [current]);

  function drawArrow(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, size: number) {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) return;
    const ux = dx / len, uy = dy / len;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = ctx.fillStyle as string;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - ux * size + uy * size * 0.5, y2 - uy * size - ux * size * 0.5);
    ctx.lineTo(x2 - ux * size - uy * size * 0.5, y2 - uy * size + ux * size * 0.5);
    ctx.closePath();
    ctx.fill();
  }

  useEffect(() => {
    const animate = () => {
      if (playing) {
        angleRef.current += 0.02;
      }
      draw();
      rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, draw]);

  const F = (B * current * 0.3).toFixed(3);
  const T = (B * current * N * 0.06).toFixed(3);

  return (
    <div style={{ background: 'var(--surface-1)', borderRadius: 12, padding: 16, maxWidth: 600, margin: '0 auto', fontFamily: 'inherit' }}>
      <h3 style={{ color: 'var(--text-1)', fontSize: 16, fontWeight: 700, marginBottom: 8 }}>DC Electric Motor</h3>
      <canvas ref={canvasRef} width={560} height={300} style={{ width: '100%', borderRadius: 8, display: 'block' }} />
      <div style={{ marginTop: 10, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: 1 }}>
          <label style={{ color: 'var(--text-2)', fontSize: 13 }}>Current I: {current.toFixed(1)} A</label>
          <input type="range" min={0.5} max={5} step={0.1} value={current} onChange={e => setCurrent(+e.target.value)} style={{ width: '100%' }} />
        </div>
        <button onClick={() => setPlaying(p => !p)} style={{ padding: '8px 16px', background: playing ? 'var(--orange, #f97316)' : 'var(--purple, #7c3aed)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
          {playing ? 'Pause' : 'Play'}
        </button>
      </div>
      <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 8, fontSize: 13, color: 'var(--text-1)', textAlign: 'center' }}>
        F = BIL = <b style={{ color: 'var(--orange, #f97316)' }}>{F} N</b> &nbsp;|&nbsp; Torque = BINA = <b style={{ color: 'var(--purple, #7c3aed)' }}>{T} N·m</b>
        <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>B = 0.5 T, L = 0.3 m, N = 50 turns, A = 0.12 m²</div>
      </div>
    </div>
  );
}
