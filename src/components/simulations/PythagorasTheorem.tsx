'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';

interface Point {
  x: number;
  y: number;
}

interface TriangleState {
  A: Point; // right-angle vertex
  B: Point; // end of horizontal side
  C: Point; // end of vertical side
}

interface AnimationParticle {
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  color: string;
}

const GRID_SIZE = 30;
const VERTEX_RADIUS = 14;
const TOUCH_RADIUS = 24;
const MIN_SIDE = 2 * GRID_SIZE;

const PRESETS: Record<string, TriangleState> = {
  '3-4-5': {
    A: { x: 150, y: 330 },
    B: { x: 150 + 4 * GRID_SIZE, y: 330 },
    C: { x: 150, y: 330 - 3 * GRID_SIZE },
  },
  '5-12-13': {
    A: { x: 120, y: 360 },
    B: { x: 120 + 12 * GRID_SIZE, y: 360 },
    C: { x: 120, y: 360 - 5 * GRID_SIZE },
  },
  '8-15-17': {
    A: { x: 90, y: 370 },
    B: { x: 90 + 15 * GRID_SIZE, y: 370 },
    C: { x: 90, y: 370 - 8 * GRID_SIZE },
  },
};

function snapToGrid(val: number): number {
  return Math.round(val / GRID_SIZE) * GRID_SIZE;
}

function dist(p1: Point, p2: Point): number {
  return Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2);
}

function sideLength(p1: Point, p2: Point): number {
  return Math.round(dist(p1, p2) / GRID_SIZE);
}

