'use client';
import { useState, useRef, useEffect } from 'react';

export default function BufferSolution() {
  const [addedMMol, setAddedMMol] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const pKa = 4.74;
  const initA = 10, initHA = 10;

  const bufferA = Math.max(0.001, initA - addedMMol);
  const bufferHA = Math.max(0.001, initHA + addedMMol);
  const bufferPH = pKa + Math.log10(bufferA / bufferHA);

  const waterPH = addedMMol > 0
    ? 14 + Math.log10(addedMMol / 1000 / 0.1)
    : addedMMol < 0
    ? -Math.log10(-addedMMol / 1000 / 0.1)
    : 7;

  const indicatorColor = (ph: number) => {
    if (ph < 3) return '#ff4444';
    if (ph < 5) return '#ff8800';
    if (ph < 7) return '#ffcc00';
    if (ph < 9) return '#44cc44';
    if (ph < 11) return '#4488ff';
    return '#8844cc';
  };

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const pad = { l: 50, r: 20, t: 20, b: 40 };
    const pw = W - pad.l - pad.r;
    const ph = H - pad.t - pad.b;

    // Axes
    ctx.strokeStyle = '#888'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad.l, pad.t); ctx.lineTo(pad.l, pad.t + ph); ctx.lineTo(pad.l + pw, pad.t + ph); ctx.stroke();

    // pH axis labels
    ctx.fillStyle = '#888'; ctx.font = '10px sans-serif';
    ctx.fillText('pH', 4, pad.t + 4);
    ctx.fillText('14', 2, pad.t + 6);
    ctx.fillText('7', 4, pad.t + ph / 2 + 4);
    ctx.fillText('0', 6, pad.t + ph + 2);
    ctx.fillText('−10', pad.l + 2, pad.t + ph + 14);
    ctx.fillText('0', pad.l + pw / 2 - 4, pad.t + ph + 14);
    ctx.fillText('+10', pad.l + pw - 16, pad.t + ph + 14);
    ctx.fillText('mmol added →', pad.l + pw / 2 - 35, H - 2);

    // Buffer region highlight
    const bufPH1 = pKa - 1, bufPH2 = pKa + 1;
    const by1 = pad.t + ph * (1 - bufPH2 / 14);
    const by2 = pad.t + ph * (1 - bufPH1 / 14);
    ctx.fillStyle = 'rgba(22,163,74,0.1)';
    ctx.fillRect(pad.l, by1, pw, by2 - by1);
    ctx.strokeStyle = 'rgba(22,163,74,0.4)'; ctx.setLineDash([3, 2]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad.l, by1); ctx.lineTo(pad.l + pw, by1); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(pad.l, by2); ctx.lineTo(pad.l + pw, by2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#16a34a'; ctx.font = '10px sans-serif';
    ctx.fillText('Buffer region', pad.l + 5, by1 + 12);

    const toX = (v: number) => pad.l + ((v + 10) / 20) * pw;
    const toY = (ph2: number) => pad.t + ph * (1 - Math.max(0, Math.min(14, ph2)) / 14);

    // Pure water line
    ctx.beginPath(); ctx.strokeStyle = '#93c5fd'; ctx.lineWidth = 2;
    for (let v = -10; v <= 10; v += 0.5) {
      const wph = v > 0 ? 14 + Math.log10(v / 100) : v < 0 ? -Math.log10(-v / 100) : 7;
      const x = toX(v), y = toY(wph);
      v === -10 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Buffer line
    ctx.beginPath(); ctx.strokeStyle = '#f97316'; ctx.lineWidth = 2.5;
    for (let v = -10; v <= 10; v += 0.2) {
      const a2 = Math.max(0.001, initA - v);
      const ha2 = Math.max(0.001, initHA + v);
      const bph = pKa + Math.log10(a2 / ha2);
      const x = toX(v), y = toY(bph);
      v === -10 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Current point
    const cx = toX(addedMMol), cy = toY(bufferPH);
    ctx.beginPath(); ctx.arc(cx, cy, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#f97316'; ctx.fill();

    // Legend
    ctx.fillStyle = '#93c5fd'; ctx.fillRect(pad.l + 5, pad.t + 5, 14, 3);
    ctx.fillStyle = '#888'; ctx.font = '10px sans-serif'; ctx.fillText('Pure water', pad.l + 22, pad.t + 10);
    ctx.fillStyle = '#f97316'; ctx.fillRect(pad.l + 5, pad.t + 18, 14, 3);
    ctx.fillStyle = '#888'; ctx.fillText('Buffer', pad.l + 22, pad.t + 24);

  }, [addedMMol, bufferPH, initA, initHA, pKa]);

  return (
    <div style={{ background: 'var(--surface-1)', borderRadius: 12, padding: 16, maxWidth: 600, margin: '0 auto', fontFamily: 'inherit' }}>
      <h3 style={{ color: 'var(--text-1)', fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Buffer Solution (Acetate Buffer)</h3>
      <p style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 8 }}>CH₃COOH / CH₃COO⁻ system, pKa = 4.74</p>
      <div style={{ marginBottom: 8 }}>
        <label style={{ fontSize: 12, color: 'var(--text-2)' }}>
          Added: {addedMMol > 0 ? `+${addedMMol} mmol base` : addedMMol < 0 ? `${addedMMol} mmol acid` : 'Nothing added'}
        </label>
        <input type="range" min={-10} max={10} step={0.5} value={addedMMol} onChange={e => setAddedMMol(+e.target.value)} style={{ width: '100%', marginTop: 4 }} />
      </div>
      <canvas ref={canvasRef} width={540} height={220} style={{ width: '100%', borderRadius: 8, background: 'var(--surface-2)', display: 'block' }} />
      <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'stretch' }}>
        <div style={{ flex: 1, padding: '8px 10px', background: 'var(--surface-2)', borderRadius: 8, fontSize: 12, textAlign: 'center' }}>
          <div style={{ color: 'var(--text-2)' }}>Buffer pH</div>
          <div style={{ fontWeight: 700, fontSize: 18, color: indicatorColor(bufferPH) }}>{bufferPH.toFixed(2)}</div>
          <div style={{ width: 20, height: 20, borderRadius: '50%', background: indicatorColor(bufferPH), margin: '4px auto', border: '1px solid #ccc' }} />
        </div>
        <div style={{ flex: 1, padding: '8px 10px', background: 'var(--surface-2)', borderRadius: 8, fontSize: 12, textAlign: 'center' }}>
          <div style={{ color: 'var(--text-2)' }}>Pure water pH</div>
          <div style={{ fontWeight: 700, fontSize: 18, color: indicatorColor(waterPH) }}>{isFinite(waterPH) ? waterPH.toFixed(2) : '—'}</div>
          <div style={{ width: 20, height: 20, borderRadius: '50%', background: indicatorColor(waterPH), margin: '4px auto', border: '1px solid #ccc' }} />
        </div>
        <div style={{ flex: 1, padding: '8px 10px', background: 'var(--surface-2)', borderRadius: 8, fontSize: 12 }}>
          <div style={{ color: 'var(--text-2)' }}>Composition</div>
          <div>[A⁻] = <b style={{ color: 'var(--orange)' }}>{bufferA.toFixed(1)}</b> mmol</div>
          <div>[HA] = <b style={{ color: 'var(--purple)' }}>{bufferHA.toFixed(1)}</b> mmol</div>
        </div>
      </div>
      <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 8, fontSize: 13, color: 'var(--text-1)', textAlign: 'center' }}>
        Formula: <b style={{ color: 'var(--orange)' }}>pH = pKa + log([A⁻]/[HA])</b>
      </div>
    </div>
  );
}
