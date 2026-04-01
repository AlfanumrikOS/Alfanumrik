'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';

/**
 * Angle Explorer
 *
 * CBSE Class 6 Ch5 — Understanding Elementary Shapes
 * CBSE Class 7 Ch5 — Lines and Angles
 *
 * Two rays from a common vertex. Drag one ray to change the angle.
 * Live measurement, protractor overlay, color-coded classification,
 * complementary / supplementary display, snap to standard angles.
 */

type AngleType = 'acute' | 'right' | 'obtuse' | 'straight' | 'reflex' | 'full';

interface AngleInfo {
  type: AngleType;
  label: string;
  labelHi: string;
  color: string;
  bgColor: string;
}

const BG_COLOR = '#FAFAF9';
const GRID_COLOR = '#F5F0EB';
const RAY_COLOR = '#1C1917';
const PROTRACTOR_COLOR = 'rgba(147, 51, 234, 0.08)';
const PROTRACTOR_STROKE = 'rgba(147, 51, 234, 0.25)';
const BRAND_ORANGE = '#F97316';
const BRAND_PURPLE = '#9333EA';

const SNAP_ANGLES = [0, 30, 45, 60, 90, 120, 135, 150, 180, 210, 225, 240, 270, 300, 315, 330, 360];
const PRESET_ANGLES = [30, 45, 60, 90, 120, 180];

function classifyAngle(deg: number): AngleInfo {
  const d = Math.round(deg * 100) / 100;
  if (d <= 0 || d >= 360) return { type: 'full', label: 'Full Rotation', labelHi: 'पूर्ण घूर्णन', color: '#6B7280', bgColor: '#F3F4F6' };
  if (d < 90) return { type: 'acute', label: 'Acute Angle', labelHi: 'न्यून कोण', color: '#16A34A', bgColor: '#F0FDF4' };
  if (d === 90) return { type: 'right', label: 'Right Angle', labelHi: 'समकोण', color: '#2563EB', bgColor: '#EFF6FF' };
  if (d < 180) return { type: 'obtuse', label: 'Obtuse Angle', labelHi: 'अधिक कोण', color: '#EA580C', bgColor: '#FFF7ED' };
  if (d === 180) return { type: 'straight', label: 'Straight Angle', labelHi: 'ऋजु कोण', color: '#6B7280', bgColor: '#F3F4F6' };
  return { type: 'reflex', label: 'Reflex Angle', labelHi: 'प्रतिवर्ती कोण', color: '#DC2626', bgColor: '#FEF2F2' };
}

function degToRad(d: number): number { return (d * Math.PI) / 180; }
function radToDeg(r: number): number { return ((r * 180) / Math.PI + 360) % 360; }

function formatDeg(d: number): string {
  return `${Math.round(d * 10) / 10}\u00B0`;
}

