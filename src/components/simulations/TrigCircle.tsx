'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';

interface Point {
  x: number;
  y: number;
}

interface ToggleState {
  sinLine: boolean;
  cosLine: boolean;
  tanLine: boolean;
  triangle: boolean;
  waveTrace: boolean;
}

const STANDARD_ANGLES = [0, 30, 45, 60, 90, 120, 135, 150, 180, 270, 360];

const QUADRANT_COLORS = [
  'rgba(0, 200, 255, 0.06)',   // Q1
  'rgba(255, 100, 200, 0.06)', // Q2
  'rgba(255, 200, 0, 0.06)',   // Q3
  'rgba(100, 255, 150, 0.06)', // Q4
];

const SIN_COLOR = '#00ccff';
const COS_COLOR = '#ff4466';
const TAN_COLOR = '#44ff88';
const POINT_COLOR = '#ffcc00';
const AXIS_COLOR = 'rgba(255,255,255,0.3)';
const GRID_COLOR = 'rgba(255,255,255,0.07)';
const CIRCLE_COLOR = 'rgba(255,255,255,0.5)';
const TRIANGLE_FILL = 'rgba(255,255,255,0.05)';
const TRIANGLE_STROKE = 'rgba(255,255,255,0.35)';

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

function normalizeAngle(deg: number): number {
  let a = deg % 360;
  if (a < 0) a += 360;
  return a;
}

function formatRadian(deg: number): string {
  const n = normalizeAngle(deg);
  const fractions: Record<number, string> = {
    0: '0',
    30: '\u03C0/6',
    45: '\u03C0/4',
    60: '\u03C0/3',
    90: '\u03C0/2',
    120: '2\u03C0/3',
    135: '3\u03C0/4',
    150: '5\u03C0/6',
    180: '\u03C0',
    210: '7\u03C0/6',
    225: '5\u03C0/4',
    240: '4\u03C0/3',
    270: '3\u03C0/2',
    300: '5\u03C0/3',
    315: '7\u03C0/4',
    330: '11\u03C0/6',
    360: '2\u03C0',
  };
  if (fractions[n] !== undefined) return fractions[n];
  return `${(degToRad(n)).toFixed(2)} rad`;
}

function getQuadrant(deg: number): number {
  const n = normalizeAngle(deg);
  if (n >= 0 && n < 90) return 1;
  if (n >= 90 && n < 180) return 2;
  if (n >= 180 && n < 270) return 3;
  return 4;
}

function getSignInfo(deg: number): { sin: string; cos: string; tan: string } {
  const n = normalizeAngle(deg);
  const s = Math.sin(degToRad(n));
  const c = Math.cos(degToRad(n));
  const t = c !== 0 ? s / c : Infinity;
  return {
    sin: s >= 0 ? '+' : '\u2212',
    cos: c >= 0 ? '+' : '\u2212',
    tan: Number.isFinite(t) ? (t >= 0 ? '+' : '\u2212') : 'undef',
  };
}

