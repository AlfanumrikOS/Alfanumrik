'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';

/**
 * Magnet Field Lines Simulation
 * CBSE Class 6 Ch13 — Fun with Magnets, Class 7 Ch14 — Electric Current and its Effects
 *
 * Bar magnet with animated field lines flowing N->S (outside), S->N (inside).
 * Draggable compass needle that aligns to the local field direction.
 * Toggle: single magnet / two magnets (attract N-S or repel N-N).
 */

type MagnetMode = 'single' | 'attract' | 'repel';

interface Vec2 {
  x: number;
  y: number;
}

function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

function scale(v: Vec2, s: number): Vec2 {
  return { x: v.x * s, y: v.y * s };
}

function mag(v: Vec2): number {
  return Math.sqrt(v.x * v.x + v.y * v.y);
}

function norm(v: Vec2): Vec2 {
  const m = mag(v);
  return m > 0 ? { x: v.x / m, y: v.y / m } : { x: 0, y: 0 };
}

// Magnetic dipole field at point p from a dipole at pos with moment direction dir
function dipoleField(p: Vec2, pos: Vec2, dir: Vec2, strength: number): Vec2 {
  const r = sub(p, pos);
  const rMag = mag(r);
  if (rMag < 20) return { x: 0, y: 0 };
  const rNorm = norm(r);
  const mDotR = dir.x * rNorm.x + dir.y * rNorm.y;
  const factor = strength / (rMag * rMag * rMag);
  return {
    x: factor * (3 * mDotR * rNorm.x - dir.x),
    y: factor * (3 * mDotR * rNorm.y - dir.y),
  };
}

const COLORS = {
  bg: '#0f172a',
  magnetN: '#ef4444',
  magnetS: '#3b82f6',
  magnetBody: '#64748b',
  fieldLine: 'rgba(168, 162, 158, 0.6)',
  compass: '#fbbf24',
  compassNeedle: '#ef4444',
  compassS: '#3b82f6',
  text: '#e2e8f0',
  textDim: '#94a3b8',
};

