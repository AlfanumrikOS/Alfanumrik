'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';

/**
 * Light Reflection Simulation
 * CBSE Class 6 Ch11 — Light, Shadows and Reflections
 * CBSE Class 8 Ch16 — Light
 *
 * Flat mirror with draggable incident ray angle.
 * Shows reflected ray with angle i = angle r.
 * Normal line, protractor markings.
 * Toggle: plane / concave / convex mirror.
 */

type MirrorType = 'plane' | 'concave' | 'convex';

const COLORS = {
  bg: '#0f172a',
  mirror: '#94a3b8',
  mirrorSurface: '#e2e8f0',
  incident: '#fbbf24',
  reflected: '#22c55e',
  normal: '#60a5fa',
  protractor: 'rgba(148, 163, 184, 0.3)',
  protractorText: '#94a3b8',
  text: '#e2e8f0',
  textDim: '#94a3b8',
};

function degToRad(d: number): number {
  return (d * Math.PI) / 180;
}

function radToDeg(r: number): number {
  return (r * 180) / Math.PI;
}

export default function LightReflection() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number>(0);
  const angleRef = useRef(45); // angle of incidence in degrees
  const draggingRef = useRef(false);

  const [mirrorType, setMirrorType] = useState<MirrorType>('plane');
  const [angle, setAngle] = useState(45);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;

    const resizeCanvas = () => {
      const rect = container.getBoundingClientRect();
      const h = Math.min(rect.width * 0.75, 520);
      canvas.width = rect.width * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resizeCanvas();
    const resizeObserver = new ResizeObserver(resizeCanvas);
    resizeObserver.observe(container);

    // Pointer events for angle dragging
    const getCanvasPos = (e: PointerEvent): { x: number; y: number } => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const onPointerDown = (e: PointerEvent) => {
      draggingRef.current = true;
      canvas.setPointerCapture(e.pointerId);
      updateAngleFromPointer(e);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (draggingRef.current) {
        updateAngleFromPointer(e);
      }
    };

    const onPointerUp = () => {
      draggingRef.current = false;
    };

    const updateAngleFromPointer = (e: PointerEvent) => {
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      const mirrorY = h * 0.6;
      const mirrorX = w / 2;
      const pos = getCanvasPos(e);
      // Only allow dragging above the mirror
      if (pos.y < mirrorY) {
        const dx = pos.x - mirrorX;
        const dy = mirrorY - pos.y;
        let a = radToDeg(Math.atan2(Math.abs(dx), dy));
        a = Math.max(5, Math.min(80, a));
        angleRef.current = Math.round(a);
        setAngle(Math.round(a));
      }
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);

    const drawDash = (
      ctx: CanvasRenderingContext2D,
      x1: number,
      y1: number,
      x2: number,
      y2: number,
      dashLen: number
    ) => {
      ctx.setLineDash([dashLen, dashLen * 0.6]);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.setLineDash([]);
    };

    const draw = () => {
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      const cx = w / 2;
      const mirrorY = h * 0.6;

      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = COLORS.bg;
      ctx.fillRect(0, 0, w, h);

      const mW = Math.min(w * 0.6, 350);
      const incAngle = degToRad(angleRef.current);

      // -- Draw mirror --
      ctx.save();
      if (mirrorType === 'plane') {
        // Flat mirror line
        ctx.beginPath();
        ctx.moveTo(cx - mW / 2, mirrorY);
        ctx.lineTo(cx + mW / 2, mirrorY);
        ctx.strokeStyle = COLORS.mirrorSurface;
        ctx.lineWidth = 4;
        ctx.stroke();

        // Hatching below mirror
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.3)';
        ctx.lineWidth = 1;
        for (let x = cx - mW / 2; x <= cx + mW / 2; x += 12) {
          ctx.beginPath();
          ctx.moveTo(x, mirrorY + 1);
          ctx.lineTo(x - 10, mirrorY + 14);
          ctx.stroke();
        }
      } else if (mirrorType === 'concave') {
        // Curved concave mirror (curves upward at edges)
        const curveHeight = 30;
        ctx.beginPath();
        ctx.moveTo(cx - mW / 2, mirrorY - curveHeight);
        ctx.quadraticCurveTo(cx, mirrorY + curveHeight * 0.5, cx + mW / 2, mirrorY - curveHeight);
        ctx.strokeStyle = COLORS.mirrorSurface;
        ctx.lineWidth = 4;
        ctx.stroke();

        // F and C labels
        const f = mW * 0.3;
        ctx.fillStyle = '#f97316';
        ctx.font = 'bold 12px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText('F', cx, mirrorY - f + 16);
        ctx.beginPath();
        ctx.arc(cx, mirrorY - f + 4, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillText('C', cx, mirrorY - f * 2 + 16);
        ctx.beginPath();
        ctx.arc(cx, mirrorY - f * 2 + 4, 3, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Curved convex mirror (curves downward at edges)
        const curveHeight = 30;
        ctx.beginPath();
        ctx.moveTo(cx - mW / 2, mirrorY + curveHeight);
        ctx.quadraticCurveTo(cx, mirrorY - curveHeight * 0.5, cx + mW / 2, mirrorY + curveHeight);
        ctx.strokeStyle = COLORS.mirrorSurface;
        ctx.lineWidth = 4;
        ctx.stroke();

        // F and C labels (behind mirror for convex)
        const f = mW * 0.3;
        ctx.fillStyle = '#f97316';
        ctx.font = 'bold 12px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText('F', cx, mirrorY + f - 4);
        ctx.beginPath();
        ctx.arc(cx, mirrorY + f + 4, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillText('C', cx, mirrorY + f * 2 - 4);
        ctx.beginPath();
        ctx.arc(cx, mirrorY + f * 2 + 4, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // -- Draw Normal (dashed vertical line) --
      ctx.strokeStyle = COLORS.normal;
      ctx.lineWidth = 1.5;
      drawDash(ctx, cx, mirrorY - 150, cx, mirrorY + 10, 6);

      // Normal label
      ctx.fillStyle = COLORS.normal;
      ctx.font = '11px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('Normal', cx + 30, mirrorY - 140);

      // -- Draw Protractor arc --
      const protR = Math.min(mW * 0.35, 110);
      ctx.strokeStyle = COLORS.protractor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, mirrorY, protR, -Math.PI, 0);
      ctx.stroke();

      // Protractor tick marks every 10 degrees
      for (let deg = 0; deg <= 90; deg += 10) {
        const rad = degToRad(deg);
        const innerR = protR - 6;
        const outerR = protR + 2;
        // Left side (incident side)
        const lx1 = cx - Math.sin(rad) * innerR;
        const ly1 = mirrorY - Math.cos(rad) * innerR;
        const lx2 = cx - Math.sin(rad) * outerR;
        const ly2 = mirrorY - Math.cos(rad) * outerR;
        ctx.beginPath();
        ctx.moveTo(lx1, ly1);
        ctx.lineTo(lx2, ly2);
        ctx.stroke();

        // Right side (reflected side)
        const rx1 = cx + Math.sin(rad) * innerR;
        const ry1 = mirrorY - Math.cos(rad) * innerR;
        const rx2 = cx + Math.sin(rad) * outerR;
        const ry2 = mirrorY - Math.cos(rad) * outerR;
        ctx.beginPath();
        ctx.moveTo(rx1, ry1);
        ctx.lineTo(rx2, ry2);
        ctx.stroke();

        // Labels
        if (deg > 0 && deg < 90) {
          ctx.fillStyle = COLORS.protractorText;
          ctx.font = '9px system-ui';
          ctx.textAlign = 'center';
          const labelR = protR + 14;
          ctx.fillText(
            `${deg}`,
            cx - Math.sin(rad) * labelR,
            mirrorY - Math.cos(rad) * labelR + 3
          );
          ctx.fillText(
            `${deg}`,
            cx + Math.sin(rad) * labelR,
            mirrorY - Math.cos(rad) * labelR + 3
          );
        }
      }

      // -- Draw Incident Ray --
      const rayLen = Math.min(h * 0.5, 200);
      const incStartX = cx - Math.sin(incAngle) * rayLen;
      const incStartY = mirrorY - Math.cos(incAngle) * rayLen;

      // Ray line
      ctx.beginPath();
      ctx.moveTo(incStartX, incStartY);
      ctx.lineTo(cx, mirrorY);
      ctx.strokeStyle = COLORS.incident;
      ctx.lineWidth = 3;
      ctx.stroke();

      // Arrow head on incident ray
      const arrowSize = 10;
      const arrowAngle = Math.atan2(mirrorY - incStartY, cx - incStartX);
      ctx.beginPath();
      ctx.moveTo(
        cx - Math.cos(arrowAngle) * 40 + Math.cos(arrowAngle - 0.4) * arrowSize,
        mirrorY - Math.sin(arrowAngle) * 40 - Math.sin(0.4 - arrowAngle) * arrowSize
      );
      ctx.lineTo(cx - Math.cos(arrowAngle) * 40, mirrorY - Math.sin(arrowAngle) * 40);
      ctx.lineTo(
        cx - Math.cos(arrowAngle) * 40 + Math.cos(arrowAngle + 0.4) * arrowSize,
        mirrorY - Math.sin(arrowAngle) * 40 + Math.sin(arrowAngle + 0.4) * arrowSize
      );
      ctx.strokeStyle = COLORS.incident;
      ctx.lineWidth = 2.5;
      ctx.stroke();

      // Incident ray label
      ctx.fillStyle = COLORS.incident;
      ctx.font = 'bold 12px system-ui';
      ctx.textAlign = 'right';
      ctx.fillText('Incident Ray', incStartX + 10, incStartY + 16);

      // -- Draw Reflected Ray --
      // For plane mirror, angle of reflection = angle of incidence
      let reflAngle = incAngle;
      if (mirrorType === 'concave') {
        // Slightly converge (simplified)
        reflAngle = incAngle * 0.85;
      } else if (mirrorType === 'convex') {
        // Slightly diverge (simplified)
        reflAngle = incAngle * 1.15;
      }

      const refEndX = cx + Math.sin(reflAngle) * rayLen;
      const refEndY = mirrorY - Math.cos(reflAngle) * rayLen;

      ctx.beginPath();
      ctx.moveTo(cx, mirrorY);
      ctx.lineTo(refEndX, refEndY);
      ctx.strokeStyle = COLORS.reflected;
      ctx.lineWidth = 3;
      ctx.stroke();

      // Arrow head on reflected ray
      const refArrowAngle = Math.atan2(refEndY - mirrorY, refEndX - cx);
      const arrowMidX = cx + Math.cos(refArrowAngle) * 40;
      const arrowMidY = mirrorY + Math.sin(refArrowAngle) * 40;
      ctx.beginPath();
      ctx.moveTo(
        arrowMidX - Math.cos(refArrowAngle - 0.4) * arrowSize,
        arrowMidY - Math.sin(refArrowAngle - 0.4) * arrowSize
      );
      ctx.lineTo(arrowMidX, arrowMidY);
      ctx.lineTo(
        arrowMidX - Math.cos(refArrowAngle + 0.4) * arrowSize,
        arrowMidY - Math.sin(refArrowAngle + 0.4) * arrowSize
      );
      ctx.strokeStyle = COLORS.reflected;
      ctx.lineWidth = 2.5;
      ctx.stroke();

      // Reflected ray label
      ctx.fillStyle = COLORS.reflected;
      ctx.font = 'bold 12px system-ui';
      ctx.textAlign = 'left';
      ctx.fillText('Reflected Ray', refEndX - 10, refEndY + 16);

      // -- Draw angle arcs and labels --
      const arcR = 40;

      // Angle of incidence arc (between normal and incident ray, measured from -Y)
      ctx.beginPath();
      ctx.arc(cx, mirrorY, arcR, -Math.PI / 2 - incAngle, -Math.PI / 2, false);
      ctx.strokeStyle = COLORS.incident;
      ctx.lineWidth = 2;
      ctx.stroke();

      // Angle i label
      const iLabelAngle = -Math.PI / 2 - incAngle / 2;
      ctx.fillStyle = COLORS.incident;
      ctx.font = 'bold 13px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(
        `i = ${angleRef.current}°`,
        cx + Math.cos(iLabelAngle) * (arcR + 20),
        mirrorY + Math.sin(iLabelAngle) * (arcR + 20) + 4
      );

      // Angle of reflection arc
      ctx.beginPath();
      ctx.arc(cx, mirrorY, arcR, -Math.PI / 2, -Math.PI / 2 + reflAngle, false);
      ctx.strokeStyle = COLORS.reflected;
      ctx.lineWidth = 2;
      ctx.stroke();

      // Angle r label
      const rLabelAngle = -Math.PI / 2 + reflAngle / 2;
      const reflDeg = Math.round(radToDeg(reflAngle));
      ctx.fillStyle = COLORS.reflected;
      ctx.font = 'bold 13px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(
        `r = ${reflDeg}°`,
        cx + Math.cos(rLabelAngle) * (arcR + 20),
        mirrorY + Math.sin(rLabelAngle) * (arcR + 20) + 4
      );

      // -- Key discovery --
      if (mirrorType === 'plane') {
        ctx.fillStyle = '#22c55e';
        ctx.font = 'bold 14px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText('Angle i = Angle r (Law of Reflection)', cx, 24);
      } else {
        ctx.fillStyle = COLORS.textDim;
        ctx.font = 'bold 13px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText(
          mirrorType === 'concave'
            ? 'Concave Mirror — converges light'
            : 'Convex Mirror — diverges light',
          cx,
          24
        );
      }

      // Drag hint
      ctx.fillStyle = 'rgba(148,163,184,0.5)';
      ctx.font = '11px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('Drag above the mirror to change the angle', cx, h - 12);

      // Draggable handle at incident ray start
      ctx.beginPath();
      ctx.arc(incStartX, incStartY, 10, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(251, 191, 36, 0.3)';
      ctx.fill();
      ctx.strokeStyle = COLORS.incident;
      ctx.lineWidth = 2;
      ctx.stroke();

      animRef.current = requestAnimationFrame(draw);
    };

    animRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(animRef.current);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      resizeObserver.disconnect();
    };
  }, [mirrorType]);

  return (
    <div
      ref={containerRef}
      style={{
        minHeight: '100vh',
        background: `linear-gradient(135deg, ${COLORS.bg} 0%, #1e293b 100%)`,
        padding: '16px',
        fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
        color: COLORS.text,
      }}
    >
      {/* Title */}
      <div style={{ textAlign: 'center', marginBottom: '12px' }}>
        <h1
          style={{
            fontSize: 'clamp(1.3rem, 3.5vw, 2rem)',
            fontWeight: 800,
            margin: 0,
            background: 'linear-gradient(90deg, #fbbf24, #22c55e)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}
        >
          Light Reflection Lab
        </h1>
        <p
          style={{
            margin: '4px 0 0',
            fontSize: 'clamp(0.8rem, 2vw, 0.95rem)',
            color: COLORS.textDim,
          }}
        >
          Drag the ray to change the angle and discover the Law of Reflection
        </p>
      </div>

      {/* Canvas */}
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          borderRadius: '16px',
          border: '1px solid rgba(255,255,255,0.1)',
          background: COLORS.bg,
          display: 'block',
          touchAction: 'none',
          cursor: 'grab',
        }}
      />

      {/* Controls */}
      <div
        style={{
          maxWidth: '600px',
          margin: '16px auto 0',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
        {/* Angle slider */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            justifyContent: 'center',
          }}
        >
          <span style={{ fontSize: '0.85rem', color: COLORS.textDim, minWidth: 100 }}>
            Angle: <strong style={{ color: COLORS.incident }}>{angle}°</strong>
          </span>
          <input
            type="range"
            min={5}
            max={80}
            value={angle}
            onChange={(e) => {
              const val = Number(e.target.value);
              setAngle(val);
              angleRef.current = val;
            }}
            style={{ flex: 1, maxWidth: 250, minHeight: 44 }}
            aria-label="Angle of incidence"
          />
        </div>

        {/* Mirror type */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            gap: '8px',
            flexWrap: 'wrap',
          }}
        >
          {(
            [
              { key: 'plane', label: 'Plane Mirror' },
              { key: 'concave', label: 'Concave Mirror' },
              { key: 'convex', label: 'Convex Mirror' },
            ] as { key: MirrorType; label: string }[]
          ).map((m) => (
            <button
              key={m.key}
              onClick={() => setMirrorType(m.key)}
              type="button"
              style={{
                padding: '10px 18px',
                borderRadius: '10px',
                border: `2px solid ${
                  mirrorType === m.key ? '#60a5fa' : 'rgba(255,255,255,0.15)'
                }`,
                background:
                  mirrorType === m.key
                    ? 'rgba(96,165,250,0.15)'
                    : 'rgba(255,255,255,0.05)',
                color: mirrorType === m.key ? '#93c5fd' : COLORS.textDim,
                fontWeight: 600,
                fontSize: '0.85rem',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                minHeight: '44px',
              }}
            >
              {m.label}
            </button>
          ))}
        </div>

        {/* Info card */}
        <div
          style={{
            background: 'rgba(255,255,255,0.06)',
            borderRadius: '14px',
            padding: '14px 16px',
            border: '1px solid rgba(255,255,255,0.08)',
            fontSize: 'clamp(0.78rem, 1.8vw, 0.88rem)',
            lineHeight: 1.6,
            color: '#cbd5e1',
          }}
        >
          {mirrorType === 'plane' ? (
            <>
              <strong style={{ color: '#22c55e' }}>Law of Reflection:</strong>{' '}
              The angle of incidence (i) always equals the angle of reflection
              (r), measured from the <strong style={{ color: COLORS.normal }}>normal</strong>{' '}
              — an imaginary line perpendicular to the mirror surface. Try different
              angles and verify!
            </>
          ) : mirrorType === 'concave' ? (
            <>
              A <strong style={{ color: '#fbbf24' }}>concave mirror</strong> curves
              inward. Parallel rays converge at the <strong>focus (F)</strong>. Used
              in torches, headlights, and satellite dishes.
            </>
          ) : (
            <>
              A <strong style={{ color: '#fbbf24' }}>convex mirror</strong> curves
              outward. Parallel rays appear to diverge from a virtual focus behind
              the mirror. Used in vehicle rear-view mirrors for a wider field of view.
            </>
          )}
        </div>
      </div>

      {/* Footer */}
      <div
        style={{
          textAlign: 'center',
          marginTop: '16px',
          fontSize: '0.75rem',
          color: '#475569',
        }}
      >
        CBSE Class 6-8 Science — Light, Shadows and Reflections
      </div>
    </div>
  );
}
