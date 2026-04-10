'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

/**
 * Integration Visualizer — Area Under a Curve
 *
 * CBSE Class 12, Chapter 7: Integrals
 * Board Exam Relevance: HIGH (6-8 marks)
 *
 * Demonstrates definite integrals by showing Riemann sums
 * converging to the exact area as rectangles increase.
 * Students see WHY integration gives area.
 */

type FuncType = 'x2' | 'sinx' | 'linear' | 'cubic';

const FUNCTIONS: Record<FuncType, {
  name: string;
  f: (x: number) => number;
  integral: (a: number, b: number) => number;
  formula: string;
  integralFormula: string;
}> = {
  x2: {
    name: 'f(x) = x²',
    f: (x: number) => x * x,
    integral: (a: number, b: number) => (b ** 3 - a ** 3) / 3,
    formula: 'x²',
    integralFormula: 'x³/3',
  },
  sinx: {
    name: 'f(x) = sin(x)',
    f: (x: number) => Math.sin(x),
    integral: (a: number, b: number) => -Math.cos(b) + Math.cos(a),
    formula: 'sin(x)',
    integralFormula: '-cos(x)',
  },
  linear: {
    name: 'f(x) = 2x + 1',
    f: (x: number) => 2 * x + 1,
    integral: (a: number, b: number) => (b * b + b) - (a * a + a),
    formula: '2x + 1',
    integralFormula: 'x² + x',
  },
  cubic: {
    name: 'f(x) = x³ - 3x',
    f: (x: number) => x ** 3 - 3 * x,
    integral: (a: number, b: number) => (b ** 4 / 4 - 3 * b ** 2 / 2) - (a ** 4 / 4 - 3 * a ** 2 / 2),
    formula: 'x³ - 3x',
    integralFormula: 'x⁴/4 - 3x²/2',
  },
};