export default function MagnetFieldLines() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number>(0);
  const compassRef = useRef<Vec2>({ x: 200, y: 100 });
  const draggingRef = useRef(false);
  const timeRef = useRef(0);

  const [mode, setMode] = useState<MagnetMode>('single');

  // Get combined field from all magnets at a point
  const getField = useCallback(
    (p: Vec2, cx: number, cy: number, w: number): Vec2 => {
      const strength = 500000;
      if (mode === 'single') {
        return dipoleField(p, { x: cx, y: cy }, { x: 1, y: 0 }, strength);
      } else if (mode === 'attract') {
        // N-S attract: left magnet pointing right, right magnet pointing right
        const gap = Math.min(w * 0.2, 100);
        const f1 = dipoleField(p, { x: cx - gap, y: cy }, { x: 1, y: 0 }, strength);
        const f2 = dipoleField(p, { x: cx + gap, y: cy }, { x: 1, y: 0 }, strength);
        return add(f1, f2);
      } else {
        // N-N repel: left pointing right, right pointing LEFT
        const gap = Math.min(w * 0.2, 100);
        const f1 = dipoleField(p, { x: cx - gap, y: cy }, { x: 1, y: 0 }, strength);
        const f2 = dipoleField(p, { x: cx + gap, y: cy }, { x: -1, y: 0 }, strength);
        return add(f1, f2);
      }
    },
    [mode]
  );

  // Trace a field line from a starting point
  const traceFieldLine = useCallback(
    (
      startX: number,
      startY: number,
      cx: number,
      cy: number,
      w: number,
      h: number,
      steps: number,
      stepSize: number,
      forward: boolean
    ): Vec2[] => {
      const points: Vec2[] = [];
      let p: Vec2 = { x: startX, y: startY };
      for (let i = 0; i < steps; i++) {
        points.push({ x: p.x, y: p.y });
        const f = getField(p, cx, cy, w);
        const fMag = mag(f);
        if (fMag < 0.001) break;
        const fNorm = norm(f);
        const dir = forward ? 1 : -1;
        p = {
          x: p.x + fNorm.x * stepSize * dir,
          y: p.y + fNorm.y * stepSize * dir,
        };
        if (p.x < -20 || p.x > w + 20 || p.y < -20 || p.y > h + 20) break;
      }
      return points;
    },
    [getField]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;

    const resizeCanvas = () => {
      const rect = container.getBoundingClientRect();
      const h = Math.min(rect.width * 0.7, 500);
      canvas.width = rect.width * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Reset compass position to sensible default
      compassRef.current = { x: rect.width * 0.7, y: h * 0.3 };
    };

    resizeCanvas();
    const resizeObserver = new ResizeObserver(resizeCanvas);
    resizeObserver.observe(container);

    // Pointer events for compass dragging
    const getCanvasPos = (e: PointerEvent): Vec2 => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const onPointerDown = (e: PointerEvent) => {
      const pos = getCanvasPos(e);
      const dist = mag(sub(pos, compassRef.current));
      if (dist < 30) {
        draggingRef.current = true;
        canvas.setPointerCapture(e.pointerId);
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (draggingRef.current) {
        compassRef.current = getCanvasPos(e);
      }
    };

    const onPointerUp = () => {
      draggingRef.current = false;
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);

    const draw = (timestamp: number) => {
      timeRef.current = timestamp * 0.001;
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      const cx = w / 2;
      const cy = h / 2;

      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = COLORS.bg;
      ctx.fillRect(0, 0, w, h);

      // -- Draw magnets --
      const magnetW = Math.min(w * 0.18, 100);
      const magnetH = Math.min(h * 0.12, 40);

      const drawMagnet = (mx: number, my: number, flipped: boolean) => {
        // N pole (left or right depending on flipped)
        const nX = flipped ? mx + magnetW / 2 : mx - magnetW / 2;
        const sX = flipped ? mx - magnetW / 2 : mx + magnetW / 2;

        // Left half
        ctx.fillStyle = flipped ? COLORS.magnetS : COLORS.magnetN;
        ctx.fillRect(mx - magnetW / 2, my - magnetH / 2, magnetW / 2, magnetH);
        // Right half
        ctx.fillStyle = flipped ? COLORS.magnetN : COLORS.magnetS;
        ctx.fillRect(mx, my - magnetH / 2, magnetW / 2, magnetH);
        // Border
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(mx - magnetW / 2, my - magnetH / 2, magnetW, magnetH);

        // Labels
        ctx.fillStyle = '#fff';
        ctx.font = `bold ${Math.min(16, magnetH * 0.45)}px system-ui`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(flipped ? 'S' : 'N', mx - magnetW / 4, my);
        ctx.fillText(flipped ? 'N' : 'S', mx + magnetW / 4, my);
      };

      if (mode === 'single') {
        drawMagnet(cx, cy, false);
      } else if (mode === 'attract') {
        const gap = Math.min(w * 0.2, 100);
        drawMagnet(cx - gap, cy, false);
        drawMagnet(cx + gap, cy, false);
      } else {
        const gap = Math.min(w * 0.2, 100);
        drawMagnet(cx - gap, cy, false);
        drawMagnet(cx + gap, cy, true);
      }

      // -- Draw field lines --
      const numLines = 12;
      const lineTime = timeRef.current;

      for (let i = 0; i < numLines; i++) {
        const angle = (i / numLines) * Math.PI * 2;
        const startR = magnetW / 2 + 5;
        let startX: number, startY: number;

        if (mode === 'single') {
          startX = cx + Math.cos(angle) * startR;
          startY = cy + Math.sin(angle) * startR;
        } else {
          const gap = Math.min(w * 0.2, 100);
          // Start lines from left magnet's N pole and right magnet
          if (i < numLines / 2) {
            const subAngle = -Math.PI / 2 + (i / (numLines / 2 - 1)) * Math.PI;
            startX = cx - gap - magnetW / 2 + Math.cos(subAngle) * startR;
            startY = cy + Math.sin(subAngle) * startR;
          } else {
            const j = i - numLines / 2;
            const subAngle = Math.PI / 2 + (j / (numLines / 2 - 1)) * Math.PI;
            if (mode === 'attract') {
              startX = cx + gap + magnetW / 2 + Math.cos(subAngle + Math.PI) * startR;
              startY = cy + Math.sin(subAngle + Math.PI) * startR;
            } else {
              startX = cx + gap + magnetW / 2 + Math.cos(subAngle) * startR;
              startY = cy + Math.sin(subAngle) * startR;
            }
          }
        }

        const pts = traceFieldLine(startX, startY, cx, cy, w, h, 120, 4, true);

        if (pts.length > 2) {
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          for (let j = 1; j < pts.length; j++) {
            ctx.lineTo(pts[j].x, pts[j].y);
          }
          ctx.strokeStyle = COLORS.fieldLine;
          ctx.lineWidth = 1.5;
          ctx.stroke();

          // Animated dots flowing along field lines
          const dotCount = 3;
          for (let d = 0; d < dotCount; d++) {
            const rawIdx =
              ((lineTime * 15 + (d / dotCount) * pts.length + i * 7) % pts.length);
            const idx = Math.floor(rawIdx);
            if (idx >= 0 && idx < pts.length) {
              ctx.beginPath();
              ctx.arc(pts[idx].x, pts[idx].y, 2.5, 0, Math.PI * 2);
              ctx.fillStyle = 'rgba(251, 191, 36, 0.8)';
              ctx.fill();
            }
          }
        }
      }

      // -- Draw compass --
      const cp = compassRef.current;
      const field = getField(cp, cx, cy, w);
      const fieldAngle = Math.atan2(field.y, field.x);

      // Compass body
      ctx.beginPath();
      ctx.arc(cp.x, cp.y, 20, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(30, 41, 59, 0.9)';
      ctx.fill();
      ctx.strokeStyle = COLORS.compass;
      ctx.lineWidth = 2;
      ctx.stroke();

      // N needle (red, points along field)
      ctx.beginPath();
      ctx.moveTo(cp.x, cp.y);
      ctx.lineTo(
        cp.x + Math.cos(fieldAngle) * 16,
        cp.y + Math.sin(fieldAngle) * 16
      );
      ctx.strokeStyle = COLORS.compassNeedle;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.stroke();

      // S needle (blue, opposite)
      ctx.beginPath();
      ctx.moveTo(cp.x, cp.y);
      ctx.lineTo(
        cp.x + Math.cos(fieldAngle + Math.PI) * 16,
        cp.y + Math.sin(fieldAngle + Math.PI) * 16
      );
      ctx.strokeStyle = COLORS.compassS;
      ctx.lineWidth = 3;
      ctx.stroke();

      // Center dot
      ctx.beginPath();
      ctx.arc(cp.x, cp.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();

      // Compass label
      ctx.fillStyle = COLORS.textDim;
      ctx.font = '10px system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText('Drag me!', cp.x, cp.y + 24);

      // Title on canvas
      ctx.fillStyle = COLORS.text;
      ctx.font = 'bold 14px system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(
        mode === 'single'
          ? 'Single Bar Magnet'
          : mode === 'attract'
          ? 'Two Magnets — Attraction (N-S)'
          : 'Two Magnets — Repulsion (N-N)',
        cx,
        12
      );

      // Legend
      ctx.fillStyle = COLORS.textDim;
      ctx.font = '11px system-ui';
      ctx.textAlign = 'left';
      ctx.fillText('Field lines flow N to S (outside magnet)', 12, h - 18);

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
  }, [mode, getField, traceFieldLine]);

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
            background: 'linear-gradient(90deg, #ef4444, #94a3b8, #3b82f6)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}
        >
          Magnetic Field Lines
        </h1>
        <p
          style={{
            margin: '4px 0 0',
            fontSize: 'clamp(0.8rem, 2vw, 0.95rem)',
            color: COLORS.textDim,
          }}
        >
          Drag the compass around the magnet to see how the needle aligns
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

      {/* Mode controls */}
      <div
        style={{
          maxWidth: '600px',
          margin: '16px auto 0',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
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
              { key: 'single', label: 'Single Magnet' },
              { key: 'attract', label: 'Attract (N-S)' },
              { key: 'repel', label: 'Repel (N-N)' },
            ] as { key: MagnetMode; label: string }[]
          ).map((m) => (
            <button
              key={m.key}
              onClick={() => setMode(m.key)}
              type="button"
              style={{
                padding: '10px 18px',
                borderRadius: '10px',
                border: `2px solid ${
                  mode === m.key ? '#60a5fa' : 'rgba(255,255,255,0.15)'
                }`,
                background:
                  mode === m.key
                    ? 'rgba(96,165,250,0.15)'
                    : 'rgba(255,255,255,0.05)',
                color: mode === m.key ? '#93c5fd' : COLORS.textDim,
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
          {mode === 'single' ? (
            <>
              <strong style={{ color: '#fbbf24' }}>Magnetic field lines</strong>{' '}
              emerge from the <strong style={{ color: COLORS.magnetN }}>North pole</strong>{' '}
              and curve around to enter the{' '}
              <strong style={{ color: COLORS.magnetS }}>South pole</strong>. A compass
              needle aligns with the local field direction — the red end always
              points toward the geographic North (which is actually a magnetic
              South pole).
            </>
          ) : mode === 'attract' ? (
            <>
              When <strong style={{ color: COLORS.magnetN }}>N</strong> faces{' '}
              <strong style={{ color: COLORS.magnetS }}>S</strong>, the field lines
              connect the two magnets smoothly — they <em>attract</em> each other.
              The field between them is strong and concentrated.
            </>
          ) : (
            <>
              When <strong style={{ color: COLORS.magnetN }}>N</strong> faces{' '}
              <strong style={{ color: COLORS.magnetN }}>N</strong>, the field lines
              push apart — they <em>repel</em> each other. You can see a neutral
              point between them where the field nearly cancels out.
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
        CBSE Class 6-8 Science — Fun with Magnets
      </div>
    </div>
  );
}
