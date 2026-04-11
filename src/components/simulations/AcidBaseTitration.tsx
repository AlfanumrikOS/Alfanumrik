'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

export const metadata = {
  id: 'acid-base-titration',
  name: 'Acid-Base Titration',
  subject: 'Chemistry',
  grade: '11-12',
  description: 'Simulate titration of HCl with NaOH — observe pH changes and equivalence point',
};

// Chemistry: 0.1M HCl (25 mL) titrated with 0.1M NaOH
function calcPH(volNaOH: number): number {
  const molHCl = 0.1 * 25; // 2.5 mmol
  const molNaOH = 0.1 * volNaOH;
  const totalVol = 25 + volNaOH; // mL

  if (Math.abs(molNaOH - molHCl) < 0.001) return 7.0; // equivalence point

  if (molNaOH < molHCl) {
    const hConc = (molHCl - molNaOH) / totalVol; // mmol/mL = mol/L
    return -Math.log10(hConc);
  } else {
    const ohConc = (molNaOH - molHCl) / totalVol;
    return 14 + Math.log10(ohConc);
  }
}

function pHToColor(ph: number): string {
  if (ph < 3) return '#ef4444';
  if (ph < 6) return '#f97316';
  if (ph < 7) return '#eab308';
  if (ph < 7.1) return '#22c55e';
  if (ph < 10) return '#0ea5e9';
  return '#7c3aed';
}

function pHToIndicatorName(ph: number): string {
  if (ph < 3) return 'Red (Strong Acid)';
  if (ph < 6) return 'Orange';
  if (ph < 7) return 'Yellow';
  if (ph < 7.1) return 'Green (Equivalence!)';
  if (ph < 10) return 'Blue-Green (Basic)';
  return 'Purple (Strong Base)';
}

interface CurvePoint { vol: number; ph: number; }