const TrigCircle: React.FC = () => {
  const circleCanvasRef = useRef<HTMLCanvasElement>(null);
  const graphCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animFrameRef = useRef<number>(0);

  const [angleDeg, setAngleDeg] = useState(45);
  const [isDragging, setIsDragging] = useState(false);
  const [toggles, setToggles] = useState<ToggleState>({
    sinLine: true,
    cosLine: true,
    tanLine: true,
    triangle: true,
    waveTrace: true,
  });
  const [waveHistory, setWaveHistory] = useState<{ angle: number; sin: number; cos: number }[]>([]);
  const [canvasWidth, setCanvasWidth] = useState(600);

  // Track wave history
  useEffect(() => {
    setWaveHistory((prev) => {
      const entry = {
        angle: angleDeg,
        sin: Math.sin(degToRad(angleDeg)),
        cos: Math.cos(degToRad(angleDeg)),
      };
      const filtered = prev.filter((p) => Math.abs(p.angle - angleDeg) > 0.5);
      const next = [...filtered, entry].sort((a, b) => a.angle - b.angle);
      // Keep only angles 0-720 for two full cycles
      return next.filter((p) => p.angle >= 0 && p.angle <= 720);
    });
  }, [angleDeg]);

  const getCanvasPoint = useCallback(
    (e: MouseEvent | TouchEvent, canvas: HTMLCanvasElement): Point => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      let clientX: number, clientY: number;
      if ('touches' in e) {
        const touch = e.touches[0] || e.changedTouches[0];
        clientX = touch.clientX;
        clientY = touch.clientY;
      } else {
        clientX = e.clientX;
        clientY = e.clientY;
      }
      return {
        x: (clientX - rect.left) * scaleX,
        y: (clientY - rect.top) * scaleY,
      };
    },
    []
  );

  const angleFromCanvasPoint = useCallback(
    (point: Point, cx: number, cy: number): number => {
      const dx = point.x - cx;
      const dy = -(point.y - cy); // flip y for math coords
      let angle = Math.atan2(dy, dx);
      if (angle < 0) angle += 2 * Math.PI;
      return radToDeg(angle);
    },
    []
  );

  // Draw the unit circle canvas
  const drawCircle = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      const w = ctx.canvas.width;
      const h = ctx.canvas.height;
      const cx = w / 2;
      const cy = h / 2;
      const radius = Math.min(w, h) * 0.36;

      // Clear and background
      ctx.clearRect(0, 0, w, h);
      const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
      bgGrad.addColorStop(0, '#0a0e27');
      bgGrad.addColorStop(0.5, '#111833');
      bgGrad.addColorStop(1, '#0a0e27');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, w, h);

      // Quadrant fills
      const drawQuadrant = (startAngle: number, endAngle: number, color: string) => {
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, radius, -degToRad(endAngle), -degToRad(startAngle));
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
      };
      drawQuadrant(0, 90, QUADRANT_COLORS[0]);
      drawQuadrant(90, 180, QUADRANT_COLORS[1]);
      drawQuadrant(180, 270, QUADRANT_COLORS[2]);
      drawQuadrant(270, 360, QUADRANT_COLORS[3]);

      // Grid lines
      ctx.strokeStyle = GRID_COLOR;
      ctx.lineWidth = 1;
      const gridStep = radius / 4;
      for (let i = -4; i <= 4; i++) {
        ctx.beginPath();
        ctx.moveTo(cx + i * gridStep, cy - radius - 20);
        ctx.lineTo(cx + i * gridStep, cy + radius + 20);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx - radius - 20, cy + i * gridStep);
        ctx.lineTo(cx + radius + 20, cy + i * gridStep);
        ctx.stroke();
      }

      // Axes
      ctx.strokeStyle = AXIS_COLOR;
      ctx.lineWidth = 1.5;
      // X axis
      ctx.beginPath();
      ctx.moveTo(cx - radius - 30, cy);
      ctx.lineTo(cx + radius + 30, cy);
      ctx.stroke();
      // Y axis
      ctx.beginPath();
      ctx.moveTo(cx, cy - radius - 30);
      ctx.lineTo(cx, cy + radius + 30);
      ctx.stroke();

      // Axis labels
      ctx.font = '13px "Segoe UI", Arial, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('1', cx + radius + 16, cy + 14);
      ctx.fillText('-1', cx - radius - 16, cy + 14);
      ctx.fillText('1', cx - 12, cy - radius - 14);
      ctx.fillText('-1', cx - 14, cy + radius + 16);
      ctx.fillText('0', cx - 12, cy + 14);

      // Quadrant labels
      ctx.font = 'bold 14px "Segoe UI", Arial, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.fillText('Q I', cx + radius * 0.5, cy - radius * 0.5);
      ctx.fillText('Q II', cx - radius * 0.5, cy - radius * 0.5);
      ctx.fillText('Q III', cx - radius * 0.5, cy + radius * 0.5);
      ctx.fillText('Q IV', cx + radius * 0.5, cy + radius * 0.5);

      // Unit circle
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.strokeStyle = CIRCLE_COLOR;
      ctx.lineWidth = 2;
      ctx.stroke();

      // Standard angle tick marks
      for (const deg of [0, 30, 45, 60, 90, 120, 135, 150, 180, 210, 225, 240, 270, 300, 315, 330]) {
        const rad = degToRad(deg);
        const innerR = radius - 6;
        const outerR = radius + 6;
        ctx.beginPath();
        ctx.moveTo(cx + innerR * Math.cos(-rad), cy + innerR * Math.sin(-rad));
        ctx.lineTo(cx + outerR * Math.cos(-rad), cy + outerR * Math.sin(-rad));
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      const rad = degToRad(angleDeg);
      const px = cx + radius * Math.cos(-rad);
      const py = cy + radius * Math.sin(-rad);
      const sinVal = Math.sin(rad);
      const cosVal = Math.cos(rad);
      const tanVal = Math.cos(rad) !== 0 ? Math.tan(rad) : Infinity;

      // Angle arc
      ctx.beginPath();
      ctx.arc(cx, cy, 30, 0, -rad, rad > 0);
      ctx.strokeStyle = POINT_COLOR;
      ctx.lineWidth = 2;
      ctx.stroke();

      // Angle label
      const labelAngleRad = -rad / 2;
      ctx.font = 'bold 13px "Segoe UI", Arial, sans-serif';
      ctx.fillStyle = POINT_COLOR;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(
        `${normalizeAngle(angleDeg).toFixed(1)}\u00B0`,
        cx + 46 * Math.cos(labelAngleRad),
        cy + 46 * Math.sin(labelAngleRad)
      );

      // Radius line (hypotenuse)
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(px, py);
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Triangle (right triangle formed by point, projection on x-axis, and origin)
      if (toggles.triangle) {
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(px, cy); // cos projection on x-axis
        ctx.lineTo(px, py); // up to point
        ctx.closePath();
        ctx.fillStyle = TRIANGLE_FILL;
        ctx.fill();
        ctx.strokeStyle = TRIANGLE_STROKE;
        ctx.lineWidth = 1;
        ctx.stroke();

        // Right angle symbol
        const symSize = 10;
        const dirX = px > cx ? 1 : -1;
        const dirY = py < cy ? -1 : 1;
        // Only draw if not on axis
        if (Math.abs(sinVal) > 0.05 && Math.abs(cosVal) > 0.05) {
          ctx.beginPath();
          ctx.moveTo(px - dirX * symSize, cy);
          ctx.lineTo(px - dirX * symSize, cy + dirY * symSize);
          ctx.lineTo(px, cy + dirY * symSize);
          ctx.strokeStyle = 'rgba(255,255,255,0.4)';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }

      // Sin line (vertical: from point to x-axis)
      if (toggles.sinLine) {
        ctx.beginPath();
        ctx.moveTo(px, cy);
        ctx.lineTo(px, py);
        ctx.strokeStyle = SIN_COLOR;
        ctx.lineWidth = 3;
        ctx.shadowColor = SIN_COLOR;
        ctx.shadowBlur = 10;
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Label
        ctx.font = 'bold 12px "Segoe UI", Arial, sans-serif';
        ctx.fillStyle = SIN_COLOR;
        ctx.textAlign = 'left';
        ctx.fillText(`sin = ${sinVal.toFixed(3)}`, px + 8, (cy + py) / 2);
      }

      // Cos line (horizontal: from point to y-axis)
      if (toggles.cosLine) {
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(px, cy);
        ctx.strokeStyle = COS_COLOR;
        ctx.lineWidth = 3;
        ctx.shadowColor = COS_COLOR;
        ctx.shadowBlur = 10;
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Label
        ctx.font = 'bold 12px "Segoe UI", Arial, sans-serif';
        ctx.fillStyle = COS_COLOR;
        ctx.textAlign = 'center';
        ctx.fillText(`cos = ${cosVal.toFixed(3)}`, (cx + px) / 2, cy + 18);
      }

      // Tan line (tangent at x=1 on circle)
      if (toggles.tanLine && Number.isFinite(tanVal) && Math.abs(tanVal) < 6) {
        // Tangent line goes from the point on the circle to the tangent on x=radius line
        const tanEndX = cx + radius;
        const tanEndY = cy - radius * tanVal;

        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(tanEndX, tanEndY);
        ctx.strokeStyle = TAN_COLOR;
        ctx.lineWidth = 2.5;
        ctx.shadowColor = TAN_COLOR;
        ctx.shadowBlur = 8;
        ctx.setLineDash([6, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.shadowBlur = 0;

        // Tan endpoint dot
        ctx.beginPath();
        ctx.arc(tanEndX, tanEndY, 4, 0, Math.PI * 2);
        ctx.fillStyle = TAN_COLOR;
        ctx.fill();

        // Tan label
        ctx.font = 'bold 12px "Segoe UI", Arial, sans-serif';
        ctx.fillStyle = TAN_COLOR;
        ctx.textAlign = 'left';
        ctx.fillText(`tan = ${tanVal.toFixed(3)}`, tanEndX + 6, tanEndY);
      } else if (toggles.tanLine && !Number.isFinite(tanVal)) {
        ctx.font = 'bold 12px "Segoe UI", Arial, sans-serif';
        ctx.fillStyle = TAN_COLOR;
        ctx.textAlign = 'left';
        ctx.fillText('tan = undefined', cx + radius + 8, cy - radius * 0.3);
      }

      // Draggable point with glow
      ctx.beginPath();
      ctx.arc(px, py, 12, 0, Math.PI * 2);
      const pointGrad = ctx.createRadialGradient(px, py, 0, px, py, 12);
      pointGrad.addColorStop(0, '#ffffff');
      pointGrad.addColorStop(0.4, POINT_COLOR);
      pointGrad.addColorStop(1, 'rgba(255,204,0,0.3)');
      ctx.fillStyle = pointGrad;
      ctx.shadowColor = POINT_COLOR;
      ctx.shadowBlur = 20;
      ctx.fill();
      ctx.shadowBlur = 0;

      // Outer glow ring
      ctx.beginPath();
      ctx.arc(px, py, 16, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,204,0,0.3)';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Coordinate label near point
      ctx.font = '11px "Segoe UI", Arial, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.textAlign = 'center';
      ctx.fillText(
        `(${cosVal.toFixed(2)}, ${sinVal.toFixed(2)})`,
        px,
        py - 24
      );

      // Title
      ctx.font = 'bold 18px "Segoe UI", Arial, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.textAlign = 'center';
      ctx.fillText('Unit Circle', w / 2, 24);
    },
    [angleDeg, toggles]
  );

  // Draw the wave graph canvas
  const drawGraph = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      const w = ctx.canvas.width;
      const h = ctx.canvas.height;
      const padding = { top: 30, bottom: 20, left: 50, right: 20 };
      const graphW = w - padding.left - padding.right;
      const graphH = h - padding.top - padding.bottom;
      const midY = padding.top + graphH / 2;

      // Clear and background
      ctx.clearRect(0, 0, w, h);
      const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
      bgGrad.addColorStop(0, '#0d1129');
      bgGrad.addColorStop(1, '#0a0e27');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, w, h);

      // Grid
      ctx.strokeStyle = GRID_COLOR;
      ctx.lineWidth = 0.5;

      // Horizontal grid (amplitude)
      for (let i = -4; i <= 4; i++) {
        const y = midY - (i / 4) * (graphH / 2);
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(w - padding.right, y);
        ctx.stroke();
      }

      // Vertical grid (angle markers)
      const angleMarkers = [0, 90, 180, 270, 360];
      for (const a of angleMarkers) {
        const x = padding.left + (a / 360) * graphW;
        ctx.beginPath();
        ctx.moveTo(x, padding.top);
        ctx.lineTo(x, h - padding.bottom);
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.stroke();

        // Labels
        ctx.font = '11px "Segoe UI", Arial, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.textAlign = 'center';
        ctx.fillText(`${a}\u00B0`, x, h - padding.bottom + 14);
      }

      // Y-axis labels
      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.font = '11px "Segoe UI", Arial, sans-serif';
      ctx.fillText('1', padding.left - 8, padding.top + 4);
      ctx.fillText('0', padding.left - 8, midY + 4);
      ctx.fillText('-1', padding.left - 8, h - padding.bottom + 4);

      // X-axis
      ctx.beginPath();
      ctx.moveTo(padding.left, midY);
      ctx.lineTo(w - padding.right, midY);
      ctx.strokeStyle = AXIS_COLOR;
      ctx.lineWidth = 1;
      ctx.stroke();

      // Draw continuous sin curve
      if (toggles.waveTrace) {
        // Sin curve
        ctx.beginPath();
        for (let deg = 0; deg <= 360; deg += 1) {
          const x = padding.left + (deg / 360) * graphW;
          const y = midY - Math.sin(degToRad(deg)) * (graphH / 2);
          if (deg === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = SIN_COLOR;
        ctx.lineWidth = 2;
        ctx.shadowColor = SIN_COLOR;
        ctx.shadowBlur = 6;
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Cos curve
        ctx.beginPath();
        for (let deg = 0; deg <= 360; deg += 1) {
          const x = padding.left + (deg / 360) * graphW;
          const y = midY - Math.cos(degToRad(deg)) * (graphH / 2);
          if (deg === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = COS_COLOR;
        ctx.lineWidth = 2;
        ctx.shadowColor = COS_COLOR;
        ctx.shadowBlur = 6;
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      // Current angle marker (vertical line)
      const normAngle = normalizeAngle(angleDeg);
      const markerX = padding.left + (normAngle / 360) * graphW;

      ctx.beginPath();
      ctx.moveTo(markerX, padding.top);
      ctx.lineTo(markerX, h - padding.bottom);
      ctx.strokeStyle = 'rgba(255,204,0,0.4)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Sin dot on curve
      if (toggles.waveTrace) {
        const sinY = midY - Math.sin(degToRad(normAngle)) * (graphH / 2);
        ctx.beginPath();
        ctx.arc(markerX, sinY, 6, 0, Math.PI * 2);
        ctx.fillStyle = SIN_COLOR;
        ctx.shadowColor = SIN_COLOR;
        ctx.shadowBlur = 12;
        ctx.fill();
        ctx.shadowBlur = 0;

        // Cos dot on curve
        const cosY = midY - Math.cos(degToRad(normAngle)) * (graphH / 2);
        ctx.beginPath();
        ctx.arc(markerX, cosY, 6, 0, Math.PI * 2);
        ctx.fillStyle = COS_COLOR;
        ctx.shadowColor = COS_COLOR;
        ctx.shadowBlur = 12;
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      // Legend
      ctx.font = 'bold 12px "Segoe UI", Arial, sans-serif';
      // sin legend
      ctx.fillStyle = SIN_COLOR;
      ctx.textAlign = 'left';
      ctx.fillText('\u2500\u2500 sin(\u03B8)', padding.left + 10, padding.top - 10);
      // cos legend
      ctx.fillStyle = COS_COLOR;
      ctx.fillText('\u2500\u2500 cos(\u03B8)', padding.left + 100, padding.top - 10);

      // Title
      ctx.font = 'bold 14px "Segoe UI", Arial, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.textAlign = 'center';
      ctx.fillText('Waveform Trace', w / 2, padding.top - 10);
    },
    [angleDeg, toggles.waveTrace]
  );

  // Resize handler
  useEffect(() => {
    const handleResize = () => {
      const container = containerRef.current;
      const circleCanvas = circleCanvasRef.current;
      const graphCanvas = graphCanvasRef.current;
      if (!container || !circleCanvas || !graphCanvas) return;
      const w = Math.min(container.clientWidth, 900);
      setCanvasWidth(w);
      const dpr = window.devicePixelRatio || 1;
      circleCanvas.width = w * dpr;
      circleCanvas.height = 450 * dpr;
      circleCanvas.style.width = `${w}px`;
      circleCanvas.style.height = '450px';
      const cCtx = circleCanvas.getContext('2d');
      if (cCtx) cCtx.scale(dpr, dpr);

      graphCanvas.width = w * dpr;
      graphCanvas.height = 180 * dpr;
      graphCanvas.style.width = `${w}px`;
      graphCanvas.style.height = '180px';
      const gCtx = graphCanvas.getContext('2d');
      if (gCtx) gCtx.scale(dpr, dpr);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Main render loop
  useEffect(() => {
    const circleCanvas = circleCanvasRef.current;
    const graphCanvas = graphCanvasRef.current;
    if (!circleCanvas || !graphCanvas) return;
    const cCtx = circleCanvas.getContext('2d');
    const gCtx = graphCanvas.getContext('2d');
    if (!cCtx || !gCtx) return;

    const render = () => {
      cCtx.save();
      // Canvas is already scaled by dpr in resize handler
      // We need to work in CSS pixel space
      const dpr = window.devicePixelRatio || 1;
      cCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawCircle(cCtx);
      cCtx.restore();

      gCtx.save();
      gCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawGraph(gCtx);
      gCtx.restore();

      animFrameRef.current = requestAnimationFrame(render);
    };
    animFrameRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [drawCircle, drawGraph]);

  // Pointer handlers for circle canvas
  const handlePointerDown = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      e.preventDefault();
      const canvas = circleCanvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      const cx = w / 2;
      const cy = h / 2;
      const radius = Math.min(w, h) * 0.36;

      let clientX: number, clientY: number;
      if ('touches' in e) {
        const touch = e.touches[0];
        clientX = touch.clientX;
        clientY = touch.clientY;
      } else {
        clientX = e.clientX;
        clientY = e.clientY;
      }
      const px = clientX - rect.left;
      const py = clientY - rect.top;

      // Check if near the point on circle
      const rad = degToRad(angleDeg);
      const pointX = cx + radius * Math.cos(-rad);
      const pointY = cy + radius * Math.sin(-rad);
      const distToPoint = Math.sqrt((px - pointX) ** 2 + (py - pointY) ** 2);

      if (distToPoint < 30) {
        setIsDragging(true);
      } else {
        // Also allow clicking anywhere near circle to set angle
        const distToCenter = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
        if (Math.abs(distToCenter - radius) < 40) {
          setIsDragging(true);
          const dx = px - cx;
          const dy = -(py - cy);
          let angle = Math.atan2(dy, dx);
          if (angle < 0) angle += 2 * Math.PI;
          setAngleDeg(radToDeg(angle));
        }
      }
    },
    [angleDeg]
  );

  const handlePointerMove = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      if (!isDragging) return;
      e.preventDefault();
      const canvas = circleCanvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const cx = rect.width / 2;
      const cy = rect.height / 2;

      let clientX: number, clientY: number;
      if ('touches' in e) {
        const touch = e.touches[0];
        clientX = touch.clientX;
        clientY = touch.clientY;
      } else {
        clientX = e.clientX;
        clientY = e.clientY;
      }
      const px = clientX - rect.left;
      const py = clientY - rect.top;

      const dx = px - cx;
      const dy = -(py - cy);
      let angle = Math.atan2(dy, dx);
      if (angle < 0) angle += 2 * Math.PI;
      setAngleDeg(radToDeg(angle));
    },
    [isDragging]
  );

  const handlePointerUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleToggle = useCallback((key: keyof ToggleState) => {
    setToggles((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const handleAngleSelect = useCallback((deg: number) => {
    setAngleDeg(deg);
  }, []);

  const sinVal = Math.sin(degToRad(angleDeg));
  const cosVal = Math.cos(degToRad(angleDeg));
  const tanVal = Math.cos(degToRad(angleDeg)) !== 0 ? Math.tan(degToRad(angleDeg)) : Infinity;
  const quadrant = getQuadrant(angleDeg);
  const signs = getSignInfo(angleDeg);

  const buttonStyle = (active: boolean, color: string): React.CSSProperties => ({
    padding: '5px 12px',
    borderRadius: 16,
    border: `2px solid ${color}`,
    background: active ? color : 'rgba(255,255,255,0.05)',
    color: active ? '#000' : color,
    fontWeight: 700,
    fontSize: 12,
    cursor: 'pointer',
    transition: 'all 0.2s',
    whiteSpace: 'nowrap',
  });

  const angleButtonStyle = (deg: number): React.CSSProperties => ({
    padding: '4px 10px',
    borderRadius: 14,
    border: `1.5px solid ${Math.abs(normalizeAngle(angleDeg) - deg) < 1 ? POINT_COLOR : 'rgba(255,255,255,0.2)'}`,
    background: Math.abs(normalizeAngle(angleDeg) - deg) < 1 ? POINT_COLOR : 'rgba(255,255,255,0.05)',
    color: Math.abs(normalizeAngle(angleDeg) - deg) < 1 ? '#000' : 'rgba(255,255,255,0.7)',
    fontWeight: 600,
    fontSize: 12,
    cursor: 'pointer',
    transition: 'all 0.2s',
  });

  const infoCardStyle: React.CSSProperties = {
    background: 'rgba(255,255,255,0.04)',
    borderRadius: 12,
    padding: '10px 14px',
    border: '1px solid rgba(255,255,255,0.08)',
  };

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        maxWidth: 900,
        margin: '0 auto',
        fontFamily: '"Segoe UI", Arial, sans-serif',
        color: '#fff',
      }}
    >
      {/* Standard angle buttons */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 6,
          marginBottom: 10,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.5)', marginRight: 4 }}>
          Standard Angles:
        </span>
        {STANDARD_ANGLES.map((deg) => (
          <button key={deg} onClick={() => handleAngleSelect(deg)} style={angleButtonStyle(deg)}>
            {deg}\u00B0
          </button>
        ))}
      </div>

      {/* Toggle buttons */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 6,
          marginBottom: 10,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.5)', marginRight: 4 }}>
          Show/Hide:
        </span>
        <button onClick={() => handleToggle('sinLine')} style={buttonStyle(toggles.sinLine, SIN_COLOR)}>
          sin line
        </button>
        <button onClick={() => handleToggle('cosLine')} style={buttonStyle(toggles.cosLine, COS_COLOR)}>
          cos line
        </button>
        <button onClick={() => handleToggle('tanLine')} style={buttonStyle(toggles.tanLine, TAN_COLOR)}>
          tan line
        </button>
        <button onClick={() => handleToggle('triangle')} style={buttonStyle(toggles.triangle, 'rgba(255,255,255,0.5)')}>
          triangle
        </button>
        <button onClick={() => handleToggle('waveTrace')} style={buttonStyle(toggles.waveTrace, POINT_COLOR)}>
          wave trace
        </button>
      </div>

      {/* Circle canvas */}
      <canvas
        ref={circleCanvasRef}
        style={{
          width: '100%',
          height: 450,
          borderRadius: 16,
          border: '1px solid rgba(255,255,255,0.1)',
          cursor: isDragging ? 'grabbing' : 'grab',
          touchAction: 'none',
          boxShadow: '0 4px 30px rgba(0,0,0,0.4)',
          display: 'block',
        }}
        onMouseDown={handlePointerDown}
        onMouseMove={handlePointerMove}
        onMouseUp={handlePointerUp}
        onMouseLeave={handlePointerUp}
        onTouchStart={handlePointerDown}
        onTouchMove={handlePointerMove}
        onTouchEnd={handlePointerUp}
      />

      {/* Info panel */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 10,
          marginTop: 12,
          marginBottom: 12,
        }}
      >
        {/* Angle info */}
        <div style={infoCardStyle}>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 4 }}>Angle (\u03B8)</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: POINT_COLOR }}>
            {normalizeAngle(angleDeg).toFixed(1)}\u00B0
          </div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', marginTop: 2 }}>
            {formatRadian(angleDeg)} rad
          </div>
        </div>

        {/* Trig values */}
        <div style={infoCardStyle}>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 4 }}>Trig Values</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: SIN_COLOR }}>
            sin(\u03B8) = {sinVal.toFixed(4)}
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, color: COS_COLOR, marginTop: 2 }}>
            cos(\u03B8) = {cosVal.toFixed(4)}
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, color: TAN_COLOR, marginTop: 2 }}>
            tan(\u03B8) = {Number.isFinite(tanVal) ? tanVal.toFixed(4) : 'undefined'}
          </div>
        </div>

        {/* Quadrant info */}
        <div style={infoCardStyle}>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 4 }}>Quadrant</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'rgba(255,255,255,0.8)' }}>
            Q {quadrant === 1 ? 'I' : quadrant === 2 ? 'II' : quadrant === 3 ? 'III' : 'IV'}
          </div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 4 }}>
            <span style={{ color: SIN_COLOR }}>sin {signs.sin}</span>{' '}
            <span style={{ color: COS_COLOR }}>cos {signs.cos}</span>{' '}
            <span style={{ color: TAN_COLOR }}>tan {signs.tan}</span>
          </div>
        </div>

        {/* Identity */}
        <div style={infoCardStyle}>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 4 }}>Identity Check</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.7)' }}>
            sin\u00B2 + cos\u00B2 = {(sinVal * sinVal + cosVal * cosVal).toFixed(4)}
          </div>
          <div
            style={{
              fontSize: 13,
              color: '#44ff88',
              marginTop: 4,
              fontWeight: 700,
            }}
          >
            \u2713 Always equals 1
          </div>
        </div>
      </div>

      {/* Graph canvas */}
      <canvas
        ref={graphCanvasRef}
        style={{
          width: '100%',
          height: 180,
          borderRadius: 12,
          border: '1px solid rgba(255,255,255,0.1)',
          boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
          display: 'block',
        }}
      />

      <p
        style={{
          textAlign: 'center',
          fontSize: 12,
          color: 'rgba(255,255,255,0.35)',
          marginTop: 8,
          fontStyle: 'italic',
        }}
      >
        Drag the glowing point around the unit circle to explore trigonometric functions interactively.
      </p>
    </div>
  );
};

export default TrigCircle;
