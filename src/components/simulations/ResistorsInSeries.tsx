'use client';
import { useState, useRef, useEffect } from 'react';

export default function ResistorsInSeries() {
  const [r1, setR1] = useState(10);
  const [r2, setR2] = useState(15);
  const [r3, setR3] = useState(20);
  const [voltage, setVoltage] = useState(12);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tickRef = useRef(0);
  const rafRef = useRef<number>(0);

  const rTotal = r1 + r2 + r3;
  const I = voltage / rTotal;
  const v1 = I * r1, v2 = I * r2, v3 = I * r3;

  useEffect(() => {
    const dotColors = ['#f97316', '#7c3aed', '#10b981'];
    const loop = () => {
      tickRef.current = (tickRef.current + 1) % 200;
      const canvas = canvasRef.current;
      if (!canvas) { rafRef.current = requestAnimationFrame(loop); return; }
      const ctx = canvas.getContext('2d')!;
      const W = canvas.width, H = canvas.height;
      ctx.clearRect(0, 0, W, H);

      // Circuit path: top wire L→R, right wire down, bottom wire R→L, left wire up
      // Layout: battery at left, R1, R2, R3 across top
      const margin = 40, topY = 80, botY = 220;
      const bx = margin + 20;
      const rx1 = 150, rx2 = 270, rx3 = 390;
      const rw = 60, rh = 28;

      // Draw wires
      ctx.strokeStyle = '#6b7280'; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(bx, topY); ctx.lineTo(W - margin, topY);
      ctx.lineTo(W - margin, botY);
      ctx.lineTo(bx, botY);
      ctx.lineTo(bx, topY);
      ctx.stroke();

      // Battery
      ctx.strokeStyle = '#facc15'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(bx, topY); ctx.lineTo(bx, topY - 15); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(bx - 12, topY - 15); ctx.lineTo(bx + 12, topY - 15); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(bx - 7, topY - 22); ctx.lineTo(bx + 7, topY - 22); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(bx, topY - 22); ctx.lineTo(bx, botY); ctx.stroke();
      ctx.fillStyle = '#facc15'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(`${voltage}V`, bx, topY - 28);

      // Resistors
      const resistors = [[rx1, r1, v1, '#f97316'], [rx2, r2, v2, '#7c3aed'], [rx3, r3, v3, '#10b981']] as [number, number, number, string][];
      resistors.forEach(([x, r, vr, color]) => {
        ctx.fillStyle = color + '33';
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(x - rw / 2, topY - rh / 2, rw, rh, 4);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = color; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(`${r}Ω`, x, topY + 4);
        ctx.fillStyle = 'var(--text-1,#fff)'; ctx.font = '11px sans-serif';
        ctx.fillText(`${vr.toFixed(1)}V`, x, topY - rh / 2 - 6);
      });

      // Animate current dots
      const speed = Math.max(0.5, I * 0.8);
      const numDots = 5;
      // Circuit path segments: top (left to right), right side down, bottom (right to left), left side up
      const pathLen = (W - margin - bx) * 2 + (botY - topY) * 2;
      for (let d = 0; d < numDots; d++) {
        let pos = ((tickRef.current * speed + d * (pathLen / numDots)) % pathLen + pathLen) % pathLen;
        let px = 0, py = 0;
        const topLen = W - margin - bx, sideLen = botY - topY;
        if (pos < topLen) { px = bx + pos; py = topY; }
        else if (pos < topLen + sideLen) { px = W - margin; py = topY + (pos - topLen); }
        else if (pos < topLen * 2 + sideLen) { px = W - margin - (pos - topLen - sideLen); py = botY; }
        else { px = bx; py = botY - (pos - topLen * 2 - sideLen); }
        ctx.beginPath();
        ctx.arc(px, py, 4, 0, Math.PI * 2);
        ctx.fillStyle = dotColors[d % 3];
        ctx.fill();
      }

      // Info
      ctx.fillStyle = 'var(--text-2,#aaa)'; ctx.font = '12px sans-serif'; ctx.textAlign = 'left';
      ctx.fillText(`R_total = ${rTotal}Ω  |  I = ${I.toFixed(3)}A`, margin, H - 10);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [r1, r2, r3, voltage, rTotal, I, v1, v2, v3]);

  return (
    <div style={{ background: 'var(--surface-1)', borderRadius: 12, padding: 16, maxWidth: 600, margin: '0 auto', fontFamily: 'inherit' }}>
      <h3 style={{ color: 'var(--text-1)', fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Resistors in Series</h3>
      <canvas ref={canvasRef} width={560} height={280} style={{ width: '100%', borderRadius: 8, background: 'var(--surface-2)', display: 'block' }} />
      <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {[['R₁', r1, setR1, '#f97316'], ['R₂', r2, setR2, '#7c3aed'], ['R₃', r3, setR3, '#10b981'], ['V', voltage, setVoltage, '#facc15']].map(([label, val, setter, color]) => (
          <div key={label as string}>
            <label style={{ color: color as string, fontSize: 13 }}>{label as string}: {val as number}{label === 'V' ? 'V' : 'Ω'}</label>
            <input type="range" min={label === 'V' ? 6 : 1} max={label === 'V' ? 24 : 50} value={val as number} onChange={e => (setter as (v: number) => void)(+e.target.value)} style={{ width: '100%' }} />
          </div>
        ))}
      </div>
      <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 8, fontSize: 13, color: 'var(--text-1)', textAlign: 'center' }}>
        R_total = R₁+R₂+R₃ = <b style={{ color: 'var(--orange,#f97316)' }}>{rTotal}Ω</b> &nbsp;|&nbsp; V = V₁+V₂+V₃ = <b style={{ color: 'var(--purple,#7c3aed)' }}>{(v1 + v2 + v3).toFixed(1)}V</b>
      </div>
    </div>
  );
}
