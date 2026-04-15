'use client';
import { useState, useRef, useEffect, useCallback } from 'react';

export default function DopplerEffect() {
  const [vRatio, setVRatio] = useState(0.4);
  const [running, setRunning] = useState(true);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const srcXRef = useRef(60);
  const wavesRef = useRef<{ x: number; r: number; maxR: number }[]>([]);
  const tickRef = useRef(0);

  const vSound = 340;
  const f0 = 440;
  const vSource = vRatio * vSound;
  const fAhead = +(f0 * vSound / (vSound - vSource)).toFixed(1);
  const fBehind = +(f0 * vSound / (vSound + vSource)).toFixed(1);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#111827';
    ctx.fillRect(0, 0, W, H);

    if (running) {
      tickRef.current++;
      srcXRef.current += vRatio * 2.5;
      if (srcXRef.current > W + 50) {
        srcXRef.current = -50;
        wavesRef.current = [];
      }
      if (tickRef.current % 12 === 0) {
        wavesRef.current.push({ x: srcXRef.current, r: 0, maxR: W * 0.8 });
      }
      wavesRef.current = wavesRef.current.filter(w => w.r < w.maxR);
      wavesRef.current.forEach(w => { w.r += 3; });
    }

    // Draw waves
    wavesRef.current.forEach(w => {
      ctx.beginPath();
      ctx.arc(w.x, H / 2, w.r, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(96,165,250,${Math.max(0, 0.7 - w.r / w.maxR)})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    });

    // Source (car)
    const sx = srcXRef.current;
    ctx.fillStyle = '#f97316';
    ctx.beginPath();
    ctx.roundRect(sx - 22, H / 2 - 12, 44, 24, 6);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('🔊', sx, H / 2 + 6);

    // Observer ahead (right side, fixed)
    const obsR = W - 40;
    ctx.fillStyle = '#10b981';
    ctx.beginPath();
    ctx.arc(obsR, H / 2, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('👁', obsR, H / 2 + 4);
    ctx.fillStyle = '#10b981';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText(`${fAhead} Hz`, obsR, H / 2 - 20);

    // Observer behind (left side, fixed)
    const obsL = 40;
    ctx.fillStyle = '#a78bfa';
    ctx.beginPath();
    ctx.arc(obsL, H / 2, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText('👁', obsL, H / 2 + 4);
    ctx.fillStyle = '#a78bfa';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText(`${fBehind} Hz`, obsL, H / 2 - 20);

    // Labels
    ctx.fillStyle = '#9ca3af';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`Source: f₀=${f0} Hz  |  v_s = ${vSource.toFixed(0)} m/s`, W / 2, H - 8);
  }, [running, vRatio, f0, vSource, fAhead, fBehind]);

  useEffect(() => {
    const loop = () => {
      draw();
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [draw]);

  const reset = () => {
    srcXRef.current = -50;
    wavesRef.current = [];
    tickRef.current = 0;
  };

  return (
    <div style={{ background: 'var(--surface-1)', borderRadius: 12, padding: 16, maxWidth: 600, margin: '0 auto', fontFamily: 'inherit' }}>
      <h3 style={{ color: 'var(--text-1)', fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Doppler Effect</h3>
      <canvas ref={canvasRef} width={560} height={200} style={{ width: '100%', borderRadius: 8, display: 'block' }} />
      <div style={{ marginTop: 10, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: 1 }}>
          <label style={{ color: 'var(--text-2)', fontSize: 13 }}>v_s / v_sound: {vRatio.toFixed(2)}</label>
          <input type="range" min={0} max={0.8} step={0.05} value={vRatio} onChange={e => setVRatio(+e.target.value)} style={{ width: '100%' }} />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setRunning(r => !r)} style={{ padding: '7px 14px', background: running ? 'var(--orange,#f97316)' : 'var(--purple,#7c3aed)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
            {running ? 'Pause' : 'Play'}
          </button>
          <button onClick={reset} style={{ padding: '7px 14px', background: '#374151', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>Reset</button>
        </div>
      </div>
      <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 8, fontSize: 13, color: 'var(--text-1)', textAlign: 'center' }}>
        f' = f₀·v/(v ± v_s) &nbsp;|&nbsp; Ahead: <b style={{ color: '#10b981' }}>{fAhead} Hz</b> &nbsp; Behind: <b style={{ color: '#a78bfa' }}>{fBehind} Hz</b>
      </div>
    </div>
  );
}
