'use client';
import { useState, useRef, useEffect } from 'react';

export default function ChemicalKinetics() {
  const [A0, setA0] = useState(3);
  const [k, setK] = useState(0.5);
  const [temp, setTemp] = useState(298);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const kEffective = k * Math.exp((temp - 298) / 100);
  const halfLife = Math.log(2) / kEffective;

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const pad = { l: 50, r: 20, t: 20, b: 40 };
    const pw = W - pad.l - pad.r;
    const ph = H - pad.t - pad.b;
    const tMax = 10;

    // Axes
    ctx.strokeStyle = '#888'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad.l, pad.t); ctx.lineTo(pad.l, pad.t + ph); ctx.lineTo(pad.l + pw, pad.t + ph); ctx.stroke();

    // Grid
    ctx.strokeStyle = 'rgba(150,150,150,0.2)';
    for (let i = 1; i <= 5; i++) {
      const y = pad.t + ph * (1 - i / 5);
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + pw, y); ctx.stroke();
    }

    // Labels
    ctx.fillStyle = '#888'; ctx.font = '11px sans-serif';
    ctx.fillText('[A]', 2, pad.t + ph / 3);
    ctx.fillText('[B]', 2, pad.t + ph * 2 / 3 + 10);
    ctx.fillText('Time (s) →', pad.l + pw / 2 - 30, H - 5);
    for (let i = 0; i <= 5; i++) {
      ctx.fillText((i * 2).toString(), pad.l + (i / 5) * pw - 4, pad.t + ph + 14);
    }
    for (let i = 0; i <= 5; i++) {
      ctx.fillText((A0 * i / 5).toFixed(1), 4, pad.t + ph * (1 - i / 5) + 4);
    }

    // [A] decay curve
    ctx.beginPath(); ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 2;
    for (let px = 0; px <= pw; px++) {
      const t = (px / pw) * tMax;
      const a = A0 * Math.exp(-kEffective * t);
      const y = pad.t + ph * (1 - a / A0);
      px === 0 ? ctx.moveTo(pad.l + px, y) : ctx.lineTo(pad.l + px, y);
    }
    ctx.stroke();

    // [B] growth curve
    ctx.beginPath(); ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 2;
    for (let px = 0; px <= pw; px++) {
      const t = (px / pw) * tMax;
      const b = A0 * (1 - Math.exp(-kEffective * t));
      const y = pad.t + ph * (1 - b / A0);
      px === 0 ? ctx.moveTo(pad.l + px, y) : ctx.lineTo(pad.l + px, y);
    }
    ctx.stroke();

    // Half-life marker
    const t12 = halfLife;
    if (t12 < tMax) {
      const hx = pad.l + (t12 / tMax) * pw;
      const hy = pad.t + ph * (1 - 0.5);
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = 'rgba(150,150,150,0.5)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(hx, pad.t + ph); ctx.lineTo(hx, hy); ctx.lineTo(pad.l, hy); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#888'; ctx.font = '10px sans-serif';
      ctx.fillText(`t½=${t12.toFixed(2)}s`, hx + 3, hy - 3);
    }

    // Legend
    ctx.fillStyle = '#ef4444'; ctx.fillRect(pad.l + 5, pad.t + 5, 12, 3);
    ctx.fillStyle = '#888'; ctx.font = '10px sans-serif'; ctx.fillText('[A] Reactant', pad.l + 20, pad.t + 12);
    ctx.fillStyle = '#3b82f6'; ctx.fillRect(pad.l + 5, pad.t + 18, 12, 3);
    ctx.fillStyle = '#888'; ctx.fillText('[B] Product', pad.l + 20, pad.t + 26);

  }, [A0, k, temp, kEffective, halfLife]);

  return (
    <div style={{ background: 'var(--surface-1)', borderRadius: 12, padding: 16, maxWidth: 600, margin: '0 auto', fontFamily: 'inherit' }}>
      <h3 style={{ color: 'var(--text-1)', fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Chemical Kinetics</h3>
      <div style={{ display: 'flex', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 140 }}>
          <label style={{ fontSize: 12, color: 'var(--text-2)' }}>[A]₀ = {A0} mol/L</label>
          <input type="range" min={1} max={5} step={0.1} value={A0} onChange={e => setA0(+e.target.value)} style={{ width: '100%' }} />
        </div>
        <div style={{ flex: 1, minWidth: 140 }}>
          <label style={{ fontSize: 12, color: 'var(--text-2)' }}>Rate constant k = {k.toFixed(1)}</label>
          <input type="range" min={0.1} max={2} step={0.1} value={k} onChange={e => setK(+e.target.value)} style={{ width: '100%' }} />
        </div>
        <div style={{ flex: 1, minWidth: 140 }}>
          <label style={{ fontSize: 12, color: 'var(--text-2)' }}>Temperature = {temp} K</label>
          <input type="range" min={250} max={400} step={5} value={temp} onChange={e => setTemp(+e.target.value)} style={{ width: '100%' }} />
        </div>
      </div>
      <canvas ref={canvasRef} width={540} height={240} style={{ width: '100%', borderRadius: 8, background: 'var(--surface-2)', display: 'block' }} />
      <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, padding: '6px 10px', background: 'var(--surface-2)', borderRadius: 8, fontSize: 12 }}>
          Effective k: <b style={{ color: 'var(--orange)' }}>{kEffective.toFixed(3)}</b>
        </div>
        <div style={{ flex: 1, padding: '6px 10px', background: 'var(--surface-2)', borderRadius: 8, fontSize: 12 }}>
          t½: <b style={{ color: 'var(--orange)' }}>{halfLife.toFixed(2)} s</b>
        </div>
        <div style={{ flex: 1, padding: '6px 10px', background: 'var(--surface-2)', borderRadius: 8, fontSize: 12 }}>
          Initial rate: <b style={{ color: 'var(--orange)' }}>{(kEffective * A0).toFixed(3)} mol/L/s</b>
        </div>
      </div>
      <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 8, fontSize: 13, color: 'var(--text-1)', textAlign: 'center' }}>
        Formula: <b style={{ color: 'var(--orange)' }}>Rate = k[A]ⁿ, t½ = 0.693/k</b>
      </div>
    </div>
  );
}