export default function IntegrationVisualizer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasWidth, setCanvasWidth] = useState(500);

  const [funcType, setFuncType] = useState<FuncType>('x2');
  const [rectangles, setRectangles] = useState(5);
  const [lowerBound, setLowerBound] = useState(0);
  const [upperBound, setUpperBound] = useState(3);
  const [sumType, setSumType] = useState<'left' | 'right' | 'mid'>('left');

  const func = FUNCTIONS[funcType];
  const exactArea = func.integral(lowerBound, upperBound);

  // Compute Riemann sum
  const dx = (upperBound - lowerBound) / rectangles;
  let riemannSum = 0;
  for (let i = 0; i < rectangles; i++) {
    const xSample = sumType === 'left' ? lowerBound + i * dx :
      sumType === 'right' ? lowerBound + (i + 1) * dx :
      lowerBound + (i + 0.5) * dx;
    riemannSum += func.f(xSample) * dx;
  }
  const error = Math.abs(riemannSum - exactArea);
  const errorPct = exactArea !== 0 ? (error / Math.abs(exactArea)) * 100 : 0;

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

    // Background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);

    // Coordinate system
    const padding = { left: 40, right: 20, top: 20, bottom: 30 };
    const plotW = w - padding.left - padding.right;
    const plotH = h - padding.top - padding.bottom;

    // Determine visible range
    const xMin = Math.min(lowerBound - 0.5, -0.5);
    const xMax = Math.max(upperBound + 0.5, upperBound + 1);
    const xRange = xMax - xMin;

    // Sample function to find y range
    let yMin = 0, yMax = 0;
    for (let x = xMin; x <= xMax; x += 0.05) {
      const y = func.f(x);
      yMin = Math.min(yMin, y);
      yMax = Math.max(yMax, y);
    }
    yMin = Math.min(yMin, -0.5);
    yMax = Math.max(yMax, yMax * 1.2);
    const yRange = yMax - yMin;

    const toPixelX = (x: number) => padding.left + ((x - xMin) / xRange) * plotW;
    const toPixelY = (y: number) => padding.top + ((yMax - y) / yRange) * plotH;

    // Grid
    ctx.strokeStyle = '#f1f5f9';
    ctx.lineWidth = 1;
    for (let x = Math.ceil(xMin); x <= Math.floor(xMax); x++) {
      const px = toPixelX(x);
      ctx.beginPath();
      ctx.moveTo(px, padding.top);
      ctx.lineTo(px, h - padding.bottom);
      ctx.stroke();
    }

    // Axes
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1.5;
    const axisY = toPixelY(0);
    ctx.beginPath();
    ctx.moveTo(padding.left, axisY);
    ctx.lineTo(w - padding.right, axisY);
    ctx.stroke();
    const axisX = toPixelX(0);
    if (axisX > padding.left && axisX < w - padding.right) {
      ctx.beginPath();
      ctx.moveTo(axisX, padding.top);
      ctx.lineTo(axisX, h - padding.bottom);
      ctx.stroke();
    }

    // X-axis labels
    ctx.fillStyle = '#64748B';
    ctx.font = '10px system-ui';
    ctx.textAlign = 'center';
    for (let x = Math.ceil(xMin); x <= Math.floor(xMax); x++) {
      ctx.fillText(String(x), toPixelX(x), h - padding.bottom + 14);
    }

    // Riemann rectangles
    for (let i = 0; i < rectangles; i++) {
      const xLeft = lowerBound + i * dx;
      const xRight = xLeft + dx;
      const xSample = sumType === 'left' ? xLeft : sumType === 'right' ? xRight : (xLeft + xRight) / 2;
      const yVal = func.f(xSample);

      const pxLeft = toPixelX(xLeft);
      const pxRight = toPixelX(xRight);
      const pxTop = toPixelY(yVal);
      const pxBase = toPixelY(0);

      const rectH = pxBase - pxTop;
      ctx.fillStyle = yVal >= 0 ? 'rgba(99, 102, 241, 0.25)' : 'rgba(239, 68, 68, 0.2)';
      ctx.fillRect(pxLeft, Math.min(pxTop, pxBase), pxRight - pxLeft, Math.abs(rectH));

      ctx.strokeStyle = yVal >= 0 ? '#6366F1' : '#EF4444';
      ctx.lineWidth = 1;
      ctx.strokeRect(pxLeft, Math.min(pxTop, pxBase), pxRight - pxLeft, Math.abs(rectH));
    }

    // Function curve
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    let started = false;
    for (let px = padding.left; px <= w - padding.right; px++) {
      const x = xMin + ((px - padding.left) / plotW) * xRange;
      const y = func.f(x);
      const py = toPixelY(y);
      if (!started) { ctx.moveTo(px, py); started = true; }
      else ctx.lineTo(px, py);
    }
    ctx.stroke();

    // Bound markers
    ctx.strokeStyle = '#22c55e';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    const aX = toPixelX(lowerBound);
    ctx.beginPath();
    ctx.moveTo(aX, padding.top);
    ctx.lineTo(aX, h - padding.bottom);
    ctx.stroke();
    const bX = toPixelX(upperBound);
    ctx.beginPath();
    ctx.moveTo(bX, padding.top);
    ctx.lineTo(bX, h - padding.bottom);
    ctx.stroke();
    ctx.setLineDash([]);

    // Bound labels
    ctx.fillStyle = '#22c55e';
    ctx.font = 'bold 11px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(`a=${lowerBound}`, aX, h - padding.bottom + 26);
    ctx.fillText(`b=${upperBound}`, bX, h - padding.bottom + 26);
  }, [rectangles, lowerBound, upperBound, sumType, func, dx]);

  useEffect(() => { draw(); }, [draw]);

  return (
    <div ref={containerRef} style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", maxWidth: 600, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#6366F1' }}>∫ Integration Visualizer</div>
        <div style={{ fontSize: 11, color: '#64748B' }}>See how rectangles approximate the area under a curve</div>
      </div>

      {/* Function selector */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
        {(Object.entries(FUNCTIONS) as [FuncType, typeof FUNCTIONS[FuncType]][]).map(([key, val]) => (
          <button key={key} onClick={() => setFuncType(key)} aria-label={`Select function ${val.name}`} style={{ padding: '5px 12px', borderRadius: 6, border: `1px solid ${funcType === key ? '#6366F1' : '#e2e8f0'}`, background: funcType === key ? '#6366F1' : '#fff', color: funcType === key ? '#fff' : '#64748B', fontSize: 11, cursor: 'pointer', fontWeight: funcType === key ? 600 : 400 }}>
            {val.name}
          </button>
        ))}
      </div>

      {/* Canvas */}
      <canvas ref={canvasRef} role="img" aria-label="Integration visualization showing Riemann sum rectangles approximating the area under a curve" style={{ width: '100%', height: 280, borderRadius: 8, border: '1px solid #e2e8f0' }} />

      {/* Controls */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
        <div style={{ padding: '10px 12px', background: '#eff6ff', borderRadius: 8, border: '1px solid #bfdbfe' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#1e40af', marginBottom: 4 }}>📊 Rectangles (n)</div>
          <input type="range" min={1} max={100} step={1} value={rectangles} onChange={e => setRectangles(Number(e.target.value))} aria-label={`Number of rectangles slider, ${rectangles}, range 1 to 100`} style={{ width: '100%', accentColor: '#3b82f6' }} />
          <div style={{ fontSize: 16, fontWeight: 700, color: '#1e293b', textAlign: 'center' }}>{rectangles}</div>
        </div>

        <div style={{ padding: '10px 12px', background: '#f0fdf4', borderRadius: 8, border: '1px solid #bbf7d0' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#166534', marginBottom: 4 }}>📏 Sum Type</div>
          <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
            {(['left', 'mid', 'right'] as const).map(t => (
              <button key={t} onClick={() => setSumType(t)} aria-label={`${t} Riemann sum type`} style={{ padding: '4px 10px', borderRadius: 4, border: `1px solid ${sumType === t ? '#22c55e' : '#e2e8f0'}`, background: sumType === t ? '#22c55e' : '#fff', color: sumType === t ? '#fff' : '#64748B', fontSize: 11, cursor: 'pointer' }}>
                {t}
              </button>
            ))}
          </div>
        </div>

        <div style={{ padding: '10px 12px', background: '#faf5ff', borderRadius: 8, border: '1px solid #e9d5ff' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#6b21a8', marginBottom: 4 }}>Lower bound (a)</div>
          <input type="range" min={-2} max={upperBound - 0.5} step={0.5} value={lowerBound} onChange={e => setLowerBound(Number(e.target.value))} aria-label={`Lower bound slider, ${lowerBound}, range -2 to ${upperBound - 0.5}`} style={{ width: '100%', accentColor: '#8b5cf6' }} />
          <div style={{ fontSize: 14, fontWeight: 700, color: '#1e293b', textAlign: 'center' }}>{lowerBound}</div>
        </div>

        <div style={{ padding: '10px 12px', background: '#faf5ff', borderRadius: 8, border: '1px solid #e9d5ff' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#6b21a8', marginBottom: 4 }}>Upper bound (b)</div>
          <input type="range" min={lowerBound + 0.5} max={5} step={0.5} value={upperBound} onChange={e => setUpperBound(Number(e.target.value))} aria-label={`Upper bound slider, ${upperBound}, range ${lowerBound + 0.5} to 5`} style={{ width: '100%', accentColor: '#8b5cf6' }} />
          <div style={{ fontSize: 14, fontWeight: 700, color: '#1e293b', textAlign: 'center' }}>{upperBound}</div>
        </div>
      </div>

      {/* Results */}
      <div style={{ marginTop: 12, padding: '12px 14px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, textAlign: 'center' }}>
          <div>
            <div style={{ fontSize: 10, color: '#64748B' }}>Riemann Sum</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#6366F1' }}>{riemannSum.toFixed(3)}</div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: '#64748B' }}>Exact ∫</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#22c55e' }}>{exactArea.toFixed(3)}</div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: '#64748B' }}>Error</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: errorPct < 1 ? '#22c55e' : errorPct < 5 ? '#f59e0b' : '#ef4444' }}>{errorPct.toFixed(1)}%</div>
          </div>
        </div>
        <div style={{ marginTop: 8, fontSize: 11, color: '#334155', textAlign: 'center' }}>
          ∫<sub>{lowerBound}</sub><sup>{upperBound}</sup> {func.formula} dx = [{func.integralFormula}]<sub>{lowerBound}</sub><sup>{upperBound}</sup> = {exactArea.toFixed(3)}
        </div>
        {rectangles >= 50 && errorPct < 1 && (
          <div style={{ marginTop: 6, fontSize: 11, color: '#166534', textAlign: 'center', padding: '4px 8px', background: '#f0fdf4', borderRadius: 4 }}>
            💡 With {rectangles} rectangles, the sum is very close to the exact integral!
          </div>
        )}
      </div>
    </div>
  );
}
