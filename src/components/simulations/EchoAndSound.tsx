'use client';
import { useState, useRef, useEffect, useCallback } from 'react';

export default function EchoAndSound() {
  const [dist, setDist] = useState(200);
  const [soundSpeed, setSoundSpeed] = useState(344);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const tRef = useRef(0);

  const delay = (2 * dist) / soundSpeed;
  const minDist = (soundSpeed * 0.1) / 2;
  const audible = dist >= minDist;

  const draw = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const w = canvas.width, h = canvas.height;
    tRef.current += 0.03;
    const t = tRef.current;
    ctx.clearRect(0, 0, w, h);

    const sx = 60, sy = h / 2;
    const wx = w - 50;

    // Wall
    ctx.fillStyle = '#6b7280'; ctx.fillRect(wx, 20, 16, h - 40);
    ctx.fillStyle = 'var(--text-2)'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('Wall', wx + 8, h - 10);

    // Speaker
    ctx.fillStyle = '#374151'; ctx.fillRect(sx - 18, sy - 20, 22, 40);
    ctx.fillStyle = '#9ca3af';
    ctx.beginPath(); ctx.moveTo(sx + 4, sy - 12); ctx.lineTo(sx + 18, sy - 20); ctx.lineTo(sx + 18, sy + 20); ctx.lineTo(sx + 4, sy + 12); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'var(--text-2)'; ctx.fillText('Speaker', sx, sy + 34);

    // Sound waves (expanding semicircles going right, then returning)
    const totalTravel = wx - sx - 20;
    const waveCount = 4;
    for (let i = 0; i < waveCount; i++) {
      const phase = ((t + i * 0.6) % 2.4) / 2.4;
      const going = phase < 0.5;
      const frac = going ? phase * 2 : (phase - 0.5) * 2;
      const waveX = going ? sx + 20 + frac * totalTravel : wx - 10 - frac * totalTravel;
      const maxR = 35;
      const r = frac * maxR + 8;
      const alpha = 0.7 - frac * 0.5;
      ctx.strokeStyle = going ? `rgba(251,146,60,${alpha})` : `rgba(139,92,246,${alpha})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(waveX, sy, r, -Math.PI / 2, Math.PI / 2); ctx.stroke();
    }

    // Distance arrow
    ctx.strokeStyle = '#888'; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(sx + 20, sy + 55); ctx.lineTo(wx, sy + 55); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'var(--text-2)'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(`${dist} m`, (sx + 20 + wx) / 2, sy + 70);
  }, [dist, soundSpeed]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(function loop() {
      draw();
      rafRef.current = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(rafRef.current);
  }, [draw]);

  return (
    <div style={{ background: 'var(--surface-1)', borderRadius: 12, padding: 16, maxWidth: 600, margin: '0 auto', fontFamily: 'inherit' }}>
      <h3 style={{ color: 'var(--text-1)', fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Echo and Sound</h3>
      <canvas ref={canvasRef} width={560} height={200} style={{ width: '100%', borderRadius: 8, background: 'var(--surface-2)', display: 'block' }} />
      <div style={{ marginTop: 10 }}>
        <label style={{ color: 'var(--text-2)', fontSize: 13 }}>Distance to Wall: {dist} m</label>
        <input type="range" min={10} max={500} value={dist} onChange={e => setDist(+e.target.value)} style={{ width: '100%' }} />
        <label style={{ color: 'var(--text-2)', fontSize: 13 }}>Speed of Sound: {soundSpeed} m/s</label>
        <input type="range" min={300} max={400} value={soundSpeed} onChange={e => setSoundSpeed(+e.target.value)} style={{ width: '100%' }} />
      </div>
      <div style={{ marginTop: 8, display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' }}>
        <span style={{ padding: '4px 12px', borderRadius: 6, background: audible ? '#16a34a' : '#dc2626', color: '#fff', fontWeight: 700, fontSize: 13 }}>
          {audible ? 'Echo Audible' : 'No Echo (too close)'}
        </span>
        <span style={{ color: 'var(--text-2)', fontSize: 13 }}>
          Delay = <b style={{ color: 'var(--orange)' }}>{delay.toFixed(3)} s</b> &nbsp;(min: 0.1 s, min dist: {minDist.toFixed(1)} m)
        </span>
      </div>
      <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 8, fontSize: 13, color: 'var(--text-1)', textAlign: 'center' }}>
        Echo delay = 2d / v = 2 × {dist} / {soundSpeed} = <b style={{ color: 'var(--orange)' }}>{delay.toFixed(3)} s</b>
      </div>
    </div>
  );
}
