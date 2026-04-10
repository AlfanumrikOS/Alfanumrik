'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

/**
 * Refraction Through Glass Slab / Prism Simulation
 *
 * CBSE Class 10, Chapter 10: Light — Reflection and Refraction
 * Board Exam Relevance: HIGH (3-5 marks)
 *
 * Demonstrates refraction at entry/exit surfaces of a glass slab
 * (emergent ray parallel to incident ray with lateral displacement)
 * and dispersion through a prism (VIBGYOR spectrum).
 */

const GLASS_N = 1.52;

const VIBGYOR = [
  { name: 'Violet', color: '#8B00FF', n: 1.532 },
  { name: 'Indigo', color: '#4B0082', n: 1.528 },
  { name: 'Blue', color: '#0000FF', n: 1.524 },
  { name: 'Green', color: '#00CC00', n: 1.519 },
  { name: 'Yellow', color: '#FFCC00', n: 1.515 },
  { name: 'Orange', color: '#FF6600', n: 1.512 },
  { name: 'Red', color: '#FF0000', n: 1.509 },
];

type Mode = 'slab' | 'prism';

export default function RefractionLab() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState({ w: 500, h: 380 });
  const [incidentAngle, setIncidentAngle] = useState(40);
  const [mode, setMode] = useState<Mode>('slab');
  const [showMeasurements, setShowMeasurements] = useState(true);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(entries => {
      for (const e of entries) {
        const w = e.contentRect.width;
        setCanvasSize({ w, h: Math.min(380, w * 0.76) });
      }
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

    // Clear
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, w, h);

    if (mode === 'slab') {
      drawGlassSlab(ctx, w, h);
    } else {
      drawPrism(ctx, w, h);
    }
  }, [incidentAngle, mode, showMeasurements]);

  function drawGlassSlab(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const midY = h / 2;
    const slabLeft = w * 0.3;
    const slabRight = w * 0.7;
    const slabTop = h * 0.25;
    const slabBottom = h * 0.75;
    const slabWidth = slabRight - slabLeft;

    // Draw glass slab
    ctx.fillStyle = 'rgba(147, 197, 253, 0.25)';
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 2;
    ctx.fillRect(slabLeft, slabTop, slabWidth, slabBottom - slabTop);
    ctx.strokeRect(slabLeft, slabTop, slabWidth, slabBottom - slabTop);

    // Label
    ctx.fillStyle = '#3b82f6';
    ctx.font = 'bold 11px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('Glass Slab', (slabLeft + slabRight) / 2, midY);
    ctx.font = '10px system-ui';
    ctx.fillStyle = '#64748b';
    ctx.fillText(`n = ${GLASS_N}`, (slabLeft + slabRight) / 2, midY + 14);

    // Entry point
    const entryX = slabLeft;
    const entryY = midY;

    // Normal at entry (dashed)
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(entryX, slabTop + 10);
    ctx.lineTo(entryX, slabBottom - 10);
    ctx.stroke();
    ctx.setLineDash([]);

    // Incident ray
    const theta1 = incidentAngle * Math.PI / 180;
    const rayLen = w * 0.25;
    const incStartX = entryX - rayLen * Math.sin(theta1);
    const incStartY = entryY - rayLen * Math.cos(theta1);

    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(incStartX, incStartY);
    ctx.lineTo(entryX, entryY);
    ctx.stroke();
    drawArrow(ctx, incStartX, incStartY, entryX, entryY, '#f59e0b');

    // Refraction at entry: air to glass
    const sinTheta2 = Math.sin(theta1) / GLASS_N;
    const theta2 = Math.asin(Math.min(sinTheta2, 1));

    // Ray inside glass (from entry to exit)
    const exitX = slabRight;
    // Calculate where ray hits the right surface
    const travelInGlass = slabWidth / Math.cos(theta2);
    const exitY = entryY + slabWidth * Math.tan(theta2);

    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(entryX, entryY);
    ctx.lineTo(exitX, exitY);
    ctx.stroke();
    drawArrow(ctx, entryX, entryY, exitX, exitY, '#3b82f6');

    // Normal at exit (dashed)
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(exitX, slabTop + 10);
    ctx.lineTo(exitX, slabBottom - 10);
    ctx.stroke();
    ctx.setLineDash([]);

    // Refraction at exit: glass to air (angle = incidentAngle, emergent parallel to incident)
    const emergentLen = w * 0.2;
    const emergentEndX = exitX + emergentLen * Math.sin(theta1);
    const emergentEndY = exitY + emergentLen * Math.cos(theta1);

    ctx.strokeStyle = '#22c55e';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(exitX, exitY);
    ctx.lineTo(emergentEndX, emergentEndY);
    ctx.stroke();
    drawArrow(ctx, exitX, exitY, emergentEndX, emergentEndY, '#22c55e');

    // Show lateral displacement
    if (showMeasurements) {
      const latDisp = slabWidth * Math.sin(theta1 - theta2) / Math.cos(theta2);

      // Extend incident ray forward (dotted) to show displacement
      const projEndX = entryX + (emergentEndX - entryX);
      const projEndY = entryY + (projEndX - entryX) * Math.tan(theta1 > 0 ? theta1 : 0.01) / (Math.sin(theta1) > 0 ? 1 : 1);
      // Simpler: project incident direction through
      const projX = exitX + emergentLen * Math.sin(theta1);
      const projY = entryY + (exitX - entryX + emergentLen * Math.sin(theta1)) / Math.tan(Math.PI / 2 - theta1);

      // Just show lateral displacement as a vertical annotation
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      const ldX = exitX + 15;
      ctx.moveTo(ldX, entryY + (ldX - entryX) * Math.sin(theta1) / Math.cos(theta1));
      ctx.stroke();
      ctx.setLineDash([]);

      // Angle arcs at entry
      const arcR = 25;
      // Incident angle arc (from normal going left)
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(entryX, entryY, arcR, -Math.PI / 2, -Math.PI / 2 + theta1);
      ctx.stroke();

      // Refracted angle arc at entry
      ctx.strokeStyle = '#3b82f6';
      ctx.beginPath();
      ctx.arc(entryX, entryY, arcR, Math.PI / 2 - theta2, Math.PI / 2);
      ctx.stroke();

      // Angle arcs at exit
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(exitX, exitY, arcR, -Math.PI / 2, -Math.PI / 2 + theta2);
      ctx.stroke();

      ctx.strokeStyle = '#22c55e';
      ctx.beginPath();
      ctx.arc(exitX, exitY, arcR, Math.PI / 2 - theta1, Math.PI / 2);
      ctx.stroke();

      // Labels
      ctx.font = 'bold 10px system-ui';
      ctx.textAlign = 'right';
      ctx.fillStyle = '#f59e0b';
      ctx.fillText(`i = ${incidentAngle}\u00B0`, entryX - 8, entryY - 30);

      ctx.fillStyle = '#3b82f6';
      ctx.textAlign = 'left';
      ctx.fillText(`r = ${(theta2 * 180 / Math.PI).toFixed(1)}\u00B0`, entryX + 8, entryY + 40);

      ctx.fillStyle = '#22c55e';
      ctx.textAlign = 'left';
      ctx.fillText(`e = ${incidentAngle}\u00B0`, exitX + 8, exitY + 40);

      // Lateral displacement value
      ctx.fillStyle = '#ef4444';
      ctx.font = 'bold 10px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(`d = ${latDisp.toFixed(1)} units`, (slabLeft + slabRight) / 2, slabBottom + 20);

      // Snell's law display
      ctx.fillStyle = '#334155';
      ctx.font = '10px system-ui';
      ctx.textAlign = 'left';
      ctx.fillText(`Snell's Law: sin(${incidentAngle}\u00B0)/sin(${(theta2 * 180 / Math.PI).toFixed(1)}\u00B0) = ${GLASS_N}`, 8, h - 8);
    }

    // Legend
    ctx.font = '10px system-ui';
    ctx.textAlign = 'right';
    const lx = w - 8;
    ctx.fillStyle = '#f59e0b'; ctx.fillText('\u25CF Incident Ray', lx, 15);
    ctx.fillStyle = '#3b82f6'; ctx.fillText('\u25CF Refracted Ray', lx, 28);
    ctx.fillStyle = '#22c55e'; ctx.fillText('\u25CF Emergent Ray', lx, 41);
  }

  function drawPrism(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const midX = w * 0.45;
    const prismSize = Math.min(w, h) * 0.35;
    const prismAngle = 60; // equilateral prism
    const A = prismAngle * Math.PI / 180;

    // Prism vertices (equilateral triangle)
    const topX = midX;
    const topY = h * 0.2;
    const blX = midX - prismSize * 0.5;
    const blY = h * 0.2 + prismSize * Math.sin(A);
    const brX = midX + prismSize * 0.5;
    const brY = blY;

    // Draw prism
    ctx.fillStyle = 'rgba(147, 197, 253, 0.2)';
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(topX, topY);
    ctx.lineTo(blX, blY);
    ctx.lineTo(brX, brY);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#3b82f6';
    ctx.font = 'bold 11px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('Glass Prism', midX, (topY + blY) / 2 + 5);
    ctx.font = '9px system-ui';
    ctx.fillStyle = '#64748b';
    ctx.fillText(`A = ${prismAngle}\u00B0`, midX, (topY + blY) / 2 + 17);

    // Incident ray hits left face of prism
    // Left face: from topX,topY to blX,blY
    const leftFaceAngle = Math.atan2(blY - topY, blX - topX);
    const leftFaceNormal = leftFaceAngle - Math.PI / 2; // inward normal

    // Hit point on left face (at ~40% down)
    const hitFrac = 0.45;
    const hitX = topX + hitFrac * (blX - topX);
    const hitY = topY + hitFrac * (blY - topY);

    // Incident ray from left
    const theta1 = incidentAngle * Math.PI / 180;
    const incAngleToFace = leftFaceNormal + Math.PI + theta1;
    const rayLen = w * 0.25;
    const incStartX = hitX - rayLen * Math.cos(incAngleToFace);
    const incStartY = hitY - rayLen * Math.sin(incAngleToFace);

    // Draw white incident ray
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(incStartX, incStartY);
    ctx.lineTo(hitX, hitY);
    ctx.stroke();
    drawArrow(ctx, incStartX, incStartY, hitX, hitY, '#f59e0b');

    // Normal at entry
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    const normalLen = 35;
    ctx.beginPath();
    ctx.moveTo(hitX - normalLen * Math.cos(leftFaceNormal + Math.PI), hitY - normalLen * Math.sin(leftFaceNormal + Math.PI));
    ctx.lineTo(hitX + normalLen * Math.cos(leftFaceNormal + Math.PI), hitY + normalLen * Math.sin(leftFaceNormal + Math.PI));
    ctx.stroke();
    ctx.setLineDash([]);

    // Dispersion: each color refracts differently
    const rightFaceAngle = Math.atan2(brY - topY, brX - topX);
    const rightFaceNormal = rightFaceAngle + Math.PI / 2;

    VIBGYOR.forEach((band, idx) => {
      const sinR1 = Math.sin(theta1) / band.n;
      if (Math.abs(sinR1) > 1) return;
      const r1 = Math.asin(sinR1);

      // Ray inside prism to right face
      // Angle at second surface: r2 = A - r1
      const r2 = A - r1;
      const sinE = band.n * Math.sin(r2);
      const hasEmergent = Math.abs(sinE) <= 1;

      if (!hasEmergent) return;
      const e = Math.asin(sinE);

      // Hit point on right face
      const exitFrac = 0.35 + idx * 0.04;
      const exitX = topX + exitFrac * (brX - topX);
      const exitY = topY + exitFrac * (brY - topY);

      // Ray inside prism
      ctx.strokeStyle = band.color;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.moveTo(hitX, hitY);
      ctx.lineTo(exitX, exitY);
      ctx.stroke();

      // Emergent dispersed ray
      const emergentAngle = rightFaceNormal - e;
      const emergentLen = w * 0.18 + idx * 8;
      const emEndX = exitX + emergentLen * Math.cos(emergentAngle);
      const emEndY = exitY + emergentLen * Math.sin(emergentAngle);

      ctx.strokeStyle = band.color;
      ctx.lineWidth = 2.5;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.moveTo(exitX, exitY);
      ctx.lineTo(emEndX, emEndY);
      ctx.stroke();
      ctx.globalAlpha = 1;

      // Color label
      ctx.fillStyle = band.color;
      ctx.font = '9px system-ui';
      ctx.textAlign = 'left';
      ctx.fillText(band.name, emEndX + 4, emEndY + 3);
    });

    // Labels
    ctx.fillStyle = '#334155';
    ctx.font = 'bold 10px system-ui';
    ctx.textAlign = 'left';
    ctx.fillText(`Angle of incidence: ${incidentAngle}\u00B0`, 8, h - 24);
    ctx.font = '10px system-ui';
    ctx.fillStyle = '#64748b';
    ctx.fillText('White light disperses into VIBGYOR', 8, h - 10);

    ctx.textAlign = 'right';
    ctx.fillStyle = '#f59e0b';
    ctx.font = '10px system-ui';
    ctx.fillText('\u25CF White (incident)', w - 8, 15);
    ctx.fillStyle = '#FF0000';
    ctx.fillText('\u25CF VIBGYOR (dispersed)', w - 8, 28);
  }

  function drawArrow(ctx: CanvasRenderingContext2D, fromX: number, fromY: number, toX: number, toY: number, color: string) {
    const angle = Math.atan2(toY - fromY, toX - fromX);
    const midX = (fromX + toX) / 2;
    const midY = (fromY + toY) / 2;
    const size = 8;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(midX + size * Math.cos(angle), midY + size * Math.sin(angle));
    ctx.lineTo(midX - size * Math.cos(angle - 0.5), midY - size * Math.sin(angle - 0.5));
    ctx.lineTo(midX - size * Math.cos(angle + 0.5), midY - size * Math.sin(angle + 0.5));
    ctx.closePath();
    ctx.fill();
  }

  useEffect(() => { draw(); }, [draw, canvasSize]);

  // Computed values for info panel
  const theta1Rad = incidentAngle * Math.PI / 180;
  const sinTheta2 = Math.sin(theta1Rad) / GLASS_N;
  const theta2Rad = Math.asin(Math.min(sinTheta2, 1));
  const theta2Deg = theta2Rad * 180 / Math.PI;
  const slabThickness = 100; // arbitrary units
  const lateralDisp = slabThickness * Math.sin(theta1Rad - theta2Rad) / Math.cos(theta2Rad);

  return (
    <div ref={containerRef} style={{
      fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
      maxWidth: 640,
      margin: '0 auto',
      padding: '16px',
    }}>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: 12 }}>
        <div style={{
          fontSize: 'clamp(1.1rem, 3vw, 1.5rem)',
          fontWeight: 800,
          color: '#1e293b',
        }}>
          Refraction Through {mode === 'slab' ? 'Glass Slab' : 'Glass Prism'}
        </div>
        <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
          {mode === 'slab'
            ? 'Emergent ray is parallel to incident ray with lateral displacement'
            : 'White light disperses into VIBGYOR spectrum'}
        </div>
      </div>

      {/* Mode toggle */}
      <div style={{
        display: 'flex',
        gap: 0,
        borderRadius: 10,
        overflow: 'hidden',
        border: '1px solid #e2e8f0',
        marginBottom: 12,
        maxWidth: 300,
        margin: '0 auto 12px',
      }}>
        {(['slab', 'prism'] as Mode[]).map(m => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            style={{
              flex: 1,
              padding: '10px 16px',
              background: mode === m ? '#3b82f6' : '#fff',
              color: mode === m ? '#fff' : '#334155',
              border: 'none',
              cursor: 'pointer',
              fontSize: '0.85rem',
              fontWeight: 700,
              transition: 'all 0.2s ease',
              minHeight: '44px',
            }}
            aria-label={`Switch to ${m === 'slab' ? 'glass slab' : 'prism dispersion'} mode`}
          >
            {m === 'slab' ? 'Glass Slab' : 'Prism (Dispersion)'}
          </button>
        ))}
      </div>

      {/* Canvas */}
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={mode === 'slab'
          ? `Refraction through glass slab with incident angle ${incidentAngle} degrees`
          : `Dispersion of white light through glass prism at ${incidentAngle} degrees`}
        style={{
          width: '100%',
          height: canvasSize.h,
          borderRadius: 10,
          border: '1px solid #e2e8f0',
          background: '#f8fafc',
        }}
      />

      {/* Controls */}
      <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
        <div style={{
          padding: '10px 14px',
          background: '#fffbeb',
          borderRadius: 8,
          border: '1px solid #fde68a',
        }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#92400e', marginBottom: 4 }}>
            Angle of Incidence (i)
          </div>
          <input
            type="range"
            min={5}
            max={80}
            step={1}
            value={incidentAngle}
            onChange={e => setIncidentAngle(Number(e.target.value))}
            aria-label={`Angle of incidence slider, ${incidentAngle} degrees`}
            style={{ width: '100%', accentColor: '#f59e0b' }}
          />
          <div style={{ fontSize: 16, fontWeight: 700, color: '#1e293b', textAlign: 'center' }}>
            {incidentAngle}\u00B0
          </div>
        </div>

        {mode === 'slab' && (
          <label style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 14px',
            background: '#f0fdf4',
            borderRadius: 8,
            border: '1px solid #bbf7d0',
            cursor: 'pointer',
            fontSize: '0.85rem',
            fontWeight: 600,
            color: '#166534',
            minHeight: '44px',
          }}>
            <input
              type="checkbox"
              checked={showMeasurements}
              onChange={e => setShowMeasurements(e.target.checked)}
              style={{ accentColor: '#22c55e', width: 18, height: 18 }}
            />
            Show angle measurements
          </label>
        )}
      </div>

      {/* Info panel */}
      <div style={{
        marginTop: 12,
        padding: '12px 14px',
        background: '#f0f9ff',
        borderRadius: 8,
        border: '1px solid #bae6fd',
      }}>
        {mode === 'slab' ? (
          <div>
            <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#0c4a6e', marginBottom: 6 }}>
              Measurements
            </div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '6px 16px',
              fontSize: '0.78rem',
              color: '#334155',
            }}>
              <div>Angle of incidence (i):</div>
              <div style={{ fontWeight: 700 }}>{incidentAngle}\u00B0</div>
              <div>Angle of refraction (r):</div>
              <div style={{ fontWeight: 700 }}>{theta2Deg.toFixed(1)}\u00B0</div>
              <div>Angle of emergence (e):</div>
              <div style={{ fontWeight: 700 }}>{incidentAngle}\u00B0 (= i)</div>
              <div>Lateral displacement (d):</div>
              <div style={{ fontWeight: 700 }}>{lateralDisp.toFixed(1)} units</div>
              <div>Snell&apos;s Law:</div>
              <div style={{ fontWeight: 700 }}>n = sin(i)/sin(r) = {(Math.sin(theta1Rad) / Math.sin(theta2Rad)).toFixed(2)}</div>
            </div>
            <div style={{ fontSize: '0.72rem', color: '#6366f1', marginTop: 8, fontWeight: 600 }}>
              The emergent ray is always parallel to the incident ray because the two refracting surfaces are parallel.
            </div>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#0c4a6e', marginBottom: 6 }}>
              Dispersion of White Light
            </div>
            <div style={{ fontSize: '0.78rem', color: '#334155', lineHeight: 1.7 }}>
              <p style={{ margin: '0 0 4px' }}>
                White light splits into <strong>7 colours</strong> (VIBGYOR) because each colour has a <strong>different refractive index</strong>.
              </p>
              <p style={{ margin: '0 0 4px' }}>
                <strong>Violet</strong> bends most (n = 1.532) and <strong>Red</strong> bends least (n = 1.509).
              </p>
              <p style={{ margin: 0 }}>
                This was first demonstrated by <strong>Isaac Newton</strong> using two prisms.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{
        textAlign: 'center',
        marginTop: 16,
        fontSize: '0.7rem',
        color: '#94a3b8',
      }}>
        CBSE Class 10 Physics &mdash; Ch 10: Light &mdash; Reflection and Refraction
      </div>
    </div>
  );
}
