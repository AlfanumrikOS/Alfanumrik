'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';

/**
 * Symmetry Explorer
 *
 * CBSE Class 6 Ch13, Class 7 Ch14 — Symmetry
 * Interactive visualization of lines of symmetry and rotational symmetry
 * for regular polygons: triangle, square, pentagon, hexagon, circle.
 */

type ShapeType = 'triangle' | 'square' | 'pentagon' | 'hexagon' | 'circle';

interface ShapeInfo {
  label: string;
  sides: number;
  linesOfSymmetry: number;
  rotationalOrder: number;
}

const SHAPES: Record<ShapeType, ShapeInfo> = {
  triangle:  { label: 'Equilateral Triangle', sides: 3, linesOfSymmetry: 3, rotationalOrder: 3 },
  square:    { label: 'Square',               sides: 4, linesOfSymmetry: 4, rotationalOrder: 4 },
  pentagon:  { label: 'Regular Pentagon',      sides: 5, linesOfSymmetry: 5, rotationalOrder: 5 },
  hexagon:   { label: 'Regular Hexagon',       sides: 6, linesOfSymmetry: 6, rotationalOrder: 6 },
  circle:    { label: 'Circle',               sides: 0, linesOfSymmetry: Infinity, rotationalOrder: Infinity },
};

const BRAND_ORANGE = '#F97316';
const BRAND_PURPLE = '#9333EA';
const SHAPE_FILL = '#FFF7ED';
const SHAPE_STROKE = '#F97316';
const SYMMETRY_LINE_COLOR = '#9333EA';
const HIGHLIGHT_COLOR = '#22C55E';
const GRID_COLOR = '#F5F0EB';
const BG_COLOR = '#FAFAF9';

const SHAPE_RADIUS = 110;
const SNAP_TOLERANCE_DEG = 4;

function degToRad(d: number): number { return (d * Math.PI) / 180; }
function radToDeg(r: number): number { return (r * 180) / Math.PI; }

function normalizeAngle(a: number): number {
  let r = a % 360;
  if (r < 0) r += 360;
  return r;
}

