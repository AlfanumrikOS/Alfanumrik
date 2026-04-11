'use client';
import { useState, useEffect, useRef } from 'react';

export default function CrystallizationLab() {
  const [temp, setTemp] = useState(100);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 100);
    return () => clearInterval(id);
  }, []);

  const solubility = 0.2 + (temp / 100) * 0.8;
  const crystallized = Math.max(0, 1 - solubility);
  const particleSpeed = temp / 100;

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const W = canvas.width, H = canvas.height;

    // Beaker
    ctx.strokeStyle = '#888'; ctx.lineWidth = 2;
    ctx.strokeRect(30, 40, 200, 200);
    const waterColor = `rgba(${Math.round(100 + temp * 0.5)}, ${Math.round(160 - temp * 0.2)}, 220, 0.5)`;
    ctx.fillStyle = waterColor;
    ctx.fillRect(32, 42, 196, 196);

    // Dissolved particles (moving fast when hot)
    if (temp > 30) {
      for (let i = 0; i < 20; i++) {
        const angle = (tick * particleSpeed * 0.3 + i * 37) % (Math.PI * 2);
        const r = 30 + (i * 17) % 70;
        const cx = 130 + Math.cos(angle + i) * r * 0.6;
        const cy = 140 + Math.sin(angle * 1.3 + i) * r * 0.4;
        ctx.beginPath(); ctx.arc(cx, cy, 3, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,200,50,${0.4 + particleSpeed * 0.4})`; ctx.fill();
      }
    }

    // Crystal lattice growing from center
    if (crystallized > 0.05) {
      const crystalSize = crystallized * 70;
      ctx.fillStyle = 'rgba(220,230,255,0.8)';
      ctx.strokeStyle = '#8888cc'; ctx.lineWidth = 1;
      for (let r = 0; r < 3 && r * 12 < crystalSize; r++) {
        for (let c = 0; c < 3 && c * 12 < crystalSize; c++) {
          const x = 90 + r * 16 - crystalSize / 2;
          const y = 180 + c * 16 - crystalSize / 2;
          ctx.fillRect(x, y, 12, 12);
          ctx.strokeRect(x, y, 12, 12);
        }
      }
      ctx.fillStyle = '#6666cc'; ctx.font = '11px sans-serif';
      ctx.fillText('Crystal', 100, 230);
    }

    // Solubility curve (right side)
    const cx2 = 290, cy2 = 50, cw = 200, ch = 180;
    ctx.fillStyle = 'var(--surface-1)';
    ctx.fillRect(cx2, cy2, cw, ch);
    ctx.strokeStyle = '#888'; ctx.lineWidth = 1;
    ctx.strokeRect(cx2, cy2, cw, ch);

    ctx.font = '10px sans-serif'; ctx.fillStyle = 'var(--text-2)' || '#999';
    ctx.fillText('Solubility', cx2 + 2, cy2 + 10);
    ctx.fillText('100°', cx2 + 2, cy2 + ch - 2);
    ctx.fillText('20°', cx2 + cw - 25, cy2 + ch - 2);

    ctx.beginPath(); ctx.strokeStyle = 'var(--orange)' || '#f97316'; ctx.lineWidth = 2;
    for (let t2 = 0; t2 <= 100; t2 += 5) {
      const sol = 0.2 + (t2 / 100) * 0.8;
      const px = cx2 + (1 - t2 / 100) * (cw - 20) + 10;
      const py = cy2 + (1 - sol) * (ch - 20) + 10;
      if (t2 === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();

    // Current point on curve
    const dotX = cx2 + (1 - temp / 100) * (cw - 20) + 10;
    const dotY = cy2 + (1 - solubility) * (ch - 20) + 10;
    ctx.beginPath(); ctx.arc(dotX, dotY, 6, 0, Math.PI * 2);
    ctx.fillStyle = temp < 40 ? '#ef4444' : '#3b82f6'; ctx.fill();
    if (temp < 30) {
      ctx.fillStyle = '#ef4444'; ctx.font = 'bold 10px sans-serif';
      ctx.fillText('Supersaturated!', cx2 + 10, cy2 + ch - 20);
    }

    ctx.font = '10px sans-serif'; ctx.fillStyle = '#666';
    ctx.fillText(`Temp: ${temp}°C`, 30, H - 5);

  }, [temp, tick, solubility, crystallized, particleSpeed]);

  return (
    <div style={{ background: 'var(--surface-1)', borderRadius: 12, padding: 16, maxWidth: 600, margin: '0 auto', fontFamily: 'inherit' }}>
      <h3 style={{ color: 'var(--text-1)', fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Crystallization Lab</h3>
      <div style={{ marginBottom: 8 }}>
        <label style={{ fontSize: 12, color: 'var(--text-2)' }}>Temperature: {temp}°C</label>
        <input type="range" min={20} max={100} value={temp} onChange={e => setTemp(+e.target.value)} style={{ width: '100%', marginTop: 4 }} />
      </div>
      <canvas ref={canvasRef} width={520} height={260} style={{ width: '100%', borderRadius: 8, background: 'var(--surface-2)', display: 'block' }} />
      <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 8, fontSize: 13, color: 'var(--text-1)', textAlign: 'center' }}>
        <b style={{ color: 'var(--orange)' }}>Solubility decreases</b> with decreasing temperature (most salts) | Crystals form at {(crystallized * 100).toFixed(0)}%
      </div>
    </div>
  );
}
