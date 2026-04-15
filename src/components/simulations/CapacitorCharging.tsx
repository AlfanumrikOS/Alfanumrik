'use client';
import { useState, useRef, useEffect, useCallback } from 'react';

export default function CapacitorCharging() {
  const [R, setR] = useState(47);
  const [C, setC] = useState(47);
  const [V0, setV0] = useState(12);
  const [tSlider, setTSlider] = useState(1);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const tau = (R * 1000) * (C * 1e-6); // seconds

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#111827';
    ctx.fillRect(0, 0, W, H);

    const gLeft = 20, gRight = W - 20, gTop = 20, gBot = H - 40;
    const gW = gRight - gLeft, gH = gBot - gTop;
    const tMax = 5 * tau;
    const tNow = (tSlider / 100) * tMax;
    const Vc_now = V0 * (1 - Math.exp(-tNow / tau));
    const I_now = (V0 / (R * 1000)) * Math.exp(-tNow / tau);

    // Axes
    ctx.strokeStyle = '#4b5563';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(gLeft, gTop);
    ctx.lineTo(gLeft, gBot);
    ctx.lineTo(gRight, gBot);
    ctx.stroke();

    // Grid lines
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = '#1f2937';
    for (let i = 1; i <= 4; i++) {
      const y = gBot - (i / 4) * gH;
      ctx.beginPath(); ctx.moveTo(gLeft, y); ctx.lineTo(gRight, y); ctx.stroke();
    }
    ctx.setLineDash([]);

    // V0 dashed line
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = '#6b7280';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(gLeft, gTop);
    ctx.lineTo(gRight, gTop);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#6b7280';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`V₀=${V0}V`, gLeft + 2, gTop - 3);

    // Vc(t) curve
    ctx.beginPath();
    ctx.strokeStyle = '#f97316';
    ctx.lineWidth = 2.5;
    for (let px = 0; px <= gW; px++) {
      const t = (px / gW) * tMax;
      const v = V0 * (1 - Math.exp(-t / tau));
      const x = gLeft + px;
      const y = gBot - (v / V0) * gH;
      px === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();

    // I(t) curve (scaled)
    const Imax = V0 / (R * 1000);
    ctx.beginPath();
    ctx.strokeStyle = '#7c3aed';
    ctx.lineWidth = 1.5;
    for (let px = 0; px <= gW; px++) {
      const t = (px / gW) * tMax;
      const i = Imax * Math.exp(-t / tau);
      const x = gLeft + px;
      const y = gBot - (i / Imax) * gH;
      px === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Time marker dot
    const dotX = gLeft + (tNow / tMax) * gW;
    const dotY = gBot - (Vc_now / V0) * gH;
    ctx.beginPath();
    ctx.arc(dotX, dotY, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#f97316';
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${Vc_now.toFixed(2)}V`, dotX, dotY - 10);

    // Axis labels
    ctx.fillStyle = '#9ca3af';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Time →', gLeft + gW / 2, H - 5);
    ctx.save();
    ctx.translate(12, gTop + gH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('Voltage (V)', 0, 0);
    ctx.restore();

    // tau markers
    for (let k = 1; k <= 5; k++) {
      const x = gLeft + (k / 5) * gW;
      ctx.fillStyle = '#6b7280';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${k}τ`, x, gBot + 12);
    }

    // Legend
    ctx.fillStyle = '#f97316';
    ctx.fillText('— Vc(t)', gRight - 80, gTop + 14);
    ctx.fillStyle = '#7c3aed';
    ctx.fillText('— I(t)', gRight - 80, gTop + 28);

    // Current info
    ctx.fillStyle = '#9ca3af';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`I(t)=${(I_now * 1000).toFixed(3)}mA`, gRight - 2, gBot - 5);
  }, [R, C, V0, tau, tSlider]);

  useEffect(() => { draw(); }, [draw]);

  return (
    <div style={{ background: 'var(--surface-1)', borderRadius: 12, padding: 16, maxWidth: 600, margin: '0 auto', fontFamily: 'inherit' }}>
      <h3 style={{ color: 'var(--text-1)', fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Capacitor Charging (RC Circuit)</h3>
      <canvas ref={canvasRef} width={540} height={240} style={{ width: '100%', borderRadius: 8, display: 'block' }} />
      <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
        {[['R', R, setR, 1, 100, 'kΩ'], ['C', C, setC, 1, 100, 'μF'], ['V₀', V0, setV0, 5, 20, 'V']].map(([label, val, setter, mn, mx, unit]) => (
          <div key={label as string}>
            <label style={{ color: 'var(--text-2)', fontSize: 13 }}>{label as string}: {val as number}{unit as string}</label>
            <input type="range" min={mn as number} max={mx as number} value={val as number} onChange={e => (setter as (n: number) => void)(+e.target.value)} style={{ width: '100%' }} />
          </div>
        ))}
      </div>
      <div style={{ marginTop: 6 }}>
        <label style={{ color: 'var(--text-2)', fontSize: 13 }}>Time: {((tSlider / 100) * 5).toFixed(2)}τ</label>
        <input type="range" min={0} max={100} value={tSlider} onChange={e => setTSlider(+e.target.value)} style={{ width: '100%' }} />
      </div>
      <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 8, fontSize: 13, color: 'var(--text-1)', textAlign: 'center' }}>
        V(t) = V₀(1 − e^(−t/RC)) &nbsp;|&nbsp; τ = RC = <b style={{ color: 'var(--orange,#f97316)' }}>{tau.toFixed(3)} s</b>
      </div>
    </div>
  );
}
