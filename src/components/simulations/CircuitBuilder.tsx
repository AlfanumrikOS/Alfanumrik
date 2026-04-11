'use client';
import { useState, useRef, useEffect, useCallback } from 'react';

export const metadata = {
  id: 'circuit-builder',
  name: 'Circuit Builder',
  subject: 'Physics',
  grade: '9-12',
  description: "Explore series and parallel circuits, Kirchhoff's laws, and Ohm's law",
};

type Mode = 'series' | 'parallel';

export default function CircuitBuilder() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [resistance1, setResistance1] = useState(20);
  const [resistance2, setResistance2] = useState(30);
  const [voltage, setVoltage] = useState(12);
  const [mode, setMode] = useState<Mode>('series');

  const rTotal = mode === 'series'
    ? resistance1 + resistance2
    : (resistance1 * resistance2) / (resistance1 + resistance2);
  const current = voltage / rTotal;
  const power = voltage * current;

  const currentColor = useCallback((i: number) => {
    // orange = high, blue = low, scale 0-2A
    const t = Math.min(i / 2, 1);
    const r = Math.round(t * 249 + (1 - t) * 59);
    const g = Math.round(t * 115 + (1 - t) * 130);
    const b = Math.round(t * 22 + (1 - t) * 246);
    return `rgb(${r},${g},${b})`;
  }, []);

  const drawResistor = useCallback((ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, label: string) => {
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y - h / 2, w, h);
    ctx.fillStyle = '#334155';
    ctx.fillRect(x, y - h / 2, w, h);
    ctx.fillStyle = '#F97316';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label, x + w / 2, y + 4);
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0f0f23';
    ctx.fillRect(0, 0, W, H);

    const wireColor = currentColor(current);
    ctx.strokeStyle = wireColor;
    ctx.lineWidth = 3;

    const batX = 40;
    const batY = H / 2;
    const batW = 30;
    const batH = 60;
    // Draw battery
    ctx.fillStyle = '#1e293b';
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 2;
    ctx.strokeRect(batX, batY - batH / 2, batW, batH);
    ctx.fillRect(batX, batY - batH / 2, batW, batH);
    ctx.fillStyle = '#F97316';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('+', batX + batW / 2, batY - 10);
    ctx.fillStyle = '#7C3AED';
    ctx.fillText('-', batX + batW / 2, batY + 18);

    ctx.strokeStyle = wireColor;
    ctx.lineWidth = 3;

    if (mode === 'series') {
      const r1X = 120;
      const r2X = 220;
      const topY = H / 2;
      const resW = 60;
      const resH = 28;
      // Top wire: battery+ -> r1 -> r2 -> right corner
      ctx.beginPath();
      ctx.moveTo(batX + batW, batY - 15);
      ctx.lineTo(r1X, topY);
      ctx.stroke();
      drawResistor(ctx, r1X, topY, resW, resH, `R1=${resistance1}Ω`);
      ctx.beginPath();
      ctx.moveTo(r1X + resW, topY);
      ctx.lineTo(r2X, topY);
      ctx.stroke();
      drawResistor(ctx, r2X, topY, resW, resH, `R2=${resistance2}Ω`);
      ctx.beginPath();
      ctx.moveTo(r2X + resW, topY);
      ctx.lineTo(W - 40, topY);
      ctx.lineTo(W - 40, H - 30);
      ctx.lineTo(batX + batW / 2, H - 30);
      ctx.lineTo(batX + batW / 2, batY + batH / 2);
      ctx.stroke();
      // Top return wire
      ctx.beginPath();
      ctx.moveTo(batX + batW / 2, batY - batH / 2);
      ctx.lineTo(batX + batW / 2, 30);
      ctx.lineTo(r1X, 30);
      ctx.lineTo(r1X, topY);
      ctx.stroke();
    } else {
      const branchX1 = 130;
      const branchX2 = 270;
      const topY = H / 2 - 50;
      const botY = H / 2 + 50;
      const resW = 80;
      const resH = 24;
      const midX = (branchX1 + branchX2) / 2;
      // Wire from battery+ to branch point
      ctx.beginPath();
      ctx.moveTo(batX + batW, batY - 15);
      ctx.lineTo(batX + batW + 20, batY - 15);
      ctx.lineTo(batX + batW + 20, topY);
      ctx.lineTo(branchX1, topY);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(batX + batW + 20, topY);
      ctx.lineTo(batX + batW + 20, botY);
      ctx.lineTo(branchX1, botY);
      ctx.stroke();
      // R1 top branch
      drawResistor(ctx, branchX1, topY, resW, resH, `R1=${resistance1}Ω`);
      ctx.beginPath();
      ctx.moveTo(branchX1 + resW, topY);
      ctx.lineTo(branchX2, topY);
      ctx.stroke();
      // R2 bottom branch
      drawResistor(ctx, branchX1, botY, resW, resH, `R2=${resistance2}Ω`);
      ctx.beginPath();
      ctx.moveTo(branchX1 + resW, botY);
      ctx.lineTo(branchX2, botY);
      ctx.stroke();
      // Rejoin
      ctx.beginPath();
      ctx.moveTo(branchX2, topY);
      ctx.lineTo(branchX2, botY);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(branchX2, H / 2);
      ctx.lineTo(W - 40, H / 2);
      ctx.lineTo(W - 40, H - 30);
      ctx.lineTo(batX + batW / 2, H - 30);
      ctx.lineTo(batX + batW / 2, batY + batH / 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(batX + batW / 2, batY - batH / 2);
      ctx.lineTo(batX + batW / 2, 30);
      ctx.lineTo(batX + batW + 20, 30);
      ctx.lineTo(batX + batW + 20, topY);
      ctx.stroke();
    }

    // Labels
    ctx.fillStyle = '#94a3b8';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`V = ${voltage}V`, batX, H - 10);
    ctx.fillText(`I = ${current.toFixed(3)}A`, batX + 80, H - 10);
    ctx.fillText(`P = ${power.toFixed(2)}W`, batX + 180, H - 10);
    ctx.fillStyle = '#F97316';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText(`R_total = ${rTotal.toFixed(2)}Ω`, W - 130, H - 10);
  }, [resistance1, resistance2, voltage, mode, current, power, rTotal, currentColor, drawResistor]);

  useEffect(() => { draw(); }, [draw]);

  const sliderStyle = { width: '100%', accentColor: '#F97316' };
  const labelStyle: React.CSSProperties = { color: '#94a3b8', fontSize: 13 };
  const valueStyle: React.CSSProperties = { color: '#F97316', fontWeight: 700 };

  return (
    <div style={{ background: '#1a1a2e', borderRadius: 12, padding: 16, maxWidth: '100%', fontFamily: 'sans-serif' }}>
      <h2 style={{ color: '#F97316', margin: '0 0 12px', fontSize: 18, fontWeight: 700 }}>Circuit Builder</h2>
      <canvas ref={canvasRef} width={400} height={220} style={{ width: '100%', borderRadius: 8, display: 'block' }} />
      <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
        {(['series', 'parallel'] as Mode[]).map(m => (
          <button key={m} onClick={() => setMode(m)}
            style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: 'none', cursor: 'pointer',
              background: mode === m ? '#F97316' : '#1e293b', color: mode === m ? '#fff' : '#94a3b8',
              fontWeight: 700, fontSize: 13 }}>
            {m.charAt(0).toUpperCase() + m.slice(1)}
          </button>
        ))}
      </div>
      <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
        {[
          { label: 'R1 (Resistance 1)', value: resistance1, set: setResistance1, min: 1, max: 100, unit: 'Ω' },
          { label: 'R2 (Resistance 2)', value: resistance2, set: setResistance2, min: 1, max: 100, unit: 'Ω' },
          { label: 'V (Voltage)', value: voltage, set: setVoltage, min: 1, max: 24, unit: 'V' },
        ].map(({ label, value, set, min, max, unit }) => (
          <div key={label}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
              <span style={labelStyle}>{label}</span>
              <span style={valueStyle}>{value}{unit}</span>
            </div>
            <input type="range" min={min} max={max} value={value}
              onChange={e => set(Number(e.target.value))} style={sliderStyle} />
          </div>
        ))}
      </div>
      <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
        {[
          { label: 'R_total', value: `${rTotal.toFixed(2)} Ω` },
          { label: 'Current (I)', value: `${current.toFixed(3)} A` },
          { label: 'Power (P)', value: `${power.toFixed(2)} W` },
        ].map(({ label, value }) => (
          <div key={label} style={{ background: '#0f0f23', borderRadius: 8, padding: '8px 10px', textAlign: 'center' }}>
            <div style={{ color: '#64748b', fontSize: 11 }}>{label}</div>
            <div style={{ color: '#F97316', fontWeight: 700, fontSize: 15 }}>{value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
