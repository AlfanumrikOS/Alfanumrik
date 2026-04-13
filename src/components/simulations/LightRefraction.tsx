'use client';
import { useState, useEffect } from 'react';
import { useResponsiveCanvas } from '@/hooks/useResponsiveCanvas';

const N2_LABELS: Record<string, string> = {
  '1.0': 'Air', '1.33': 'Water', '1.5': 'Glass', '2.42': 'Diamond',
};

export default function LightRefraction() {
  const [n2Raw, setN2Raw] = useState(150);
  const [incidentDeg, setIncidentDeg] = useState(30);
  const { canvasRef, containerRef, size } = useResponsiveCanvas(560 / 300);

  const n1 = 1.0;
  const n2 = n2Raw / 100;
  const label = N2_LABELS[n2.toFixed(2)] ?? n2.toFixed(2);

  const iRad = (incidentDeg * Math.PI) / 180;
  const sinR = (n1 * Math.sin(iRad)) / n2;
  const tir = sinR > 1;
  const rRad = tir ? null : Math.asin(sinR);
  const rDeg = rRad !== null ? Math.round((rRad * 180) / Math.PI) : null;

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const w = size.width, h = size.height;
    ctx.clearRect(0, 0, w, h);

    const midY = h / 2;
    const cx = w / 2;
    const rayLen = 160;

    // Backgrounds
    ctx.fillStyle = 'rgba(186,230,253,0.25)'; ctx.fillRect(0, 0, w, midY);
    ctx.fillStyle = 'rgba(100,160,220,0.35)'; ctx.fillRect(0, midY, w, midY);
    ctx.fillStyle = 'var(--text-2)'; ctx.font = '11px sans-serif';
    ctx.fillText('Air  (n₁ = 1.0)', 12, 18);
    ctx.fillText(`${label}  (n₂ = ${n2.toFixed(2)})`, 12, midY + 18);

    // Interface
    ctx.strokeStyle = '#aaa'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(0, midY); ctx.lineTo(w, midY); ctx.stroke(); ctx.setLineDash([]);

    // Normal (dashed)
    ctx.strokeStyle = '#777'; ctx.lineWidth = 1; ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.moveTo(cx, midY - 130); ctx.lineTo(cx, midY + 130); ctx.stroke(); ctx.setLineDash([]);

    // Incident ray
    const iRad2 = (incidentDeg * Math.PI) / 180;
    const iSx = cx - Math.sin(iRad2) * rayLen;
    const iSy = midY - Math.cos(iRad2) * rayLen;
    ctx.strokeStyle = 'var(--orange)'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(iSx, iSy); ctx.lineTo(cx, midY); ctx.stroke();
    // angle arc
    ctx.strokeStyle = 'var(--orange)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cx, midY, 45, -Math.PI / 2 - iRad2, -Math.PI / 2, false); ctx.stroke();
    ctx.fillStyle = 'var(--orange)'; ctx.font = '12px sans-serif';
    ctx.fillText(`θ₁=${incidentDeg}°`, cx - 95, midY - 50);

    if (tir) {
      // Total internal reflection — show reflected ray only
      const rfSx = cx + Math.sin(iRad2) * rayLen;
      const rfSy = midY - Math.cos(iRad2) * rayLen;
      ctx.strokeStyle = 'var(--orange)'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(cx, midY); ctx.lineTo(rfSx, rfSy); ctx.stroke();
      ctx.fillStyle = '#ef4444'; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('Total Internal Reflection (TIR)', cx, midY + 40);
      ctx.textAlign = 'left';
    } else if (rRad !== null) {
      // Refracted ray
      const rfX = cx + Math.sin(rRad) * rayLen;
      const rfY = midY + Math.cos(rRad) * rayLen;
      ctx.strokeStyle = 'var(--purple)'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(cx, midY); ctx.lineTo(rfX, rfY); ctx.stroke();
      // angle arc
      ctx.strokeStyle = 'var(--purple)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(cx, midY, 45, Math.PI / 2, Math.PI / 2 - rRad, true); ctx.stroke();
      ctx.fillStyle = 'var(--purple)'; ctx.font = '12px sans-serif';
      ctx.fillText(`θ₂=${rDeg}°`, cx + 30, midY + 55);
    }
  }, [n2, incidentDeg, tir, rRad, rDeg, size, canvasRef]);

  const n2Steps = [100, 133, 150, 242];

  return (
    <div style={{ background: 'var(--surface-1)', borderRadius: 12, padding: 16, maxWidth: 600, margin: '0 auto', fontFamily: 'inherit' }}>
      <h3 style={{ color: 'var(--text-1)', fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Light Refraction — Snell's Law</h3>
      <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
        {n2Steps.map(v => (
          <button key={v} onClick={() => setN2Raw(v)} style={{ padding: '4px 10px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 11, background: n2Raw === v ? 'var(--purple)' : 'var(--surface-2)', color: n2Raw === v ? '#fff' : 'var(--text-1)' }}>
            {N2_LABELS[(v / 100).toFixed(2)]} ({(v / 100).toFixed(2)})
          </button>
        ))}
      </div>
      <div ref={containerRef} className="w-full" style={{ aspectRatio: '560/300' }}>
        <canvas ref={canvasRef} className="rounded-lg" style={{ background: 'var(--surface-2)', display: 'block' }} />
      </div>
      <div style={{ marginTop: 10 }}>
        <label style={{ color: 'var(--text-2)', fontSize: 13 }}>Incident angle θ₁: {incidentDeg}°</label>
        <input type="range" min={5} max={85} value={incidentDeg} onChange={e => setIncidentDeg(+e.target.value)} style={{ width: '100%' }} />
        <label style={{ color: 'var(--text-2)', fontSize: 13 }}>n₂: {n2.toFixed(2)} ({label})</label>
        <input type="range" min={100} max={242} value={n2Raw} onChange={e => setN2Raw(+e.target.value)} style={{ width: '100%' }} />
      </div>
      <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 8, fontSize: 13, color: 'var(--text-1)', textAlign: 'center' }}>
        n₁ sin θ₁ = n₂ sin θ₂ &nbsp;→&nbsp; θ₂ = <b style={{ color: tir ? '#ef4444' : 'var(--purple)' }}>{tir ? 'TIR' : `${rDeg}°`}</b>
      </div>
    </div>
  );
}
