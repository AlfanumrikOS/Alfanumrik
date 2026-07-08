'use client';
import { useState, useRef, useEffect, useCallback } from 'react';

export default function SpeedDistanceTime() {
  const [speed, setSpeed] = useState(5);
  const [time, setTime] = useState(4);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const distance = +(speed * time).toFixed(1);

  const draw = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const roadW = w / 2 - 10;
    const graphX = roadW + 20;
    const graphW = w - graphX - 20;
    const graphH = h - 60;
    const graphY = 30;

    // --- LEFT: Road ---
    ctx.fillStyle = '#374151'; ctx.fillRect(0, 0, roadW, h);
    // road markings
    ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = 2; ctx.setLineDash([20, 15]);
    ctx.beginPath(); ctx.moveTo(roadW / 2, 0); ctx.lineTo(roadW / 2, h); ctx.stroke();
    ctx.setLineDash([]);
    // road edge lines
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(10, h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(roadW - 10, 0); ctx.lineTo(roadW - 10, h); ctx.stroke();

    const maxD = speed * 10;
    const carX = maxD > 0 ? (distance / maxD) * (roadW - 60) + 30 : 30;
    // Car body
    ctx.fillStyle = 'var(--orange)'; ctx.fillRect(carX - 20, h / 2 - 14, 40, 20);
    ctx.fillStyle = '#93c5fd'; ctx.fillRect(carX - 12, h / 2 - 22, 24, 12);
    // wheels
    ctx.fillStyle = '#1f2937';
    ctx.beginPath(); ctx.arc(carX - 12, h / 2 + 6, 7, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(carX + 12, h / 2 + 6, 7, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = '#fff'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(`d = ${distance} m`, carX, h / 2 + 22);
    ctx.fillText('Road', roadW / 2, h - 8);

    // Divider
    ctx.strokeStyle = '#555'; ctx.lineWidth = 1; ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(roadW + 10, 0); ctx.lineTo(roadW + 10, h); ctx.stroke();

    // --- RIGHT: Distance-Time Graph ---
    ctx.fillStyle = 'var(--text-1)'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('d–t Graph', graphX + graphW / 2, graphY - 10);

    // Axes
    ctx.strokeStyle = '#888'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(graphX, graphY); ctx.lineTo(graphX, graphY + graphH); ctx.lineTo(graphX + graphW, graphY + graphH); ctx.stroke();

    // Axis labels
    ctx.fillStyle = 'var(--text-2)'; ctx.font = '10px sans-serif';
    ctx.fillText('t (s)', graphX + graphW, graphY + graphH + 14);
    ctx.save(); ctx.translate(graphX - 14, graphY + graphH / 2); ctx.rotate(-Math.PI / 2);
    ctx.fillText('d (m)', 0, 0); ctx.restore();

    // Grid lines
    ctx.strokeStyle = 'rgba(150,150,150,0.2)'; ctx.lineWidth = 1;
    for (let i = 1; i <= 5; i++) {
      const gx = graphX + (i / 5) * graphW;
      const gy = graphY + graphH - (i / 5) * graphH;
      ctx.beginPath(); ctx.moveTo(gx, graphY); ctx.lineTo(gx, graphY + graphH); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(graphX, gy); ctx.lineTo(graphX + graphW, gy); ctx.stroke();
    }

    // d = s*t line (full range t=0..10)
    ctx.strokeStyle = 'var(--purple)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(graphX, graphY + graphH);
    const maxT = 10, maxDGraph = speed * maxT;
    ctx.lineTo(graphX + graphW, graphY + graphH - (maxDGraph / maxDGraph) * graphH);
    ctx.stroke();

    // Moving dot
    const dotX = graphX + (time / maxT) * graphW;
    const dotY = graphY + graphH - (distance / (maxDGraph || 1)) * graphH;
    ctx.beginPath(); ctx.arc(dotX, dotY, 6, 0, Math.PI * 2);
    ctx.fillStyle = 'var(--orange)'; ctx.fill();
  }, [speed, time, distance]);

  useEffect(() => { draw(); }, [draw]);

  const badge = (label: string, val: string | number, color: string) => (
    <span style={{ background: color, color: '#fff', borderRadius: 6, padding: '3px 8px', fontSize: 12, fontWeight: 700, margin: '0 4px' }}>
      {label} = {val}
    </span>
  );

  return (
    <div style={{ background: 'var(--surface-1)', borderRadius: 12, padding: 16, maxWidth: 600, margin: '0 auto', fontFamily: 'inherit' }}>
      <h3 style={{ color: 'var(--text-1)', fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Speed, Distance & Time</h3>
      <canvas ref={canvasRef} width={560} height={260} style={{ width: '100%', borderRadius: 8, background: 'var(--surface-2)', display: 'block' }} />
      <div style={{ marginTop: 10 }}>
        <label style={{ color: 'var(--text-2)', fontSize: 13 }}>Speed: {speed} m/s</label>
        <input type="range" min={1} max={20} value={speed} onChange={e => setSpeed(+e.target.value)} style={{ width: '100%' }} />
        <label style={{ color: 'var(--text-2)', fontSize: 13 }}>Time: {time} s</label>
        <input type="range" min={0} max={10} value={time} onChange={e => setTime(+e.target.value)} style={{ width: '100%' }} />
      </div>
      <div style={{ marginTop: 6, textAlign: 'center' }}>
        {badge('d', `${distance} m`, '#f97316')}
        {badge('s', `${speed} m/s`, '#7c3aed')}
        {badge('t', `${time} s`, '#0891b2')}
      </div>
      <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 8, fontSize: 13, color: 'var(--text-1)', textAlign: 'center' }}>
        d = s×t &nbsp;|&nbsp; s = d/t &nbsp;|&nbsp; t = d/s &nbsp;→&nbsp; d = <b style={{ color: 'var(--orange)' }}>{distance} m</b>
      </div>
    </div>
  );
}
