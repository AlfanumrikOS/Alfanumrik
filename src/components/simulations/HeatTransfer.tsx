'use client';
import { useState, useRef, useEffect, useCallback } from 'react';

type Mode = 'conduction' | 'convection' | 'radiation';

export default function HeatTransfer() {
  const [mode, setMode] = useState<Mode>('conduction');
  const [tempDiff, setTempDiff] = useState(60);
  const [radDist, setRadDist] = useState(150);
  const [step, setStep] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const tRef = useRef(0);

  const draw = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const w = canvas.width, h = canvas.height;
    tRef.current += 0.05;
    const t = tRef.current;
    ctx.clearRect(0, 0, w, h);

    if (mode === 'conduction') {
      const rodX = 60, rodW = w - 120, rodH = 40, rodY = h / 2 - 20;
      const grad = ctx.createLinearGradient(rodX, 0, rodX + rodW, 0);
      grad.addColorStop(0, `hsl(${20 + (100 - tempDiff) * 0.3}, 90%, 55%)`);
      grad.addColorStop(1, `hsl(210, 70%, 60%)`);
      ctx.fillStyle = grad; ctx.fillRect(rodX, rodY, rodW, rodH);
      ctx.strokeStyle = '#888'; ctx.lineWidth = 1.5; ctx.strokeRect(rodX, rodY, rodW, rodH);
      // particles
      for (let i = 0; i < 6; i++) {
        const px = rodX + ((t * 40 * (tempDiff / 100) + i * (rodW / 6)) % rodW);
        ctx.beginPath(); ctx.arc(px, rodY + rodH / 2, 4, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,200,50,0.85)'; ctx.fill();
      }
      ctx.fillStyle = '#ef4444'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(`Hot (${100}°C)`, rodX + 30, rodY - 8);
      ctx.fillStyle = '#3b82f6';
      ctx.fillText(`Cold (${100 - tempDiff}°C)`, rodX + rodW - 30, rodY - 8);
    }

    if (mode === 'convection') {
      const bx = 80, by = 40, bw = w - 160, bh = h - 100;
      ctx.strokeStyle = '#888'; ctx.lineWidth = 2; ctx.strokeRect(bx, by, bw, bh);
      const fluidGrad = ctx.createLinearGradient(0, by, 0, by + bh);
      fluidGrad.addColorStop(0, 'rgba(100,180,255,0.3)');
      fluidGrad.addColorStop(1, 'rgba(255,120,50,0.3)');
      ctx.fillStyle = fluidGrad; ctx.fillRect(bx, by, bw, bh);
      // burner
      ctx.fillStyle = '#f97316';
      for (let i = 0; i < 5; i++) {
        ctx.beginPath();
        ctx.arc(bx + 40 + i * 30, by + bh + 10, 8, Math.PI, 0);
        ctx.fill();
      }
      // circulation arrows (8 points in oval)
      const cx2 = bx + bw / 2, cy2 = by + bh / 2;
      const pts = 8;
      for (let i = 0; i < pts; i++) {
        const a = ((i / pts) * Math.PI * 2) + t * 0.5;
        const nx = cx2 + Math.cos(a) * (bw * 0.35);
        const ny = cy2 + Math.sin(a) * (bh * 0.35);
        const na = ((( i + 0.5) / pts) * Math.PI * 2) + t * 0.5;
        const nx2 = cx2 + Math.cos(na) * (bw * 0.35);
        const ny2 = cy2 + Math.sin(na) * (bh * 0.35);
        const col = ny > cy2 ? '#ef4444' : '#3b82f6';
        ctx.strokeStyle = col; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(nx, ny); ctx.lineTo(nx2, ny2); ctx.stroke();
      }
      ctx.fillStyle = 'var(--text-2)'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('Hot fluid rises, cool fluid sinks', cx2, by - 8);
    }

    if (mode === 'radiation') {
      const sx = 60, sy = h / 2;
      ctx.beginPath(); ctx.arc(sx, sy, 28, 0, Math.PI * 2);
      ctx.fillStyle = '#fbbf24'; ctx.fill();
      ctx.font = '11px sans-serif'; ctx.fillStyle = 'var(--text-2)'; ctx.textAlign = 'center';
      ctx.fillText('Sun', sx, sy + 42);
      // object
      const ox = 60 + radDist;
      ctx.fillStyle = '#6366f1'; ctx.fillRect(ox, sy - 20, 30, 40);
      ctx.fillStyle = 'var(--text-2)'; ctx.fillText('Object', ox + 15, sy + 42);
      // wavy lines
      const waves = 5;
      const thickness = Math.max(1, 4 - radDist / 80);
      for (let wi = 0; wi < waves; wi++) {
        const baseY = sy - 20 + (wi * 10);
        ctx.beginPath(); ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = thickness;
        const segCount = Math.floor((radDist - 30) / 12);
        for (let s = 0; s <= segCount; s++) {
          const px = sx + 30 + s * 12;
          const py = baseY + Math.sin((s + t * 2) * 1.5) * 4;
          s === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
    }

    rafRef.current = requestAnimationFrame(draw);
  }, [mode, tempDiff, radDist]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [draw]);

  const formulaMap: Record<Mode, string> = {
    conduction: 'Q/t = kA(T₁−T₂)/L',
    convection: 'ρ_hot < ρ_cold → hot fluid rises',
    radiation: 'E = σT⁴  (Stefan-Boltzmann)',
  };

  const btnStyle = (m: Mode) => ({
    padding: '6px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12,
    background: mode === m ? 'var(--orange)' : 'var(--surface-2)', color: mode === m ? '#fff' : 'var(--text-1)',
  });

  return (
    <div style={{ background: 'var(--surface-1)', borderRadius: 12, padding: 16, maxWidth: 600, margin: '0 auto', fontFamily: 'inherit' }}>
      <h3 style={{ color: 'var(--text-1)', fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Heat Transfer</h3>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <button style={btnStyle('conduction')} onClick={() => setMode('conduction')}>Conduction</button>
        <button style={btnStyle('convection')} onClick={() => setMode('convection')}>Convection</button>
        <button style={btnStyle('radiation')} onClick={() => setMode('radiation')}>Radiation</button>
      </div>
      <canvas ref={canvasRef} width={560} height={240} style={{ width: '100%', borderRadius: 8, background: 'var(--surface-2)', display: 'block' }} />
      <div style={{ marginTop: 10 }}>
        {mode === 'conduction' && (<>
          <label style={{ color: 'var(--text-2)', fontSize: 13 }}>Temperature Difference: {tempDiff}°C</label>
          <input type="range" min={10} max={100} value={tempDiff} onChange={e => setTempDiff(+e.target.value)} style={{ width: '100%' }} />
        </>)}
        {mode === 'radiation' && (<>
          <label style={{ color: 'var(--text-2)', fontSize: 13 }}>Distance from Sun: {radDist} px</label>
          <input type="range" min={60} max={350} value={radDist} onChange={e => setRadDist(+e.target.value)} style={{ width: '100%' }} />
        </>)}
        {mode === 'convection' && <p style={{ color: 'var(--text-2)', fontSize: 12, margin: 0 }}>Density difference drives fluid circulation.</p>}
      </div>
      <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 8, fontSize: 13, color: 'var(--text-1)', textAlign: 'center' }}>
        <b style={{ color: 'var(--orange)' }}>{formulaMap[mode]}</b>
      </div>
    </div>
  );
}