export default function AcidBaseTitration() {
  const [volumeNaOH, setVolumeNaOH] = useState(0);
  const svgRef = useRef<SVGSVGElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const pH = calcPH(volumeNaOH);
  const solutionColor = pHToColor(pH);
  const indicatorName = pHToIndicatorName(pH);

  // Build curve points up to current volume
  const curvePoints: CurvePoint[] = [];
  for (let v = 0; v <= 50; v += 0.5) {
    curvePoints.push({ vol: v, ph: calcPH(v) });
  }

  const drawCurve = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    const pad = { top: 20, right: 20, bottom: 36, left: 40 };
    const plotW = W - pad.left - pad.right;
    const plotH = H - pad.top - pad.bottom;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, W, H);

    // Axes
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(pad.left, pad.top);
    ctx.lineTo(pad.left, pad.top + plotH);
    ctx.lineTo(pad.left + plotW, pad.top + plotH);
    ctx.stroke();

    // Grid lines
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 0.5;
    for (let ph = 0; ph <= 14; ph += 2) {
      const y = pad.top + plotH - (ph / 14) * plotH;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(pad.left + plotW, y);
      ctx.stroke();
      ctx.fillStyle = '#64748b';
      ctx.font = '9px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(String(ph), pad.left - 4, y + 3);
    }
    for (let v = 0; v <= 50; v += 10) {
      const x = pad.left + (v / 50) * plotW;
      ctx.beginPath();
      ctx.moveTo(x, pad.top);
      ctx.lineTo(x, pad.top + plotH);
      ctx.stroke();
      ctx.fillStyle = '#64748b';
      ctx.font = '9px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(String(v), x, pad.top + plotH + 14);
    }

    // Axis labels
    ctx.fillStyle = '#334155';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Volume NaOH (mL)', pad.left + plotW / 2, H - 4);
    ctx.save();
    ctx.translate(12, pad.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('pH', 0, 0);
    ctx.restore();

    // Equivalence point marker
    const eqX = pad.left + (25 / 50) * plotW;
    ctx.strokeStyle = '#22c55e';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(eqX, pad.top);
    ctx.lineTo(eqX, pad.top + plotH);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#22c55e';
    ctx.font = '8px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Equiv.', eqX, pad.top + 9);

    // Plot pH=7 line
    const ph7y = pad.top + plotH - (7 / 14) * plotH;
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 0.5;
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(pad.left, ph7y);
    ctx.lineTo(pad.left + plotW, ph7y);
    ctx.stroke();
    ctx.setLineDash([]);

    // Full titration curve (light)
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    curvePoints.forEach((pt, i) => {
      const x = pad.left + (pt.vol / 50) * plotW;
      const y = pad.top + plotH - (Math.min(14, Math.max(0, pt.ph)) / 14) * plotH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Drawn portion (orange)
    ctx.strokeStyle = '#f97316';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    let first = true;
    for (let v = 0; v <= volumeNaOH; v += 0.5) {
      const pt = { vol: v, ph: calcPH(v) };
      const x = pad.left + (pt.vol / 50) * plotW;
      const y = pad.top + plotH - (Math.min(14, Math.max(0, pt.ph)) / 14) * plotH;
      if (first) { ctx.moveTo(x, y); first = false; }
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Current point dot
    const curX = pad.left + (volumeNaOH / 50) * plotW;
    const curY = pad.top + plotH - (Math.min(14, Math.max(0, pH)) / 14) * plotH;
    ctx.beginPath();
    ctx.arc(curX, curY, 5, 0, Math.PI * 2);
    ctx.fillStyle = solutionColor;
    ctx.fill();
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }, [volumeNaOH, pH, solutionColor, curvePoints]);

  useEffect(() => {
    drawCurve();
  }, [drawCurve]);

  return (
    <div style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", maxWidth: 580, margin: '0 auto', padding: '0 4px' }}>
      <div style={{ textAlign: 'center', marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#F97316' }}>Acid-Base Titration</div>
        <div style={{ fontSize: 11, color: '#64748b' }}>0.1M HCl (25 mL) + 0.1M NaOH — CBSE Class 11-12</div>
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* Beaker SVG */}
        <div style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <svg ref={svgRef} width={130} height={200} viewBox="0 0 130 200" role="img" aria-label={`Beaker showing solution with pH ${pH.toFixed(2)}, color ${indicatorName}`}>
            {/* Beaker body */}
            <rect x={20} y={30} width={90} height={130} rx={4} fill="rgba(200,230,255,0.15)" stroke="#94a3b8" strokeWidth={2} />
            {/* Solution fill */}
            <rect x={22} y={60} width={86} height={98} fill={solutionColor} opacity={0.7} />
            {/* Graduations */}
            {[0, 25, 50, 75, 100].map((pct, i) => (
              <g key={i}>
                <line x1={20} y1={60 + (1 - pct / 100) * 98} x2={30} y2={60 + (1 - pct / 100) * 98} stroke="#64748b" strokeWidth={1} />
                <text x={32} y={60 + (1 - pct / 100) * 98 + 3} fontSize={7} fill="#64748b">{pct}%</text>
              </g>
            ))}
            {/* Beaker rim */}
            <rect x={15} y={25} width={100} height={10} rx={3} fill="rgba(200,230,255,0.3)" stroke="#94a3b8" strokeWidth={1.5} />
            {/* Burette drip */}
            <rect x={58} y={2} width={14} height={28} rx={2} fill="#7c3aed" opacity={0.6} />
            <text x={65} y={16} textAnchor="middle" fontSize={7} fill="#fff">NaOH</text>
            {volumeNaOH > 0 && (
              <ellipse cx={65} cy={34} rx={3} ry={4} fill="#7c3aed" opacity={0.8 + Math.sin(Date.now() / 200) * 0.2} />
            )}
            {/* Labels */}
            <text x={65} y={172} textAnchor="middle" fontSize={9} fontWeight="bold" fill="#334155">HCl + NaOH</text>
            <text x={65} y={185} textAnchor="middle" fontSize={8} fill="#64748b">Solution</text>
          </svg>

          {/* pH display */}
          <div style={{
            marginTop: 6, padding: '8px 16px', borderRadius: 10, background: solutionColor,
            textAlign: 'center', minWidth: 110,
          }}>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.85)', fontWeight: 600 }}>pH</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: '#fff' }}>{pH.toFixed(2)}</div>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.9)', marginTop: 2 }}>{indicatorName}</div>
          </div>
        </div>

        {/* Titration Curve */}
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: '#334155', marginBottom: 4, textAlign: 'center' }}>
            Titration Curve
          </div>
          <canvas
            ref={canvasRef}
            width={280}
            height={190}
            style={{ width: '100%', borderRadius: 8, border: '1px solid #e2e8f0', display: 'block' }}
          />
        </div>
      </div>

      {/* Slider */}
      <div style={{ marginTop: 14, padding: '12px', background: '#f8fafc', borderRadius: 10, border: '1px solid #e2e8f0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 600, color: '#334155', marginBottom: 6 }}>
          <span>Volume NaOH Added</span>
          <span style={{ color: '#7c3aed' }}>{volumeNaOH.toFixed(1)} mL</span>
        </div>
        <input
          type="range"
          min={0}
          max={50}
          step={0.5}
          value={volumeNaOH}
          onChange={e => setVolumeNaOH(Number(e.target.value))}
          aria-label={`Volume of NaOH: ${volumeNaOH} mL`}
          style={{ width: '100%', accentColor: '#7c3aed', height: 6 }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#94a3b8', marginTop: 2 }}>
          <span>0 mL</span>
          <span style={{ color: '#22c55e', fontWeight: 600 }}>25 mL = Equivalence</span>
          <span>50 mL</span>
        </div>
      </div>

      {/* Info Cards */}
      <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
        <div style={{ padding: 8, background: '#fef2f2', borderRadius: 8, textAlign: 'center' }}>
          <div style={{ fontSize: 9, color: '#991b1b', fontWeight: 600 }}>HCl (acid)</div>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#334155' }}>0.1 M</div>
          <div style={{ fontSize: 9, color: '#64748b' }}>25 mL</div>
        </div>
        <div style={{ padding: 8, background: '#f0fdf4', borderRadius: 8, textAlign: 'center' }}>
          <div style={{ fontSize: 9, color: '#166534', fontWeight: 600 }}>Equiv. point</div>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#334155' }}>pH = 7</div>
          <div style={{ fontSize: 9, color: '#64748b' }}>@25 mL NaOH</div>
        </div>
        <div style={{ padding: 8, background: '#faf5ff', borderRadius: 8, textAlign: 'center' }}>
          <div style={{ fontSize: 9, color: '#6b21a8', fontWeight: 600 }}>NaOH (base)</div>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#334155' }}>0.1 M</div>
          <div style={{ fontSize: 9, color: '#64748b' }}>{volumeNaOH.toFixed(1)} mL added</div>
        </div>
      </div>
    </div>
  );
}