function midpoint(p1: Point, p2: Point): Point {
  return { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

const PythagorasTheorem: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [triangle, setTriangle] = useState<TriangleState>(PRESETS['3-4-5']);
  const [dragging, setDragging] = useState<'A' | 'B' | 'C' | null>(null);
  const [proofMode, setProofMode] = useState(false);
  const [proofProgress, setProofProgress] = useState(0);
  const animFrameRef = useRef<number>(0);
  const proofAnimRef = useRef<number>(0);
  const canvasWidth = useRef(600);

  const getCanvasPoint = useCallback(
    (e: React.MouseEvent | React.TouchEvent | MouseEvent | TouchEvent): Point => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      let clientX: number, clientY: number;
      if ('touches' in e) {
        const touch = e.touches[0] || (e as TouchEvent).changedTouches[0];
        clientX = touch.clientX;
        clientY = touch.clientY;
      } else {
        clientX = (e as MouseEvent).clientX;
        clientY = (e as MouseEvent).clientY;
      }
      return {
        x: (clientX - rect.left) * scaleX,
        y: (clientY - rect.top) * scaleY,
      };
    },
    []
  );

  const hitTest = useCallback(
    (point: Point, tri: TriangleState): 'A' | 'B' | 'C' | null => {
      const keys: Array<'A' | 'B' | 'C'> = ['A', 'B', 'C'];
      for (const key of keys) {
        if (dist(point, tri[key]) < TOUCH_RADIUS) return key;
      }
      return null;
    },
    []
  );

  // Drawing
  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, tri: TriangleState, proof: number) => {
      const w = ctx.canvas.width;
      const h = ctx.canvas.height;

      // Clear
      ctx.clearRect(0, 0, w, h);

      // Background
      const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
      bgGrad.addColorStop(0, '#fef9ef');
      bgGrad.addColorStop(1, '#fdf2e0');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, w, h);

      // Grid
      ctx.strokeStyle = 'rgba(200,185,160,0.3)';
      ctx.lineWidth = 0.5;
      for (let x = 0; x <= w; x += GRID_SIZE) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let y = 0; y <= h; y += GRID_SIZE) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      const { A, B, C } = tri;
      const a = sideLength(A, C); // vertical side (a)
      const b = sideLength(A, B); // horizontal side (b)
      const cLen = sideLength(B, C); // hypotenuse (c)
      const aPx = dist(A, C);
      const bPx = dist(A, B);
      const cPx = dist(B, C);

      const aSq = a * a;
      const bSq = b * b;
      const cSq = cLen * cLen;
      const isRight = aSq + bSq === cSq;

      // --- Draw squares on each side ---

      // Helper: draw a filled square with shadow on a given side
      const drawSquare = (
        p1: Point,
        p2: Point,
        fillColor: string,
        shadowColor: string,
        outward: 'left' | 'right'
      ) => {
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        // Perpendicular direction
        let nx: number, ny: number;
        if (outward === 'left') {
          nx = -dy;
          ny = dx;
        } else {
          nx = dy;
          ny = -dx;
        }
        const corners = [
          { x: p1.x, y: p1.y },
          { x: p2.x, y: p2.y },
          { x: p2.x + nx, y: p2.y + ny },
          { x: p1.x + nx, y: p1.y + ny },
        ];

        ctx.save();
        ctx.shadowColor = shadowColor;
        ctx.shadowBlur = 12;
        ctx.shadowOffsetX = 3;
        ctx.shadowOffsetY = 3;
        ctx.beginPath();
        ctx.moveTo(corners[0].x, corners[0].y);
        for (let i = 1; i < corners.length; i++) {
          ctx.lineTo(corners[i].x, corners[i].y);
        }
        ctx.closePath();
        ctx.fillStyle = fillColor;
        ctx.fill();
        ctx.restore();

        ctx.strokeStyle = 'rgba(0,0,0,0.25)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(corners[0].x, corners[0].y);
        for (let i = 1; i < corners.length; i++) {
          ctx.lineTo(corners[i].x, corners[i].y);
        }
        ctx.closePath();
        ctx.stroke();

        // Draw grid lines inside the square to show unit squares
        const sideLen = Math.round(
          Math.sqrt(dx * dx + dy * dy) / GRID_SIZE
        );
        if (sideLen <= 20) {
          ctx.strokeStyle = 'rgba(0,0,0,0.08)';
          ctx.lineWidth = 0.5;
          const ux = dx / sideLen;
          const uy = dy / sideLen;
          const unx = nx / sideLen;
          const uny = ny / sideLen;
          // Lines parallel to side
          for (let i = 1; i < sideLen; i++) {
            ctx.beginPath();
            ctx.moveTo(p1.x + unx * i, p1.y + uny * i);
            ctx.lineTo(p2.x + unx * i, p2.y + uny * i);
            ctx.stroke();
          }
          // Lines perpendicular to side
          for (let i = 1; i < sideLen; i++) {
            ctx.beginPath();
            ctx.moveTo(p1.x + ux * i, p1.y + uy * i);
            ctx.lineTo(p1.x + ux * i + nx, p1.y + uy * i + ny);
            ctx.stroke();
          }
        }

        return corners;
      };

      // Square on side a (A to C) - vertical side - draw to the LEFT of the triangle
      drawSquare(A, C, 'rgba(231,76,60,0.35)', 'rgba(180,50,30,0.3)', 'left');

      // Square on side b (A to B) - horizontal side - draw BELOW the triangle
      drawSquare(A, B, 'rgba(52,152,219,0.35)', 'rgba(30,90,160,0.3)', 'right');

      // Square on hypotenuse c (B to C) - draw to the RIGHT of the triangle
      drawSquare(B, C, 'rgba(155,89,182,0.35)', 'rgba(100,50,130,0.3)', 'left');

      // --- Proof animation overlay ---
      if (proof > 0) {
        drawProofAnimation(ctx, tri, proof);
      }

      // --- Draw triangle ---
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.15)';
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.moveTo(A.x, A.y);
      ctx.lineTo(B.x, B.y);
      ctx.lineTo(C.x, C.y);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255,248,230,0.7)';
      ctx.fill();
      ctx.restore();

      ctx.strokeStyle = '#5d4037';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(A.x, A.y);
      ctx.lineTo(B.x, B.y);
      ctx.lineTo(C.x, C.y);
      ctx.closePath();
      ctx.stroke();

      // --- Right angle symbol at A ---
      const symbolSize = 15;
      const dirAB = { x: (B.x - A.x) / bPx, y: (B.y - A.y) / bPx };
      const dirAC = { x: (C.x - A.x) / aPx, y: (C.y - A.y) / aPx };
      ctx.strokeStyle = '#5d4037';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(
        A.x + dirAB.x * symbolSize,
        A.y + dirAB.y * symbolSize
      );
      ctx.lineTo(
        A.x + dirAB.x * symbolSize + dirAC.x * symbolSize,
        A.y + dirAB.y * symbolSize + dirAC.y * symbolSize
      );
      ctx.lineTo(
        A.x + dirAC.x * symbolSize,
        A.y + dirAC.y * symbolSize
      );
      ctx.stroke();

      // --- Side labels ---
      const drawLabel = (
        p1: Point,
        p2: Point,
        label: string,
        offsetDir: { x: number; y: number }
      ) => {
        const mid = midpoint(p1, p2);
        ctx.font = 'bold 16px "Segoe UI", Arial, sans-serif';
        ctx.fillStyle = '#3e2723';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, mid.x + offsetDir.x * 18, mid.y + offsetDir.y * 18);
      };

      drawLabel(A, B, `b = ${b}`, { x: 0, y: 1 });
      drawLabel(A, C, `a = ${a}`, { x: -1, y: 0 });

      // Label for hypotenuse - offset away from triangle
      const hypMid = midpoint(B, C);
      const hypDx = C.x - B.x;
      const hypDy = C.y - B.y;
      const hypLen = Math.sqrt(hypDx * hypDx + hypDy * hypDy);
      const hypNx = -hypDy / hypLen;
      const hypNy = hypDx / hypLen;
      // Choose direction away from A
      const toA = { x: A.x - hypMid.x, y: A.y - hypMid.y };
      const dot = toA.x * hypNx + toA.y * hypNy;
      const sign = dot > 0 ? -1 : 1;
      ctx.font = 'bold 16px "Segoe UI", Arial, sans-serif';
      ctx.fillStyle = '#3e2723';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(
        `c = ${cLen}`,
        hypMid.x + sign * hypNx * 20,
        hypMid.y + sign * hypNy * 20
      );

      // --- Draggable vertices ---
      const drawVertex = (p: Point, label: string) => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, VERTEX_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = '#ff9800';
        ctx.fill();
        ctx.strokeStyle = '#e65100';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Inner dot
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
      };

      drawVertex(A, 'A');
      drawVertex(B, 'B');
      drawVertex(C, 'C');

      // --- Equation display ---
      const eqY = 35;
      ctx.font = 'bold 22px "Segoe UI", Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const equation = `${aSq} + ${bSq} = ${cSq}`;
      const check = isRight ? ' \u2713' : ` \u2260 ${aSq + bSq}`;

      if (isRight) {
        // Green glow
        ctx.shadowColor = 'rgba(39,174,96,0.5)';
        ctx.shadowBlur = 16;
        ctx.fillStyle = '#27ae60';
      } else {
        ctx.shadowColor = 'rgba(192,57,43,0.5)';
        ctx.shadowBlur = 16;
        ctx.fillStyle = '#c0392b';
      }

      // Background pill
      const eqText = isRight
        ? `a\u00B2 + b\u00B2 = c\u00B2  \u2192  ${aSq} + ${bSq} = ${cSq} \u2713`
        : `a\u00B2 + b\u00B2 \u2260 c\u00B2  \u2192  ${aSq} + ${bSq} \u2260 ${cSq}`;
      const metrics = ctx.measureText(eqText);
      const pillW = metrics.width + 40;
      const pillH = 36;
      const pillX = w / 2 - pillW / 2;

      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.12)';
      ctx.shadowBlur = 8;
      ctx.shadowOffsetY = 2;
      ctx.beginPath();
      ctx.roundRect(pillX, eqY - pillH / 2, pillW, pillH, 18);
      ctx.fillStyle = isRight
        ? 'rgba(39,174,96,0.12)'
        : 'rgba(192,57,43,0.12)';
      ctx.fill();
      ctx.strokeStyle = isRight
        ? 'rgba(39,174,96,0.4)'
        : 'rgba(192,57,43,0.4)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle = isRight ? '#1e8449' : '#922b21';
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.fillText(eqText, w / 2, eqY);

      // Area labels on squares
      ctx.font = '14px "Segoe UI", Arial, sans-serif';
      ctx.fillStyle = 'rgba(0,0,0,0.55)';

      // Area on a² square
      const aSquareMid = {
        x: A.x - aPx / 2 * (C.y - A.y) / aPx - (C.x - A.x) / 2,
        y: A.y + aPx / 2 * (C.x - A.x) / aPx - (C.y - A.y) / 2,
      };
      // Simplified: for our right-angle-at-A layout
      const aSqCenter = {
        x: (A.x + C.x) / 2 - aPx / 2,
        y: (A.y + C.y) / 2,
      };
      ctx.textAlign = 'center';
      ctx.fillText(`a\u00B2 = ${aSq}`, aSqCenter.x, aSqCenter.y);

      // Area on b² square
      const bSqCenter = {
        x: (A.x + B.x) / 2,
        y: (A.y + B.y) / 2 + bPx / 2,
      };
      ctx.fillText(`b\u00B2 = ${bSq}`, bSqCenter.x, bSqCenter.y);

      // Area on c² square (on hypotenuse)
      // The square is drawn to the LEFT of B->C
      const cMid = midpoint(B, C);
      const cNx = -(C.y - B.y) / cPx;
      const cNy = (C.x - B.x) / cPx;
      const cSqCenter = {
        x: cMid.x + cNx * cPx / 2,
        y: cMid.y + cNy * cPx / 2,
      };
      ctx.fillText(`c\u00B2 = ${cSq}`, cSqCenter.x, cSqCenter.y);
    },
    []
  );

  const drawProofAnimation = (
    ctx: CanvasRenderingContext2D,
    tri: TriangleState,
    progress: number
  ) => {
    const { A, B, C } = tri;
    const aPx = dist(A, C);
    const bPx = dist(A, B);
    const a = sideLength(A, C);
    const b = sideLength(A, B);

    if (a * a + b * b !== sideLength(B, C) ** 2) return;

    // We animate small unit squares from a² and b² towards c²
    // For simplicity, show a pulsing glow effect that grows with progress

    // Highlight: draw particles flowing from a² and b² squares into c² square
    const t = progress;

    // Source centers (a² square and b² square)
    const aSrc = { x: (A.x + C.x) / 2 - aPx / 2, y: (A.y + C.y) / 2 };
    const bSrc = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 + bPx / 2 };

    // Target center (c² square)
    const cPx = dist(B, C);
    const cMid = midpoint(B, C);
    const cNx = -(C.y - B.y) / cPx;
    const cNy = (C.x - B.x) / cPx;
    const cTarget = {
      x: cMid.x + cNx * cPx / 2,
      y: cMid.y + cNy * cPx / 2,
    };

    // Draw flowing particles
    const numParticlesA = a * a;
    const numParticlesB = b * b;

    const drawParticles = (
      src: Point,
      target: Point,
      count: number,
      color: string,
      seed: number
    ) => {
      for (let i = 0; i < Math.min(count, 50); i++) {
        // Stagger each particle
        const particleT = Math.max(
          0,
          Math.min(1, (t * 1.5 - (i / Math.min(count, 50)) * 0.5))
        );
        if (particleT <= 0) continue;

        // Pseudorandom offset using seed
        const angle = ((i * 137.508 + seed) % 360) * (Math.PI / 180);
        const spread = 20;
        const srcOff = {
          x: src.x + Math.cos(angle) * spread * (1 - particleT),
          y: src.y + Math.sin(angle) * spread * (1 - particleT),
        };

        const px = lerp(srcOff.x, target.x + Math.cos(angle) * 10, particleT);
        const py = lerp(srcOff.y, target.y + Math.sin(angle) * 10, particleT);

        const alpha = particleT < 0.1 ? particleT * 10 : particleT > 0.9 ? (1 - particleT) * 10 : 1;
        const size = 4 + Math.sin(particleT * Math.PI) * 3;

        ctx.beginPath();
        ctx.arc(px, py, size, 0, Math.PI * 2);
        ctx.fillStyle = color.replace('ALPHA', String(alpha * 0.7));
        ctx.fill();
      }
    };

    drawParticles(aSrc, cTarget, numParticlesA, 'rgba(231,76,60,ALPHA)', 0);
    drawParticles(bSrc, cTarget, numParticlesB, 'rgba(52,152,219,ALPHA)', 100);

    // At the end, show a confirmation glow on c²
    if (t > 0.8) {
      const glowAlpha = (t - 0.8) / 0.2;
      ctx.beginPath();
      ctx.arc(cTarget.x, cTarget.y, 40, 0, Math.PI * 2);
      const grad = ctx.createRadialGradient(
        cTarget.x, cTarget.y, 0,
        cTarget.x, cTarget.y, 50
      );
      grad.addColorStop(0, `rgba(155,89,182,${glowAlpha * 0.5})`);
      grad.addColorStop(1, 'rgba(155,89,182,0)');
      ctx.fillStyle = grad;
      ctx.fill();

      // Checkmark
      if (t > 0.9) {
        ctx.save();
        ctx.font = `bold ${Math.floor(30 * ((t - 0.9) / 0.1))}px Arial`;
        ctx.fillStyle = `rgba(39,174,96,${(t - 0.9) / 0.1})`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('\u2713', cTarget.x, cTarget.y);
        ctx.restore();
      }
    }
  };

  // Resize handler
  useEffect(() => {
    const handleResize = () => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;
      const w = container.clientWidth;
      canvasWidth.current = w;
      canvas.width = w;
      canvas.height = 450;
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Main render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const render = () => {
      draw(ctx, triangle, proofProgress);
      animFrameRef.current = requestAnimationFrame(render);
    };
    animFrameRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [triangle, proofProgress, draw]);

  // Proof animation
  useEffect(() => {
    if (!proofMode) {
      setProofProgress(0);
      return;
    }
    let start: number | null = null;
    const duration = 3000;
    const animate = (timestamp: number) => {
      if (start === null) start = timestamp;
      const elapsed = timestamp - start;
      const p = Math.min(1, elapsed / duration);
      setProofProgress(p);
      if (p < 1) {
        proofAnimRef.current = requestAnimationFrame(animate);
      } else {
        // Loop after a pause
        setTimeout(() => {
          if (proofMode) {
            start = null;
            proofAnimRef.current = requestAnimationFrame(animate);
          }
        }, 1500);
      }
    };
    proofAnimRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(proofAnimRef.current);
  }, [proofMode]);

  // Mouse/touch handlers
  const handlePointerDown = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      e.preventDefault();
      const point = getCanvasPoint(e.nativeEvent);
      const hit = hitTest(point, triangle);
      if (hit) {
        setDragging(hit);
      }
    },
    [triangle, getCanvasPoint, hitTest]
  );

  const handlePointerMove = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      if (!dragging) return;
      e.preventDefault();
      const point = getCanvasPoint(e.nativeEvent);
      const snappedX = snapToGrid(point.x);
      const snappedY = snapToGrid(point.y);

      setTriangle((prev) => {
        const next = { ...prev };
        const canvas = canvasRef.current;
        const maxX = canvas ? canvas.width - GRID_SIZE : 600;
        const maxY = canvas ? canvas.height - GRID_SIZE : 430;
        const clampX = Math.max(GRID_SIZE, Math.min(maxX, snappedX));
        const clampY = Math.max(GRID_SIZE, Math.min(maxY, snappedY));

        if (dragging === 'A') {
          // Move the right angle vertex; keep triangle axis-aligned
          next.A = { x: clampX, y: clampY };
          // B must be on same y as A, C must be on same x as A
          next.B = { x: next.B.x, y: clampY };
          next.C = { x: clampX, y: next.C.y };
          // Enforce minimum side lengths
          if (Math.abs(next.B.x - next.A.x) < MIN_SIDE) {
            next.B = { x: next.A.x + MIN_SIDE, y: next.A.y };
          }
          if (Math.abs(next.C.y - next.A.y) < MIN_SIDE) {
            next.C = { x: next.A.x, y: next.A.y - MIN_SIDE };
          }
        } else if (dragging === 'B') {
          // B moves horizontally only (same y as A)
          const newBx = Math.max(next.A.x + MIN_SIDE, clampX);
          next.B = { x: newBx, y: next.A.y };
        } else if (dragging === 'C') {
          // C moves vertically only (same x as A)
          const newCy = Math.min(next.A.y - MIN_SIDE, clampY);
          next.C = { x: next.A.x, y: newCy };
        }

        return next;
      });
    },
    [dragging, getCanvasPoint]
  );

  const handlePointerUp = useCallback(() => {
    setDragging(null);
  }, []);

  const applyPreset = useCallback(
    (key: string) => {
      setProofMode(false);
      setProofProgress(0);
      // Adjust preset to current canvas width if needed
      const preset = PRESETS[key];
      if (preset) {
        setTriangle({ ...preset });
      }
    },
    []
  );

  const a = sideLength(triangle.A, triangle.C);
  const b = sideLength(triangle.A, triangle.B);
  const c = sideLength(triangle.B, triangle.C);
  const isRight = a * a + b * b === c * c;

  return (
    <div ref={containerRef} style={{ width: '100%', maxWidth: 900, margin: '0 auto' }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
          marginBottom: 12,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: '#5d4037',
            marginRight: 4,
          }}
        >
          Presets:
        </span>
        {Object.keys(PRESETS).map((key) => (
          <button
            key={key}
            onClick={() => applyPreset(key)}
            aria-label={`Set triangle to ${key} Pythagorean triple`}
            style={{
              padding: '6px 16px',
              borderRadius: 20,
              border: '2px solid #ff9800',
              background:
                `${a}-${b}-${c}` === key.split('-').sort((x, y) => +x - +y).join('-') ||
                key === `${Math.min(a, b)}-${Math.max(a, b)}-${c}`
                  ? '#ff9800'
                  : '#fff8e1',
              color: '#5d4037',
              fontWeight: 700,
              fontSize: 14,
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
          >
            {key}
          </button>
        ))}
        <button
          onClick={() => setProofMode((p) => !p)}
          disabled={!isRight}
          aria-label={proofMode ? 'Stop proof animation' : 'Animate Pythagoras theorem proof'}
          style={{
            padding: '6px 16px',
            borderRadius: 20,
            border: `2px solid ${isRight ? '#8e24aa' : '#ccc'}`,
            background: proofMode ? '#8e24aa' : isRight ? '#f3e5f5' : '#eee',
            color: proofMode ? '#fff' : isRight ? '#6a1b9a' : '#999',
            fontWeight: 700,
            fontSize: 14,
            cursor: isRight ? 'pointer' : 'not-allowed',
            transition: 'all 0.2s',
            marginLeft: 8,
          }}
        >
          {proofMode ? 'Stop Proof' : 'Animate Proof'}
        </button>
      </div>

      <canvas
        ref={canvasRef}
        role="img"
        aria-label="Pythagoras theorem visualization showing a right triangle with squares on each side"
        height={450}
        style={{
          width: '100%',
          height: 450,
          borderRadius: 16,
          border: '2px solid #e0d5c1',
          cursor: dragging ? 'grabbing' : 'grab',
          touchAction: 'none',
          boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
        }}
        onMouseDown={handlePointerDown}
        onMouseMove={handlePointerMove}
        onMouseUp={handlePointerUp}
        onMouseLeave={handlePointerUp}
        onTouchStart={handlePointerDown}
        onTouchMove={handlePointerMove}
        onTouchEnd={handlePointerUp}
      />

      <p
        style={{
          textAlign: 'center',
          fontSize: 13,
          color: '#8d6e63',
          marginTop: 8,
          fontStyle: 'italic',
        }}
      >
        Drag the orange dots to resize the triangle. Squares snap to grid for clean values.
      </p>
    </div>
  );
};

export default PythagorasTheorem;
