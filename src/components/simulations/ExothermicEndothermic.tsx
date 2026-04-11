'use client';
import { useState, useRef, useEffect } from 'react';

type RxnType = 'Exothermic' | 'Endothermic';

export default function ExothermicEndothermic() {
  const [type, setType] = useState<RxnType>('Exothermic');
  const [Ea, setEa] = useState(60);
  const [dH, setDH] = useState(-60);
  const [catalyst, setCatalyst] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const pad = { l: 50, r: 30, t: 30, b: 40 };
    const plotW = W - pad.l - pad.r;
    const plotH = H - pad.t - pad.b;

    // Axes
    ctx.strokeStyle = '#888'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad.l, pad.t); ctx.lineTo(pad.l, pad.t + plotH); ctx.lineTo(pad.l + plotW, pad.t + plotH); ctx.stroke();

    ctx.fillStyle = '#888'; ctx.font = '11px sans-serif';
    ctx.fillText('Energy', 4, pad.t + plotH / 2);
    ctx.fillText('Reaction Progress →', pad.l + plotW / 2 - 40, H - 5);

    const reactantE = 0.6;
    const effectiveDH = type === 'Exothermic' ? -Math.abs(dH) / 100 : Math.abs(dH) / 100;
    const productE = reactantE + effectiveDH;
    const catalystReduction = catalyst ? 0.15 : 0;
    const peakE = reactantE + Ea / 100 - catalystReduction;

    const toY = (e: number) => pad.t + plotH * (1 - e);
    const toX = (t: number) => pad.l + t * plotW;

    const color = type === 'Exothermic' ? '#ef4444' : '#3b82f6';

    // Energy curve using cubic bezier
    ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = 3;
    ctx.moveTo(toX(0.05), toY(reactantE));
    ctx.bezierCurveTo(toX(0.25), toY(reactantE), toX(0.35), toY(peakE), toX(0.5), toY(peakE));
    ctx.bezierCurveTo(toX(0.65), toY(peakE), toX(0.75), toY(productE), toX(0.95), toY(productE));
    ctx.stroke();

    // Catalyst curve
    if (catalyst) {
      ctx.beginPath(); ctx.strokeStyle = '#16a34a'; ctx.lineWidth = 2; ctx.setLineDash([5, 3]);
      const peakCat = reactantE + (Ea / 100) * 0.6;
      ctx.moveTo(toX(0.05), toY(reactantE));
      ctx.bezierCurveTo(toX(0.25), toY(reactantE), toX(0.35), toY(peakCat), toX(0.5), toY(peakCat));
      ctx.bezierCurveTo(toX(0.65), toY(peakCat), toX(0.75), toY(productE), toX(0.95), toY(productE));
      ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#16a34a'; ctx.font = '10px sans-serif';
      ctx.fillText('With catalyst', toX(0.55), toY(peakCat) - 5);
    }

    // Energy levels
    ctx.strokeStyle = '#888'; ctx.lineWidth = 1; ctx.setLineDash([4, 2]);
    ctx.beginPath(); ctx.moveTo(toX(0.02), toY(reactantE)); ctx.lineTo(toX(0.18), toY(reactantE)); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(toX(0.82), toY(productE)); ctx.lineTo(toX(0.98), toY(productE)); ctx.stroke();
    ctx.setLineDash([]);

    // Labels
    ctx.fillStyle = '#666'; ctx.font = '11px sans-serif';
    ctx.fillText('Reactants', toX(0.02), toY(reactantE) - 5);
    ctx.fillText('Products', toX(0.82), toY(productE) - 5);

    // dH arrow
    const arrowX = toX(0.85);
    const y1 = toY(reactantE), y2 = toY(productE);
    ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = 1.5;
    ctx.moveTo(arrowX, y1); ctx.lineTo(arrowX, y2); ctx.stroke();
    ctx.fillStyle = color; ctx.font = 'bold 11px sans-serif';
    ctx.fillText(`ΔH = ${effectiveDH > 0 ? '+' : ''}${Math.round(effectiveDH * 100)} kJ`, arrowX + 5, (y1 + y2) / 2 + 4);

    // Ea label
    ctx.fillStyle = '#888'; ctx.font = '10px sans-serif';
    ctx.fillText(`Ea = ${Ea} kJ`, toX(0.48), toY(peakE) - 8);

  }, [type, Ea, dH, catalyst]);

  return (
    <div style={{ background: 'var(--surface-1)', borderRadius: 12, padding: 16, maxWidth: 600, margin: '0 auto', fontFamily: 'inherit' }}>
      <h3 style={{ color: 'var(--text-1)', fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Exothermic vs Endothermic</h3>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        {(['Exothermic', 'Endothermic'] as RxnType[]).map(t => (
          <button key={t} onClick={() => { setType(t); setDH(t === 'Exothermic' ? -60 : 60); }} style={{
            padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 13,
            background: type === t ? (t === 'Exothermic' ? '#ef4444' : '#3b82f6') : 'var(--surface-2)', color: type === t ? '#fff' : 'var(--text-1)',
          }}>{t}</button>
        ))}
        <label style={{ fontSize: 12, color: 'var(--text-2)', display: 'flex', alignItems: 'center', gap: 4 }}>
          <input type="checkbox" checked={catalyst} onChange={e => setCatalyst(e.target.checked)} />
          Catalyst
        </label>
      </div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: 12, color: 'var(--text-2)' }}>Activation Energy: {Ea} kJ</label>
          <input type="range" min={20} max={100} value={Ea} onChange={e => setEa(+e.target.value)} style={{ width: '100%' }} />
        </div>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: 12, color: 'var(--text-2)' }}>|ΔH|: {Math.abs(dH)} kJ</label>
          <input type="range" min={10} max={100} value={Math.abs(dH)} onChange={e => setDH(type === 'Exothermic' ? -e.target.value : +e.target.value)} style={{ width: '100%' }} />
        </div>
      </div>
      <canvas ref={canvasRef} width={540} height={260} style={{ width: '100%', borderRadius: 8, background: 'var(--surface-2)', display: 'block' }} />
      <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 8, fontSize: 13, color: 'var(--text-1)', textAlign: 'center' }}>
        Formula: <b style={{ color: 'var(--orange)' }}>ΔH = H_products − H_reactants</b> &nbsp;({type === 'Exothermic' ? 'ΔH < 0, heat released' : 'ΔH > 0, heat absorbed'})
      </div>
    </div>
  );
}