export default function AngleExplorer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [angle, setAngle] = useState(60); // degrees, measured counterclockwise from fixed ray
  const [isDragging, setIsDragging] = useState(false);
  const [showProtractor, setShowProtractor] = useState(true);
  const [showCompSupp, setShowCompSupp] = useState(true);

  const info = classifyAngle(angle);
  const complementary = angle < 90 ? 90 - angle : null;
  const supplementary = angle < 180 ? 180 - angle : null;

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

    // Background
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, w, h);

    // Grid
    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth = 0.5;
    for (let i = 0; i < w; i += 30) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, h); ctx.stroke();
    }
    for (let i = 0; i < h; i += 30) {
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(w, i); ctx.stroke();
    }

    const cx = w * 0.3;
    const cy = h * 0.65;
    const rayLen = Math.min(w, h) * 0.42;
    const protR = rayLen * 0.55;

    // Protractor overlay
    if (showProtractor) {
      // Filled arc for the angle
      ctx.fillStyle = info.color + '15';
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, protR, -degToRad(angle), 0);
      ctx.closePath();
      ctx.fill();

      // Protractor semicircle background
      ctx.strokeStyle = PROTRACTOR_STROKE;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, protR, -Math.PI, 0);
      ctx.stroke();

      // If reflex, draw full circle
      if (angle > 180) {
        ctx.beginPath();
        ctx.arc(cx, cy, protR, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Tick marks every 10 degrees
      for (let d = 0; d <= 360; d += 10) {
        const a = -degToRad(d);
        const isMain = d % 30 === 0;
        const tickIn = protR - (isMain ? 12 : 6);
        const tickOut = protR + (isMain ? 4 : 2);
        ctx.strokeStyle = d <= 180 ? 'rgba(147,51,234,0.4)' : 'rgba(147,51,234,0.15)';
        ctx.lineWidth = isMain ? 1.2 : 0.6;
        ctx.beginPath();
        ctx.moveTo(cx + tickIn * Math.cos(a), cy + tickIn * Math.sin(a));
        ctx.lineTo(cx + tickOut * Math.cos(a), cy + tickOut * Math.sin(a));
        ctx.stroke();

        // Labels for main ticks
        if (isMain && d <= 180) {
          const labelR = protR - 20;
          ctx.fillStyle = 'rgba(120,113,108,0.7)';
          ctx.font = '10px "Plus Jakarta Sans", sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(`${d}`, cx + labelR * Math.cos(a), cy + labelR * Math.sin(a));
        }
      }
    } else {
      // Simple arc
      ctx.fillStyle = info.color + '15';
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      const arcR = 40;
      if (angle <= 180) {
        ctx.arc(cx, cy, arcR, -degToRad(angle), 0);
      } else {
        ctx.arc(cx, cy, arcR, 0, degToRad(360 - angle), true);
        ctx.lineTo(cx, cy);
      }
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = info.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (angle <= 180) {
        ctx.arc(cx, cy, arcR, -degToRad(angle), 0);
      } else {
        ctx.arc(cx, cy, arcR, 0, -degToRad(angle));
      }
      ctx.stroke();
    }

    // Complementary / supplementary arcs
    if (showCompSupp && angle < 180 && angle > 0) {
      // Supplementary angle (remainder to 180)
      if (supplementary !== null && supplementary > 0) {
        ctx.strokeStyle = 'rgba(37,99,235,0.3)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        const suppR = protR * 0.7;
        ctx.beginPath();
        ctx.arc(cx, cy, suppR, -Math.PI, -degToRad(angle));
        ctx.stroke();
        ctx.setLineDash([]);

        // Label
        const midA = -degToRad((angle + 180) / 2);
        ctx.fillStyle = 'rgba(37,99,235,0.6)';
        ctx.font = '11px "Plus Jakarta Sans", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(
          `${Math.round(supplementary)}\u00B0`,
          cx + (suppR + 16) * Math.cos(midA),
          cy + (suppR + 16) * Math.sin(midA)
        );
      }

      // Complementary angle (remainder to 90)
      if (complementary !== null && complementary > 0) {
        ctx.strokeStyle = 'rgba(22,163,74,0.3)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        const compR = protR * 0.45;
        ctx.beginPath();
        ctx.arc(cx, cy, compR, -degToRad(90), -degToRad(angle));
        ctx.stroke();
        ctx.setLineDash([]);

        const midA = -degToRad((angle + 90) / 2);
        ctx.fillStyle = 'rgba(22,163,74,0.6)';
        ctx.font = '11px "Plus Jakarta Sans", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(
          `${Math.round(complementary)}\u00B0`,
          cx + (compR + 16) * Math.cos(midA),
          cy + (compR + 16) * Math.sin(midA)
        );
      }
    }

    // Right angle square symbol
    if (Math.abs(angle - 90) < 0.5) {
      const sq = 15;
      ctx.strokeStyle = '#2563EB';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx + sq, cy);
      ctx.lineTo(cx + sq, cy - sq);
      ctx.lineTo(cx, cy - sq);
      ctx.stroke();
    }

    // Fixed ray (horizontal right)
    ctx.strokeStyle = RAY_COLOR;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + rayLen, cy);
    ctx.stroke();
    // Arrowhead on fixed ray
    ctx.fillStyle = RAY_COLOR;
    ctx.beginPath();
    ctx.moveTo(cx + rayLen, cy);
    ctx.lineTo(cx + rayLen - 10, cy - 5);
    ctx.lineTo(cx + rayLen - 10, cy + 5);
    ctx.closePath();
    ctx.fill();

    // Movable ray
    const rayAngle = -degToRad(angle);
    const rx = cx + rayLen * Math.cos(rayAngle);
    const ry = cy + rayLen * Math.sin(rayAngle);
    ctx.strokeStyle = info.color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(rx, ry);
    ctx.stroke();
    // Arrowhead on movable ray
    const arrowAngle = rayAngle;
    ctx.fillStyle = info.color;
    ctx.beginPath();
    ctx.moveTo(rx, ry);
    ctx.lineTo(
      rx - 10 * Math.cos(arrowAngle) - 5 * Math.sin(arrowAngle),
      ry + 10 * Math.sin(arrowAngle) * -1 - 5 * Math.cos(arrowAngle)
    );
    ctx.lineTo(
      rx - 10 * Math.cos(arrowAngle) + 5 * Math.sin(arrowAngle),
      ry + 10 * Math.sin(arrowAngle) * -1 + 5 * Math.cos(arrowAngle)
    );
    ctx.closePath();
    ctx.fill();

    // Vertex dot
    ctx.fillStyle = BRAND_ORANGE;
    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#FFF';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Drag handle at end of movable ray
    ctx.fillStyle = isDragging ? '#16A34A' : info.color;
    ctx.beginPath();
    ctx.arc(rx, ry, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#FFF';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Angle value label
    const labelAngle = -degToRad(angle / 2);
    const labelR = Math.min(protR * 0.3, 50);
    ctx.fillStyle = info.color;
    ctx.font = 'bold 16px "Plus Jakarta Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      formatDeg(angle),
      cx + labelR * Math.cos(labelAngle),
      cy + labelR * Math.sin(labelAngle)
    );
  }, [angle, showProtractor, showCompSupp, info, isDragging, complementary, supplementary]);

  useEffect(() => { draw(); }, [draw]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(container);
    return () => ro.disconnect();
  }, [draw]);

  // Pointer drag
  const getAngleFromPointer = useCallback((clientX: number, clientY: number): number => {
    const canvas = canvasRef.current;
    if (!canvas) return angle;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    const cx = w * 0.3;
    const cy = h * 0.65;
    const dx = clientX - rect.left - cx;
    const dy = clientY - rect.top - cy;
    let deg = radToDeg(Math.atan2(-dy, dx));
    // Clamp to 1-359 range
    if (deg <= 0) deg = 0.1;
    if (deg >= 360) deg = 359.9;
    return Math.round(deg * 10) / 10;
  }, [angle]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    setIsDragging(true);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const newAngle = getAngleFromPointer(e.clientX, e.clientY);
    setAngle(newAngle);
  }, [getAngleFromPointer]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging) return;
    const newAngle = getAngleFromPointer(e.clientX, e.clientY);
    setAngle(newAngle);
  }, [isDragging, getAngleFromPointer]);

  const handlePointerUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const setSnappedAngle = useCallback((deg: number) => {
    setAngle(deg);
  }, []);

  return (
    <div className="flex flex-col gap-4 w-full max-w-2xl mx-auto">
      {/* Classification badge */}
      <div className="flex flex-wrap items-center gap-3">
        <span
          className="px-3 py-1.5 rounded-full text-sm font-bold"
          style={{ backgroundColor: info.bgColor, color: info.color }}
        >
          {info.label}
        </span>
        <span className="text-2xl font-bold" style={{ color: info.color }}>
          {formatDeg(angle)}
        </span>
        <div className="flex gap-1 ml-auto">
          <label className="flex items-center gap-1.5 text-xs text-stone-500">
            <input
              type="checkbox"
              checked={showProtractor}
              onChange={(e) => setShowProtractor(e.target.checked)}
              className="rounded border-stone-300 text-purple-500 focus:ring-purple-400 w-4 h-4"
            />
            Protractor
          </label>
          <label className="flex items-center gap-1.5 text-xs text-stone-500 ml-3">
            <input
              type="checkbox"
              checked={showCompSupp}
              onChange={(e) => setShowCompSupp(e.target.checked)}
              className="rounded border-stone-300 text-purple-500 focus:ring-purple-400 w-4 h-4"
            />
            Comp / Supp
          </label>
        </div>
      </div>

      {/* Canvas */}
      <div ref={containerRef} className="relative w-full" style={{ aspectRatio: '4/3' }}>
        <canvas
          ref={canvasRef}
          className="w-full h-full rounded-xl border border-stone-200 cursor-grab active:cursor-grabbing touch-none"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        />
      </div>

      {/* Snap buttons */}
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-xs font-semibold text-stone-500 uppercase tracking-wide mr-1">
          Snap to:
        </span>
        {PRESET_ANGLES.map((d) => (
          <button
            key={d}
            onClick={() => setSnappedAngle(d)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors min-h-[44px] ${
              Math.abs(angle - d) < 1
                ? 'bg-orange-500 text-white border-orange-500'
                : 'bg-white text-stone-600 border-stone-300 hover:bg-orange-50 hover:border-orange-300'
            }`}
          >
            {d}&deg;
          </button>
        ))}
      </div>

      {/* Info cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="bg-stone-50 rounded-xl p-3 text-center">
          <div className="text-xs text-stone-500 font-medium uppercase tracking-wide">Angle</div>
          <div className="text-xl font-bold mt-1" style={{ color: info.color }}>
            {formatDeg(angle)}
          </div>
          <div className="text-xs text-stone-500 mt-0.5">{info.label}</div>
        </div>
        <div className="bg-green-50 rounded-xl p-3 text-center">
          <div className="text-xs text-stone-500 font-medium uppercase tracking-wide">Complementary</div>
          <div className="text-xl font-bold text-green-600 mt-1">
            {complementary !== null && complementary >= 0 ? formatDeg(complementary) : '\u2014'}
          </div>
          <div className="text-xs text-stone-500 mt-0.5">
            {complementary !== null && complementary >= 0 ? `${formatDeg(angle)} + ${formatDeg(complementary)} = 90\u00B0` : 'Only for acute'}
          </div>
        </div>
        <div className="bg-blue-50 rounded-xl p-3 text-center col-span-2 sm:col-span-1">
          <div className="text-xs text-stone-500 font-medium uppercase tracking-wide">Supplementary</div>
          <div className="text-xl font-bold text-blue-600 mt-1">
            {supplementary !== null && supplementary >= 0 ? formatDeg(supplementary) : '\u2014'}
          </div>
          <div className="text-xs text-stone-500 mt-0.5">
            {supplementary !== null && supplementary >= 0 ? `${formatDeg(angle)} + ${formatDeg(supplementary)} = 180\u00B0` : 'Only for < 180\u00B0'}
          </div>
        </div>
      </div>

      {/* Angle classification legend */}
      <div className="flex flex-wrap gap-2">
        {[
          { range: '0\u00B0 - 90\u00B0', label: 'Acute', color: '#16A34A' },
          { range: '= 90\u00B0', label: 'Right', color: '#2563EB' },
          { range: '90\u00B0 - 180\u00B0', label: 'Obtuse', color: '#EA580C' },
          { range: '= 180\u00B0', label: 'Straight', color: '#6B7280' },
          { range: '180\u00B0 - 360\u00B0', label: 'Reflex', color: '#DC2626' },
        ].map((item) => (
          <span
            key={item.label}
            className="flex items-center gap-1.5 text-xs text-stone-600 px-2 py-1 rounded bg-stone-50"
          >
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.color }} />
            <strong>{item.label}</strong>
            <span className="text-stone-400">{item.range}</span>
          </span>
        ))}
      </div>

      {/* Learning tip */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-stone-700">
        <span className="font-semibold text-amber-700">Key Insight: </span>
        Complementary angles add up to 90&deg; and supplementary angles add up to 180&deg;.
        Drag the ray and watch these relationships change in real time!
      </div>
    </div>
  );
}