function getPolygonVertices(cx: number, cy: number, r: number, sides: number, rotationDeg: number): { x: number; y: number }[] {
  const verts: { x: number; y: number }[] = [];
  const startAngle = degToRad(-90 + rotationDeg);
  for (let i = 0; i < sides; i++) {
    const a = startAngle + (2 * Math.PI * i) / sides;
    verts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return verts;
}

function getSymmetryLineAngles(sides: number): number[] {
  // Returns angles (in degrees, from vertical/up) for each line of symmetry
  const angles: number[] = [];
  for (let i = 0; i < sides; i++) {
    angles.push((360 / sides) * i / 2);
  }
  return angles;
}

export default function SymmetryExplorer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [shape, setShape] = useState<ShapeType>('triangle');
  const [rotation, setRotation] = useState(0); // degrees
  const [mode, setMode] = useState<'lines' | 'rotational'>('lines');
  const [showAllLines, setShowAllLines] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [highlightedLines, setHighlightedLines] = useState<number[]>([]);
  const dragStartAngle = useRef(0);
  const dragStartRotation = useRef(0);
  const animFrameRef = useRef(0);
  const rotAnimRef = useRef<number>(0);
  const [rotAnimStep, setRotAnimStep] = useState(-1); // -1 = not animating
  const canvasSize = useRef(400);

  const info = SHAPES[shape];

  // Compute which symmetry lines are aligned with current rotation
  const computeAlignedLines = useCallback((rot: number): number[] => {
    if (shape === 'circle') return [0]; // always aligned
    const sides = info.sides;
    const aligned: number[] = [];
    const symmetryAngleStep = 360 / sides;

    for (let i = 0; i < sides; i++) {
      // A line of symmetry at base angle lineAngle
      // The shape repeats symmetry every (360/sides) degrees rotation
      const lineAngle = (symmetryAngleStep * i) / 2;
      // Check if current rotation makes this line align with a symmetry position
      const effectiveRot = normalizeAngle(rot);
      const remainder = effectiveRot % symmetryAngleStep;
      if (remainder < SNAP_TOLERANCE_DEG || (symmetryAngleStep - remainder) < SNAP_TOLERANCE_DEG) {
        aligned.push(i);
      }
    }
    return aligned;
  }, [shape, info.sides]);

  useEffect(() => {
    setHighlightedLines(computeAlignedLines(rotation));
  }, [rotation, computeAlignedLines]);

  // Draw
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
    canvasSize.current = w;

    const cx = w / 2;
    const cy = h / 2;
    const r = Math.min(w, h) * 0.26;

    // Background
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, w, h);

    // Light grid
    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth = 0.5;
    for (let i = 0; i < w; i += 30) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, h); ctx.stroke();
    }
    for (let i = 0; i < h; i += 30) {
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(w, i); ctx.stroke();
    }

    // Center mark
    ctx.fillStyle = '#D6D3D1';
    ctx.beginPath(); ctx.arc(cx, cy, 3, 0, Math.PI * 2); ctx.fill();

    if (shape === 'circle') {
      // Draw circle
      ctx.fillStyle = SHAPE_FILL;
      ctx.strokeStyle = SHAPE_STROKE;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Show some symmetry lines for circle
      if (mode === 'lines') {
        const numToShow = 8;
        for (let i = 0; i < numToShow; i++) {
          const a = degToRad(-90 + rotation + (360 / numToShow) * i);
          ctx.strokeStyle = SYMMETRY_LINE_COLOR;
          ctx.lineWidth = 1.5;
          ctx.setLineDash([6, 4]);
          ctx.beginPath();
          ctx.moveTo(cx + (r + 20) * Math.cos(a), cy + (r + 20) * Math.sin(a));
          ctx.lineTo(cx - (r + 20) * Math.cos(a), cy - (r + 20) * Math.sin(a));
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      // Rotation marker
      const markerAngle = degToRad(-90 + rotation);
      ctx.fillStyle = BRAND_ORANGE;
      ctx.beginPath();
      ctx.arc(cx + r * Math.cos(markerAngle), cy + r * Math.sin(markerAngle), 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#FFF';
      ctx.lineWidth = 2;
      ctx.stroke();
    } else {
      const sides = info.sides;
      const verts = getPolygonVertices(cx, cy, r, sides, rotation);

      // Draw shape fill
      ctx.fillStyle = SHAPE_FILL;
      ctx.strokeStyle = SHAPE_STROKE;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(verts[0].x, verts[0].y);
      for (let i = 1; i < verts.length; i++) {
        ctx.lineTo(verts[i].x, verts[i].y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Vertex dots
      for (const v of verts) {
        ctx.fillStyle = BRAND_ORANGE;
        ctx.beginPath();
        ctx.arc(v.x, v.y, 5, 0, Math.PI * 2);
        ctx.fill();
      }

      // Symmetry lines
      if (mode === 'lines' && showAllLines) {
        const lineLen = r + 30;
        for (let i = 0; i < sides; i++) {
          // For a regular polygon with n sides, the lines of symmetry pass through:
          // - Each vertex to the midpoint of the opposite side (odd n)
          // - Each vertex to opposite vertex + midpoint to midpoint (even n)
          // Simplified: lines at angles (360/n)*i / 2 from starting vertex direction
          const baseAngle = degToRad(-90 + rotation) + (Math.PI * i) / sides;
          const isHighlighted = highlightedLines.includes(i);
          ctx.strokeStyle = isHighlighted ? HIGHLIGHT_COLOR : SYMMETRY_LINE_COLOR;
          ctx.lineWidth = isHighlighted ? 2.5 : 1.5;
          ctx.setLineDash(isHighlighted ? [] : [6, 4]);
          ctx.globalAlpha = isHighlighted ? 1 : 0.6;
          ctx.beginPath();
          ctx.moveTo(cx + lineLen * Math.cos(baseAngle), cy + lineLen * Math.sin(baseAngle));
          ctx.lineTo(cx - lineLen * Math.cos(baseAngle), cy - lineLen * Math.sin(baseAngle));
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.globalAlpha = 1;
        }
      }

      // Rotational symmetry mode overlay
      if (mode === 'rotational' && rotAnimStep >= 0) {
        const step = rotAnimStep;
        const rotAngle = (360 / sides) * step;
        // Draw a ghost shape at the rotation angle
        const ghostVerts = getPolygonVertices(cx, cy, r, sides, rotation + rotAngle);
        ctx.strokeStyle = BRAND_PURPLE;
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.4;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(ghostVerts[0].x, ghostVerts[0].y);
        for (let i = 1; i < ghostVerts.length; i++) {
          ctx.lineTo(ghostVerts[i].x, ghostVerts[i].y);
        }
        ctx.closePath();
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;

        // Rotation arc
        ctx.strokeStyle = BRAND_PURPLE;
        ctx.lineWidth = 2;
        const arcR = r * 0.35;
        const startA = degToRad(-90 + rotation);
        const endA = degToRad(-90 + rotation + rotAngle);
        ctx.beginPath();
        ctx.arc(cx, cy, arcR, startA, endA);
        ctx.stroke();

        // Arc label
        const midA = (startA + endA) / 2;
        const labelR = arcR + 16;
        ctx.fillStyle = BRAND_PURPLE;
        ctx.font = 'bold 13px "Plus Jakarta Sans", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${Math.round(rotAngle)}°`, cx + labelR * Math.cos(midA), cy + labelR * Math.sin(midA));
      }

      // Drag handle on first vertex
      const handleAngle = degToRad(-90 + rotation);
      const hx = cx + (r + 18) * Math.cos(handleAngle);
      const hy = cy + (r + 18) * Math.sin(handleAngle);
      ctx.fillStyle = isDragging ? HIGHLIGHT_COLOR : BRAND_ORANGE;
      ctx.beginPath();
      ctx.arc(hx, hy, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#FFF';
      ctx.lineWidth = 2;
      ctx.stroke();
      // Arrow icon
      ctx.fillStyle = '#FFF';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('↻', hx, hy);
    }
  }, [shape, rotation, mode, showAllLines, highlightedLines, isDragging, info, rotAnimStep]);

  useEffect(() => {
    draw();
  }, [draw]);

  // Resize
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(container);
    return () => ro.disconnect();
  }, [draw]);

  // Drag handling
  const getAngleFromCenter = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return 0;
    const rect = canvas.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const dx = clientX - rect.left - cx;
    const dy = clientY - rect.top - cy;
    return radToDeg(Math.atan2(dy, dx)) + 90;
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const angle = getAngleFromCenter(e.clientX, e.clientY);
    dragStartAngle.current = angle;
    dragStartRotation.current = rotation;
    setIsDragging(true);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [rotation, getAngleFromCenter]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging) return;
    const angle = getAngleFromCenter(e.clientX, e.clientY);
    const delta = angle - dragStartAngle.current;
    setRotation(normalizeAngle(dragStartRotation.current + delta));
  }, [isDragging, getAngleFromCenter]);

  const handlePointerUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Rotational symmetry animation
  const playRotationalAnimation = useCallback(() => {
    if (shape === 'circle') return;
    const steps = info.sides;
    let step = 0;
    setRotAnimStep(0);
    clearInterval(rotAnimRef.current);
    rotAnimRef.current = window.setInterval(() => {
      step++;
      if (step >= steps) {
        clearInterval(rotAnimRef.current);
        setRotAnimStep(-1);
        return;
      }
      setRotAnimStep(step);
    }, 800);
  }, [shape, info.sides]);

  useEffect(() => {
    return () => clearInterval(rotAnimRef.current);
  }, []);

  const linesLabel = info.linesOfSymmetry === Infinity
    ? 'Infinite (∞)'
    : String(info.linesOfSymmetry);

  const orderLabel = info.rotationalOrder === Infinity
    ? 'Infinite (∞)'
    : String(info.rotationalOrder);

  return (
    <div className="flex flex-col gap-4 w-full max-w-2xl mx-auto">
      {/* Controls */}
      <div className="flex flex-wrap gap-3 items-center">
        <label className="text-sm font-semibold text-stone-700">Shape:</label>
        <select
          value={shape}
          onChange={(e) => { setShape(e.target.value as ShapeType); setRotation(0); setRotAnimStep(-1); }}
          className="rounded-lg border border-stone-300 px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-orange-400 outline-none"
        >
          {Object.entries(SHAPES).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>

        <div className="flex gap-1 ml-auto">
          <button
            onClick={() => setMode('lines')}
            className={`px-3 py-1.5 rounded-l-lg text-sm font-medium border transition-colors ${
              mode === 'lines'
                ? 'bg-orange-500 text-white border-orange-500'
                : 'bg-white text-stone-600 border-stone-300 hover:bg-stone-50'
            }`}
          >
            Lines of Symmetry
          </button>
          <button
            onClick={() => setMode('rotational')}
            className={`px-3 py-1.5 rounded-r-lg text-sm font-medium border transition-colors ${
              mode === 'rotational'
                ? 'bg-purple-600 text-white border-purple-600'
                : 'bg-white text-stone-600 border-stone-300 hover:bg-stone-50'
            }`}
          >
            Rotational
          </button>
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

      {/* Info panel */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-orange-50 rounded-xl p-3 text-center">
          <div className="text-xs text-stone-500 font-medium uppercase tracking-wide">Lines of Symmetry</div>
          <div className="text-2xl font-bold text-orange-600 mt-1">{linesLabel}</div>
        </div>
        <div className="bg-purple-50 rounded-xl p-3 text-center">
          <div className="text-xs text-stone-500 font-medium uppercase tracking-wide">Rotational Order</div>
          <div className="text-2xl font-bold text-purple-600 mt-1">{orderLabel}</div>
        </div>
      </div>

      {/* Mode-specific controls */}
      {mode === 'lines' && shape !== 'circle' && (
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-stone-600">
            <input
              type="checkbox"
              checked={showAllLines}
              onChange={(e) => setShowAllLines(e.target.checked)}
              className="rounded border-stone-300 text-orange-500 focus:ring-orange-400"
            />
            Show all symmetry lines
          </label>
          <span className="text-xs text-stone-400 ml-auto">Drag the handle to rotate the shape</span>
        </div>
      )}

      {mode === 'rotational' && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={playRotationalAnimation}
            disabled={shape === 'circle' || rotAnimStep >= 0}
            className="px-4 py-2 rounded-lg bg-purple-600 text-white text-sm font-medium hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors min-h-[44px]"
          >
            {rotAnimStep >= 0 ? `Step ${rotAnimStep + 1} of ${info.sides}` : 'Play Rotation Steps'}
          </button>
          <p className="text-xs text-stone-500">
            {shape === 'circle'
              ? 'A circle has infinite rotational symmetry — it looks the same at every angle.'
              : `A ${info.label.toLowerCase()} maps onto itself ${info.rotationalOrder} times in a full 360° turn (every ${Math.round(360 / info.rotationalOrder)}°).`}
          </p>
        </div>
      )}

      {/* Learning tip */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-stone-700">
        <span className="font-semibold text-amber-700">Key Insight: </span>
        {shape === 'circle'
          ? 'A circle has infinite lines of symmetry — any line through the centre is a line of symmetry. It also has infinite rotational symmetry.'
          : `A regular polygon with ${info.sides} sides has exactly ${info.linesOfSymmetry} lines of symmetry and rotational symmetry of order ${info.rotationalOrder}. The number of sides equals both!`}
      </div>
    </div>
  );
}
