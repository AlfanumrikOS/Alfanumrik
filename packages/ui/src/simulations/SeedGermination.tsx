'use client';
import { useState, useRef, useEffect } from 'react';

const STAGES = [
  { name: 'Dormant Seed', desc: 'Seed is dry, metabolism very slow. Hard seed coat protects embryo.' },
  { name: 'Imbibition', desc: 'Seed absorbs water → seed coat softens → enzymes activated.' },
  { name: 'Radicle Emerges', desc: 'Radicle (primary root) breaks out, grows downward (geotropism).' },
  { name: 'Shoot Emerges', desc: 'Plumule pushes up through soil. Hypocotyl arches upward.' },
  { name: 'Seedling', desc: 'First leaves (cotyledons) open. Photosynthesis begins. Independent!' },
];

export default function SeedGermination() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stage, setStage] = useState(0);
  const [water, setWater] = useState(60);
  const [temp, setTemp] = useState(25);
  const [air, setAir] = useState(70);

  const waterOk = water >= 40;
  const tempOk = temp >= 15 && temp <= 35;
  const airOk = air >= 40;
  const progress = Math.round(((waterOk ? 33 : water * 0.5) + (tempOk ? 33 : (temp < 15 ? temp * 2 : (40 - temp))) + (airOk ? 34 : air * 0.5)) * Math.min(1, stage / 4));
  const allMet = waterOk && tempOk && airOk;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    ctx.fillStyle = '#87CEEB';
    ctx.fillRect(0, 0, W, H * 0.55);
    ctx.fillStyle = '#8B6914';
    ctx.fillRect(0, H * 0.55, W, H * 0.45);
    ctx.fillStyle = '#6B4F12';
    ctx.fillRect(0, H * 0.55, W, 4);

    if (stage >= 1) {
      ctx.fillStyle = 'rgba(100,149,237,0.3)';
      for (let i = 0; i < 8; i++) ctx.fillRect(W * 0.3 + i * 18, H * 0.57, 8, H * 0.43);
    }

    const cx = W / 2, sy = H * 0.6;
    if (stage === 0) {
      ctx.beginPath(); ctx.ellipse(cx, sy + 20, 20, 14, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#D4A017'; ctx.fill(); ctx.strokeStyle = '#8B6914'; ctx.lineWidth = 2; ctx.stroke();
    }
    if (stage === 1) {
      ctx.beginPath(); ctx.ellipse(cx, sy + 18, 22, 16, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#C8D8A0'; ctx.fill(); ctx.strokeStyle = '#8B6914'; ctx.lineWidth = 2; ctx.stroke();
      ctx.strokeStyle = '#87CEEB'; ctx.lineWidth = 2;
      for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.arc(cx - 20 + i * 10, sy + 20, 3, 0, Math.PI * 2); ctx.fillStyle = '#87CEEB66'; ctx.fill(); }
    }
    if (stage >= 2) {
      ctx.beginPath(); ctx.moveTo(cx, sy + 10); ctx.quadraticCurveTo(cx + 8, sy + 40, cx + 4, sy + 60);
      ctx.strokeStyle = '#D4A017'; ctx.lineWidth = 3; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx + 4, sy + 60); ctx.lineTo(cx - 8, sy + 80);
      ctx.moveTo(cx + 4, sy + 60); ctx.lineTo(cx + 14, sy + 78);
      ctx.strokeStyle = '#A0522D'; ctx.lineWidth = 2; ctx.stroke();
    }
    if (stage >= 3) {
      ctx.beginPath(); ctx.moveTo(cx, sy + 10); ctx.quadraticCurveTo(cx - 8, sy - 15, cx - 4, H * 0.45);
      ctx.strokeStyle = '#4CAF50'; ctx.lineWidth = 4; ctx.stroke();
    }
    if (stage >= 4) {
      ctx.beginPath(); ctx.moveTo(cx - 4, H * 0.45); ctx.lineTo(cx - 4, H * 0.15);
      ctx.strokeStyle = '#4CAF50'; ctx.lineWidth = 4; ctx.stroke();
      ctx.beginPath(); ctx.ellipse(cx - 18, H * 0.2, 22, 12, -0.5, 0, Math.PI * 2);
      ctx.fillStyle = '#81C784'; ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx + 10, H * 0.2, 22, 12, 0.5, 0, Math.PI * 2);
      ctx.fillStyle = '#66BB6A'; ctx.fill();
      ctx.font = '12px sans-serif'; ctx.fillStyle = '#1B5E20'; ctx.fillText('☀️', cx - 8, H * 0.1);
    }
    ctx.font = 'bold 13px sans-serif'; ctx.fillStyle = 'var(--text-1)';
    ctx.fillText(STAGES[stage].name, 16, 24);
  }, [stage]);

  return (
    <div style={{ background: 'var(--surface-1)', borderRadius: 12, padding: 16, maxWidth: 600, margin: '0 auto', fontFamily: 'inherit' }}>
      <h3 style={{ color: 'var(--text-1)', fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Seed Germination</h3>
      <canvas ref={canvasRef} width={560} height={240} style={{ width: '100%', borderRadius: 8, display: 'block' }} />
      <div style={{ marginTop: 8, display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap' }}>
        {STAGES.map((s, i) => (
          <button key={i} onClick={() => setStage(i)} style={{ padding: '4px 10px', background: stage === i ? 'var(--orange)' : 'var(--surface-2)', color: stage === i ? '#fff' : 'var(--text-1)', border: '1px solid #ddd', borderRadius: 6, cursor: 'pointer', fontSize: 11 }}>{i + 1}. {s.name.split(' ')[0]}</button>
        ))}
      </div>
      <div style={{ marginTop: 8, padding: '6px 10px', background: 'var(--surface-2)', borderRadius: 8, fontSize: 12, color: 'var(--text-2)' }}>{STAGES[stage].desc}</div>
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {[['Water', water, setWater, waterOk, '%', 0, 100], ['Temperature', temp, setTemp, tempOk, '°C', 5, 40], ['Air (O₂)', air, setAir, airOk, '%', 0, 100]].map(([lbl, val, setter, ok, unit, mn, mx]) => (
          <div key={lbl as string} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
            <span style={{ width: 80, color: 'var(--text-2)' }}>{lbl as string}</span>
            <input type="range" min={mn as number} max={mx as number} value={val as number} onChange={e => (setter as (v: number) => void)(+e.target.value)} style={{ flex: 1 }} />
            <span style={{ width: 50, color: ok ? '#4CAF50' : '#f44336', fontWeight: 600 }}>{val as number}{unit as string} {ok ? '✓' : '✗'}</span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 8 }}>
        <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 4 }}>Germination Progress: {allMet ? stage * 25 : '0 (conditions not met)'}%</div>
        <div style={{ height: 10, background: '#eee', borderRadius: 6 }}>
          <div style={{ height: '100%', width: `${allMet ? stage * 25 : 0}%`, background: 'var(--orange)', borderRadius: 6, transition: 'width 0.4s' }} />
        </div>
        {!allMet && <div style={{ fontSize: 11, color: '#f44336', marginTop: 4 }}>Limiting: {[!waterOk && 'Water', !tempOk && 'Temperature', !airOk && 'Air'].filter(Boolean).join(', ')}</div>}
      </div>
      <div style={{ marginTop: 8, padding: '8px 12px', background: '#E8F5E9', borderRadius: 8, fontSize: 13, color: '#2E7D32', borderLeft: '3px solid #4CAF50' }}>
        Seeds need <strong>water + warmth + air</strong> to germinate — but <strong>NOT light</strong>
      </div>
    </div>
  );
}
