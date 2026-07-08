'use client';
import { useState, useRef, useEffect, useCallback } from 'react';

export default function EcosystemBalance() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const tRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [prey0, setPrey0] = useState(200);
  const [pred0, setPred0] = useState(20);
  const [birthRate, setBirthRate] = useState(0.3);
  const [predRate, setPredRate] = useState(0.025);
  const [deathRate, setDeathRate] = useState(0.12);
  const histRef = useRef<{ prey: number; pred: number }[]>([{ prey: 200, pred: 20 }]);
  const stateRef = useRef({ prey: 200, pred: 20 });

  const reset = useCallback(() => {
    stateRef.current = { prey: prey0, pred: pred0 };
    histRef.current = [{ prey: prey0, pred: pred0 }];
    tRef.current = 0;
  }, [prey0, pred0]);

  useEffect(() => { reset(); }, [reset]);

  const step = useCallback(() => {
    const { prey, pred } = stateRef.current;
    const dt = 0.05;
    const np = Math.max(0, prey + (birthRate * prey - predRate * prey * pred) * dt);
    const nd = Math.max(0, pred + (predRate * prey * pred * 0.1 - deathRate * pred) * dt);
    stateRef.current = { prey: np, pred: nd };
    histRef.current = [...histRef.current.slice(-280), { prey: np, pred: nd }];
  }, [birthRate, predRate, deathRate]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#F1F8E9'; ctx.fillRect(0, 0, W, H);

    const hist = histRef.current;
    const maxPop = Math.max(500, ...hist.map(h => Math.max(h.prey, h.pred)));
    const chartH = H - 60;
    const chartW = W - 60;

    ctx.strokeStyle = '#ccc'; ctx.lineWidth = 1;
    [0, 0.25, 0.5, 0.75, 1].forEach(f => {
      const y = 10 + chartH * (1 - f);
      ctx.beginPath(); ctx.moveTo(50, y); ctx.lineTo(W - 10, y); ctx.stroke();
      ctx.fillStyle = '#999'; ctx.font = '10px sans-serif'; ctx.textAlign = 'right';
      ctx.fillText(Math.round(maxPop * f).toString(), 46, y + 4);
    });

    ['prey', 'pred'].forEach((key, ki) => {
      ctx.beginPath();
      hist.forEach((h, i) => {
        const x = 50 + (i / (hist.length - 1 || 1)) * chartW;
        const val = key === 'prey' ? h.prey : h.pred;
        const y = 10 + chartH * (1 - val / maxPop);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.strokeStyle = ki === 0 ? '#66BB6A' : '#EF5350';
      ctx.lineWidth = 2; ctx.stroke();
    });

    ctx.fillStyle = '#66BB6A'; ctx.fillRect(60, H - 42, 12, 12); ctx.fillStyle = '#333'; ctx.font = '11px sans-serif'; ctx.textAlign = 'left'; ctx.fillText(`Prey (rabbits): ${Math.round(stateRef.current.prey)}`, 76, H - 32);
    ctx.fillStyle = '#EF5350'; ctx.fillRect(220, H - 42, 12, 12); ctx.fillStyle = '#333'; ctx.fillText(`Predators (foxes): ${Math.round(stateRef.current.pred)}`, 236, H - 32);
    ctx.fillStyle = '#aaa'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('Time →', W / 2, H - 8);
  }, []);

  useEffect(() => {
    if (!playing) { draw(); return; }
    const loop = () => { step(); draw(); animRef.current = requestAnimationFrame(loop); };
    animRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animRef.current);
  }, [playing, step, draw]);

  return (
    <div style={{ background: 'var(--surface-1)', borderRadius: 12, padding: 16, maxWidth: 600, margin: '0 auto', fontFamily: 'inherit' }}>
      <h3 style={{ color: 'var(--text-1)', fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Ecosystem Balance (Lotka-Volterra)</h3>
      <canvas ref={canvasRef} width={560} height={220} style={{ width: '100%', borderRadius: 8, display: 'block' }} />
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {[
          ['Prey birth rate', birthRate, setBirthRate, 0.1, 0.5, 0.05],
          ['Predation rate', predRate, setPredRate, 0.01, 0.05, 0.005],
          ['Predator death rate', deathRate, setDeathRate, 0.05, 0.2, 0.01],
        ].map(([lbl, val, setter, mn, mx, step2]) => (
          <div key={lbl as string} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
            <span style={{ width: 120, color: 'var(--text-2)' }}>{lbl as string}</span>
            <input type="range" min={mn as number} max={mx as number} step={step2 as number} value={val as number}
              onChange={e => { (setter as (v: number) => void)(+e.target.value); reset(); }} style={{ flex: 1 }} />
            <span style={{ width: 40, color: 'var(--text-1)', fontWeight: 600 }}>{(val as number).toFixed(3)}</span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 8, display: 'flex', gap: 8, justifyContent: 'center' }}>
        <button onClick={() => setPlaying(p => !p)} style={{ padding: '6px 16px', background: playing ? '#f44336' : '#4CAF50', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>
          {playing ? 'Pause' : 'Start'}
        </button>
        <button onClick={() => { setPlaying(false); reset(); draw(); }} style={{ padding: '6px 16px', background: 'var(--orange)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>Reset</button>
      </div>
      <div style={{ marginTop: 8, padding: '8px 12px', background: '#E8F5E9', borderRadius: 8, fontSize: 13, color: '#2E7D32', borderLeft: '3px solid #4CAF50' }}>
        Lotka-Volterra: <strong>populations cycle out of phase</strong> — prey rises → predators rise → prey falls → predators fall
      </div>
    </div>
  );
}
