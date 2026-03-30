'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

/**
 * Snell's Law (Refraction) Simulation
 *
 * CBSE Class 10, Chapter 10: Light — Reflection and Refraction
 * Board Exam Relevance: HIGH (3-5 marks)
 *
 * Demonstrates: n₁ sin(θ₁) = n₂ sin(θ₂)
 * Students change angle of incidence and refractive indices
 * to observe bending of light at a boundary.
 * Includes total internal reflection at critical angle.
 */

const MEDIA: Record<string, { name: string; n: number; color: string }> = {
  air: { name: 'Air', n: 1.00, color: '#e0f2fe' },
  water: { name: 'Water', n: 1.33, color: '#bae6fd' },
  glass: { name: 'Glass', n: 1.52, color: '#c7d2fe' },
  diamond: { name: 'Diamond', n: 2.42, color: '#e9d5ff' },
  oil: { name: 'Oil', n: 1.47, color: '#fef3c7' },
};

export default function SnellsLaw() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasWidth, setCanvasWidth] = useState(500);

  const [incidentAngle, setIncidentAngle] = useState(30); // degrees
  const [medium1, setMedium1] = useState('air');
  const [medium2, setMedium2] = useState('glass');

  const n1 = MEDIA[medium1].n;
  const n2 = MEDIA[medium2].n;

  // Snell's Law: n1 * sin(θ1) = n2 * sin(θ2)
  const sinTheta2 = (n1 * Math.sin(incidentAngle * Math.PI / 180)) / n2;
  const isTIR = sinTheta2 > 1; // Total Internal Reflection
  const refractedAngle = isTIR ? 0 : Math.asin(sinTheta2) * 180 / Math.PI;
  const criticalAngle = n1 > n2 ? Math.asin(n2 / n1) * 180 / Math.PI : 90;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(entries => {
      for (const e of entries) setCanvasWidth(e.contentRect.width);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);

    const midY = h / 2;
    const midX = w / 2;
    const rayLen = Math.min(w, h) * 0.4;

    // Medium 1 (top)
    ctx.fillStyle = MEDIA[medium1].color;
    ctx.fillRect(0, 0, w, midY);

    // Medium 2 (bottom)
    ctx.fillStyle = MEDIA[medium2].color;
    ctx.fillRect(0, midY, w, h - midY);

    // Boundary line
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(w, midY);
    ctx.stroke();

    // Normal line (dashed)
    ctx.strokeStyle = '#94A3B8';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(midX, midY - rayLen - 20);
    ctx.lineTo(midX, midY + rayLen + 20);
    ctx.stroke();
    ctx.setLineDash([]);

    // Normal label
    ctx.fillStyle = '#64748B';
    ctx.font = '10px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('Normal', midX, midY - rayLen - 24);

    // Incident ray (coming from upper-left to center)
    const theta1Rad = incidentAngle * Math.PI / 180;
    const incX = midX - rayLen * Math.sin(theta1Rad);
    const incY = midY - rayLen * Math.cos(theta1Rad);

    ctx.strokeStyle = '#F59E0B';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(incX, incY);
    ctx.lineTo(midX, midY);
    ctx.stroke();

    // Arrow head on incident ray
    const arrowSize = 10;
    const arrowAngle = Math.atan2(midY - incY, midX - incX);
    ctx.fillStyle = '#F59E0B';
    ctx.beginPath();
    ctx.moveTo(midX - 20 * Math.cos(arrowAngle), midY - 20 * Math.sin(arrowAngle));
    ctx.lineTo(midX - 20 * Math.cos(arrowAngle) - arrowSize * Math.cos(arrowAngle - 0.4), midY - 20 * Math.sin(arrowAngle) - arrowSize * Math.sin(arrowAngle - 0.4));
    ctx.lineTo(midX - 20 * Math.cos(arrowAngle) - arrowSize * Math.cos(arrowAngle + 0.4), midY - 20 * Math.sin(arrowAngle) - arrowSize * Math.sin(arrowAngle + 0.4));
    ctx.closePath();
    ctx.fill();

    if (isTIR) {
      // Total Internal Reflection — reflected ray
      const reflX = midX + rayLen * Math.sin(theta1Rad);
      const reflY = midY - rayLen * Math.cos(theta1Rad);

      ctx.strokeStyle = '#EF4444';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(midX, midY);
      ctx.lineTo(reflX, reflY);
      ctx.stroke();

      // TIR label
      ctx.fillStyle = '#EF4444';
      ctx.font = 'bold 12px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('Total Internal Reflection!', midX, midY + 30);
    } else {
      // Refracted ray
      const theta2Rad = refractedAngle * Math.PI / 180;
      const refrX = midX + rayLen * Math.sin(theta2Rad);
      const refrY = midY + rayLen * Math.cos(theta2Rad);

      ctx.strokeStyle = '#3B82F6';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(midX, midY);
      ctx.lineTo(refrX, refrY);
      ctx.stroke();

      // Partial reflection (faint)
      const reflX = midX + rayLen * 0.4 * Math.sin(theta1Rad);
      const reflY = midY - rayLen * 0.4 * Math.cos(theta1Rad);
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.25)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(midX, midY);
      ctx.lineTo(reflX, reflY);
      ctx.stroke();

      // Angle arcs
      ctx.strokeStyle = '#F59E0B';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(midX, midY, 30, -Math.PI / 2, -Math.PI / 2 + theta1Rad);
      ctx.stroke();

      ctx.strokeStyle = '#3B82F6';
      ctx.beginPath();
      ctx.arc(midX, midY, 30, Math.PI / 2 - theta2Rad, Math.PI / 2);
      ctx.stroke();

      // Angle labels
      ctx.fillStyle = '#F59E0B';
      ctx.font = 'bold 11px system-ui';
      ctx.textAlign = 'left';
      ctx.fillText(`θ₁ = ${incidentAngle}°`, midX + 35, midY - 15);

      ctx.fillStyle = '#3B82F6';
      ctx.fillText(`θ₂ = ${refractedAngle.toFixed(1)}°`, midX + 35, midY + 25);
    }

    // Medium labels
    ctx.font = '12px system-ui';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#334155';
    ctx.fillText(`${MEDIA[medium1].name} (n = ${n1.toFixed(2)})`, 10, 20);
    ctx.fillText(`${MEDIA[medium2].name} (n = ${n2.toFixed(2)})`, 10, h - 10);
  }, [canvasWidth, incidentAngle, medium1, medium2, n1, n2, isTIR, refractedAngle]);

  useEffect(() => { draw(); }, [draw]);

  return (
    <div ref={containerRef} style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", maxWidth: 600, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#6366F1' }}>💎 Snell&apos;s Law — Refraction of Light</div>
        <div style={{ fontSize: 11, color: '#64748B' }}>n₁ sin(θ₁) = n₂ sin(θ₂)</div>
      </div>

      {/* Canvas */}
      <canvas ref={canvasRef} role="img" aria-label="Snell's Law light refraction visualization showing incident and refracted rays at a media boundary" style={{ width: '100%', height: 300, borderRadius: 8, border: '1px solid #e2e8f0' }} />

      {/* Controls */}
      <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
        {/* Angle of incidence */}
        <div style={{ padding: '10px 12px', background: '#fffbeb', borderRadius: 8, border: '1px solid #fde68a' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#92400e', marginBottom: 4 }}>🔦 Angle of Incidence (θ₁)</div>
          <input type="range" min={0} max={89} step={1} value={incidentAngle} onChange={e => setIncidentAngle(Number(e.target.value))} aria-label={`Angle of incidence slider, ${incidentAngle} degrees, range 0 to 89`} style={{ width: '100%', accentColor: '#f59e0b' }} />
          <div style={{ fontSize: 14, fontWeight: 700, color: '#1e293b', textAlign: 'center' }}>{incidentAngle}°</div>
        </div>

        {/* Media selectors */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div style={{ padding: '8px 12px', background: '#f0f9ff', borderRadius: 8, border: '1px solid #bae6fd' }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: '#0c4a6e', marginBottom: 4 }}>Medium 1 (top)</div>
            <select value={medium1} onChange={e => setMedium1(e.target.value)} aria-label="Select medium 1 (top)" style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid #e2e8f0', fontSize: 13 }}>
              {Object.entries(MEDIA).map(([k, v]) => (
                <option key={k} value={k}>{v.name} (n={v.n})</option>
              ))}
            </select>
          </div>
          <div style={{ padding: '8px 12px', background: '#f5f3ff', borderRadius: 8, border: '1px solid #ddd6fe' }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: '#4c1d95', marginBottom: 4 }}>Medium 2 (bottom)</div>
            <select value={medium2} onChange={e => setMedium2(e.target.value)} aria-label="Select medium 2 (bottom)" style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid #e2e8f0', fontSize: 13 }}>
              {Object.entries(MEDIA).map(([k, v]) => (
                <option key={k} value={k}>{v.name} (n={v.n})</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Info panel */}
      <div style={{ marginTop: 12, padding: '10px 14px', background: isTIR ? '#fef2f2' : '#f0fdf4', borderRadius: 8, border: `1px solid ${isTIR ? '#fecaca' : '#bbf7d0'}` }}>
        {isTIR ? (
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#991b1b' }}>⚠️ Total Internal Reflection</div>
            <div style={{ fontSize: 11, color: '#7f1d1d', marginTop: 2 }}>
              θ₁ ({incidentAngle}°) &gt; critical angle ({criticalAngle.toFixed(1)}°). Light reflects back into the denser medium.
            </div>
            <div style={{ fontSize: 10, color: '#64748B', marginTop: 4 }}>
              This is how optical fibers and diamonds work!
            </div>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#166534' }}>
              {n1 < n2 ? 'Light bends toward the normal (entering denser medium)' : n1 > n2 ? 'Light bends away from the normal (entering rarer medium)' : 'No bending (same medium)'}
            </div>
            <div style={{ fontSize: 11, color: '#334155', marginTop: 2 }}>
              {n1.toFixed(2)} × sin({incidentAngle}°) = {n2.toFixed(2)} × sin({refractedAngle.toFixed(1)}°)
            </div>
            {n1 > n2 && (
              <div style={{ fontSize: 10, color: '#6366F1', marginTop: 4 }}>
                💡 Try increasing θ₁ above {criticalAngle.toFixed(0)}° to see total internal reflection!
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
