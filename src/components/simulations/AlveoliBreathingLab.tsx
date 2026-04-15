'use client';
import { useState, useRef, useEffect, useCallback } from 'react';

export default function AlveoliBreathingLab() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const tRef = useRef(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [bpm, setBpm] = useState(15);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const period = (60 / bpm) * 60;
    const phase = (tRef.current % period) / period;
    const inhale = phase < 0.5;
    const t = inhale ? phase * 2 : (phase - 0.5) * 2;
    const ease = inhale ? t * t : 1 - (1 - t) * (1 - t);

    ctx.fillStyle = '#E3F2FD';
    ctx.fillRect(0, 0, W, H);

    const lungW = 80 + ease * 30;
    const lungH = 110 + ease * 30;
    [[W / 2 - 90, H / 2 - 10], [W / 2 + 10, H / 2 - 10]].forEach(([lx, ly]) => {
      ctx.beginPath();
      ctx.ellipse(lx + 45, ly + 55, lungW / 2, lungH / 2, 0, 0, Math.PI * 2);
      ctx.fillStyle = inhale ? '#EF9A9A' : '#FFCC80';
      ctx.fill();
      ctx.strokeStyle = '#E57373';
      ctx.lineWidth = 2;
      ctx.stroke();
    });

    const diagY = H / 2 + 70 + (inhale ? ease * 20 : (1 - ease) * 20);
    ctx.beginPath();
    ctx.moveTo(W / 2 - 130, diagY);
    ctx.quadraticCurveTo(W / 2, diagY + (inhale ? 18 : -8), W / 2 + 130, diagY);
    ctx.strokeStyle = '#795548';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.font = '11px sans-serif';
    ctx.fillStyle = '#5D4037';
    ctx.fillText('Diaphragm', W / 2 - 32, diagY + 16);

    const alvCX = W / 2 - 20, alvCY = H / 2 - 20;
    for (let i = 0; i < 5; i++) {
      const ax = alvCX + (i % 3 - 1) * 28;
      const ay = alvCY + Math.floor(i / 3) * 28;
      ctx.beginPath();
      ctx.arc(ax, ay, 14, 0, Math.PI * 2);
      ctx.fillStyle = '#FFCDD2';
      ctx.fill();
      ctx.strokeStyle = '#EF9A9A';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    const dotCount = 6;
    for (let i = 0; i < dotCount; i++) {
      const angle = (i / dotCount) * Math.PI * 2 + tRef.current * 0.08 * speed;
      const r = 22 + ease * 8;
      const dx = alvCX + r * Math.cos(angle);
      const dy = alvCY + r * Math.sin(angle) * 0.6;
      const isO2 = i % 2 === 0;
      ctx.beginPath();
      ctx.arc(dx, dy, 5, 0, Math.PI * 2);
      ctx.fillStyle = isO2 ? '#1565C0' : '#C62828';
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 6px sans-serif';
      ctx.fillText(isO2 ? 'O₂' : 'CO₂', dx - 7, dy + 2);
    }

    ctx.fillStyle = '#333';
    ctx.font = '12px sans-serif';
    ctx.fillText(inhale ? 'Inhaling ↓' : 'Exhaling ↑', 16, 24);
    ctx.fillText(`${bpm} breaths/min`, 16, 42);
    ctx.fillStyle = '#1565C0';
    ctx.fillRect(W - 100, 12, 10, 10); ctx.fillText('O₂ (in)', W - 85, 22);
    ctx.fillStyle = '#C62828';
    ctx.fillRect(W - 100, 28, 10, 10); ctx.fillText('CO₂ (out)', W - 85, 38);

    tRef.current += speed;
  }, [speed, bpm]);

  useEffect(() => {
    if (!playing) return;
    const loop = () => { draw(); animRef.current = requestAnimationFrame(loop); };
    animRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animRef.current);
  }, [playing, draw]);

  return (
    <div style={{ background: 'var(--surface-1)', borderRadius: 12, padding: 16, maxWidth: 600, margin: '0 auto', fontFamily: 'inherit' }}>
      <h3 style={{ color: 'var(--text-1)', fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Alveoli Breathing Lab</h3>
      <canvas ref={canvasRef} width={560} height={240} style={{ width: '100%', borderRadius: 8, display: 'block', background: '#E3F2FD' }} />
      <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center' }}>
        <button onClick={() => setPlaying(p => !p)} style={{ padding: '6px 16px', background: playing ? '#f44336' : '#4CAF50', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>
          {playing ? 'Pause' : 'Play'}
        </button>
        <label style={{ fontSize: 12, color: 'var(--text-2)' }}>Speed: {speed.toFixed(1)}x
          <input type="range" min={0.5} max={2} step={0.1} value={speed} onChange={e => setSpeed(+e.target.value)} style={{ marginLeft: 6, width: 80 }} />
        </label>
        <label style={{ fontSize: 12, color: 'var(--text-2)' }}>Rate: {bpm} /min
          <input type="range" min={12} max={20} step={1} value={bpm} onChange={e => setBpm(+e.target.value)} style={{ marginLeft: 6, width: 80 }} />
        </label>
      </div>
      <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, fontSize: 12, color: 'var(--text-2)' }}>
        <span>Tidal volume: 500 mL</span><span>O₂ inhaled: 21%</span>
        <span>O₂ exhaled: 16%</span><span>CO₂ inhaled: 0.04% → exhaled: 4%</span>
      </div>
      <div style={{ marginTop: 8, padding: '8px 12px', background: '#E3F2FD', borderRadius: 8, fontSize: 13, color: '#1565C0', borderLeft: '3px solid #1565C0' }}>
        O₂ diffuses into blood, CO₂ diffuses out — driven by <strong>concentration gradient</strong>
      </div>
    </div>
  );
}
