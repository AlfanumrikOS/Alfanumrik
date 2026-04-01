'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';

// Convex lens image formation simulation
// CBSE Physics Practical: Image formation by convex lens at different object positions

interface DataRow {
  u: number;
  v: number;
  f_calc: number;
  magnification: number;
  nature: string;
  size: string;
  orientation: string;
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

const FOCAL_LENGTH = 15; // cm (fixed lens)

export default function ConvexLensLab() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animFrameRef = useRef<number>(0);
  const timeRef = useRef<number>(0);

  const [objectDist, setObjectDist] = useState(-40); // u is negative (sign convention)
  const [isDragging, setIsDragging] = useState(false);
  const [dataTable, setDataTable] = useState<DataRow[]>([]);
  const [showRays, setShowRays] = useState(true);

  const f = FOCAL_LENGTH;

  // Lens formula: 1/v - 1/u = 1/f
  // u is negative (object on left), f is positive for convex lens
  // 1/v = 1/f + 1/u = 1/f - 1/|u|
  const u = objectDist; // negative
  const v_inv = (1 / f) + (1 / u); // 1/v = 1/f + 1/u (u is negative)
  const v = v_inv !== 0 ? 1 / v_inv : Infinity;
  const magnification = v / u;
  const isReal = v > 0;
  const isVirtual = !isReal && isFinite(v);
  const isAtFocus = Math.abs(Math.abs(u) - f) < 1;
  const imageAtInfinity = isAtFocus;

  // Image characteristics
  const getImageNature = (): string => {
    if (imageAtInfinity) return 'At infinity';
    return isReal ? 'Real' : 'Virtual';
  };

  const getImageSize = (): string => {
    if (imageAtInfinity) return '-';
    const m = Math.abs(magnification);
    if (Math.abs(m - 1) < 0.05) return 'Same size';
    return m > 1 ? 'Magnified' : 'Diminished';
  };

  const getImageOrientation = (): string => {
    if (imageAtInfinity) return '-';
    return magnification > 0 ? 'Erect' : 'Inverted';
  };

  const recordReading = useCallback(() => {
    const row: DataRow = {
      u: Math.round(u * 10) / 10,
      v: imageAtInfinity ? Infinity : Math.round(v * 10) / 10,
      f_calc: imageAtInfinity ? f : Math.round((1 / (1 / v - 1 / u)) * 10) / 10,
      magnification: imageAtInfinity ? Infinity : Math.round(magnification * 100) / 100,
      nature: getImageNature(),
      size: getImageSize(),
      orientation: getImageOrientation(),
    };
    setDataTable(prev => [...prev, row]);
  }, [u, v, magnification, imageAtInfinity, f]);

  const drawScene = useCallback((ctx: CanvasRenderingContext2D, w: number, h: number, time: number) => {
    const dpr = window.devicePixelRatio || 1;
    const cw = w / dpr;
    const ch = h / dpr;

    // Background
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, cw, ch);

    // Title
    ctx.font = 'bold 16px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(220, 180, 255, 0.9)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('Convex Lens — Image Formation', cw / 2, 10);

    // Layout: lens at center, scale 3 pixels per cm
    const lensX = cw / 2;
    const axisY = ch * 0.5;
    const scale = Math.min((cw - 80) / 120, 4); // pixels per cm

    // --- Principal axis ---
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(20, axisY);
    ctx.lineTo(cw - 20, axisY);
    ctx.stroke();
    ctx.setLineDash([]);

    // --- Lens ---
    const lensH = 120;
    ctx.strokeStyle = 'rgba(100, 180, 255, 0.8)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    // Double convex shape
    ctx.moveTo(lensX, axisY - lensH / 2);
    ctx.quadraticCurveTo(lensX + 12, axisY, lensX, axisY + lensH / 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(lensX, axisY - lensH / 2);
    ctx.quadraticCurveTo(lensX - 12, axisY, lensX, axisY + lensH / 2);
    ctx.stroke();

    // Lens arrowheads
    ctx.fillStyle = 'rgba(100, 180, 255, 0.8)';
    ctx.beginPath();
    ctx.moveTo(lensX, axisY - lensH / 2);
    ctx.lineTo(lensX - 6, axisY - lensH / 2 + 10);
    ctx.lineTo(lensX + 6, axisY - lensH / 2 + 10);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(lensX, axisY + lensH / 2);
    ctx.lineTo(lensX - 6, axisY + lensH / 2 - 10);
    ctx.lineTo(lensX + 6, axisY + lensH / 2 - 10);
    ctx.closePath();
    ctx.fill();

    // --- Focal points and 2F markers ---
    const focalPoints = [
      { label: 'F', dist: f },
      { label: 'F', dist: -f },
      { label: '2F', dist: 2 * f },
      { label: '2F', dist: -2 * f },
    ];

    for (const fp of focalPoints) {
      const px = lensX + fp.dist * scale;
      if (px < 20 || px > cw - 20) continue;

      ctx.fillStyle = 'rgba(255, 200, 100, 0.6)';
      ctx.beginPath();
      ctx.arc(px, axisY, 4, 0, Math.PI * 2);
      ctx.fill();

      ctx.font = '11px "Segoe UI", sans-serif';
      ctx.fillStyle = '#ffcc88';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(fp.label, px, axisY + 8);
    }

    // Optical centre
    ctx.fillStyle = 'rgba(100, 180, 255, 0.5)';
    ctx.beginPath();
    ctx.arc(lensX, axisY, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = '11px "Segoe UI", sans-serif';
    ctx.fillStyle = '#88bbff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('O', lensX, axisY + 8);

    // --- Object (arrow on left side) ---
    const objX = lensX + u * scale; // u is negative, so objX < lensX
    const objHeight = 40;

    // Object arrow
    ctx.strokeStyle = '#ff6666';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(objX, axisY);
    ctx.lineTo(objX, axisY - objHeight);
    ctx.stroke();
    // Arrowhead
    ctx.fillStyle = '#ff6666';
    ctx.beginPath();
    ctx.moveTo(objX, axisY - objHeight - 6);
    ctx.lineTo(objX - 5, axisY - objHeight + 4);
    ctx.lineTo(objX + 5, axisY - objHeight + 4);
    ctx.closePath();
    ctx.fill();

    // Object label
    ctx.font = 'bold 12px "Segoe UI", sans-serif';
    ctx.fillStyle = '#ff8888';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText('Object', objX, axisY - objHeight - 10);

    // Touch indicator for object
    if (!isDragging) {
      ctx.fillStyle = 'rgba(255, 100, 100, 0.1)';
      ctx.beginPath();
      ctx.arc(objX, axisY - objHeight / 2, 25, 0, Math.PI * 2);
      ctx.fill();
    }

    // --- Image ---
    if (!imageAtInfinity && isFinite(v)) {
      const imgX = lensX + v * scale;
      const imgHeight = objHeight * Math.abs(magnification);
      const clampedImgH = clamp(imgHeight, 5, 140);
      const imgTop = magnification < 0 ? axisY + clampedImgH : axisY - clampedImgH;

      // Image arrow
      const imgColor = isReal ? '#66ff66' : '#66ccff';
      const imgAlpha = isReal ? 1.0 : 0.6;

      ctx.strokeStyle = imgColor;
      ctx.lineWidth = 3;
      ctx.globalAlpha = imgAlpha;
      if (!isReal) {
        ctx.setLineDash([6, 4]);
      }
      ctx.beginPath();
      ctx.moveTo(imgX, axisY);
      ctx.lineTo(imgX, imgTop);
      ctx.stroke();
      ctx.setLineDash([]);

      // Image arrowhead
      ctx.fillStyle = imgColor;
      const arrowDir = magnification < 0 ? 1 : -1;
      ctx.beginPath();
      ctx.moveTo(imgX, imgTop + arrowDir * (-6));
      ctx.lineTo(imgX - 5, imgTop + arrowDir * 4);
      ctx.lineTo(imgX + 5, imgTop + arrowDir * 4);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;

      // Image label
      ctx.font = 'bold 12px "Segoe UI", sans-serif';
      ctx.fillStyle = imgColor;
      ctx.textAlign = 'center';
      const labelY = magnification < 0
        ? axisY + clampedImgH + 14
        : axisY - clampedImgH - 14;
      ctx.textBaseline = magnification < 0 ? 'top' : 'bottom';
      ctx.fillText('Image', imgX, labelY);

      // --- Ray diagram ---
      if (showRays) {
        ctx.lineWidth = 1.5;

        // Ray 1: Parallel to axis -> through F on other side
        ctx.strokeStyle = 'rgba(255, 200, 50, 0.6)';
        ctx.beginPath();
        ctx.moveTo(objX, axisY - objHeight);
        ctx.lineTo(lensX, axisY - objHeight);
        if (isReal) {
          ctx.lineTo(imgX, imgTop);
        } else {
          ctx.stroke();
          // Extend through F
          const fX = lensX + f * scale;
          ctx.setLineDash([4, 3]);
          ctx.beginPath();
          ctx.moveTo(lensX, axisY - objHeight);
          ctx.lineTo(fX + (fX - lensX) * 3, axisY + (axisY - (axisY - objHeight)) * 3);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.moveTo(lensX, axisY - objHeight);
        }
        ctx.stroke();

        // Ray 2: Through optical centre (straight through)
        ctx.strokeStyle = 'rgba(100, 255, 100, 0.6)';
        ctx.beginPath();
        ctx.moveTo(objX, axisY - objHeight);
        if (isReal) {
          ctx.lineTo(imgX, imgTop);
        } else {
          ctx.lineTo(lensX + 100, axisY + ((axisY - (axisY - objHeight)) / (lensX - objX)) * 100);
        }
        ctx.stroke();

        // Ray 3: Through F on object side -> parallel after lens
        ctx.strokeStyle = 'rgba(100, 180, 255, 0.6)';
        const fObjX = lensX - f * scale;
        // Line from object top to F on object side, extended to lens
        const slope = (axisY - (axisY - objHeight)) / (fObjX - objX);
        const yAtLens = (axisY - objHeight) + slope * (lensX - objX);

        ctx.beginPath();
        ctx.moveTo(objX, axisY - objHeight);
        ctx.lineTo(lensX, yAtLens);
        ctx.stroke();

        // After lens: parallel to axis
        ctx.beginPath();
        ctx.moveTo(lensX, yAtLens);
        if (isReal) {
          ctx.lineTo(imgX, yAtLens);
        } else {
          ctx.lineTo(lensX + 150, yAtLens);
        }
        ctx.stroke();
      }
    } else if (imageAtInfinity) {
      // Rays go parallel after lens
      if (showRays) {
        ctx.strokeStyle = 'rgba(255, 200, 50, 0.6)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(lensX, axisY - objHeight);
        ctx.lineTo(cw - 20, axisY - objHeight);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.font = 'bold 14px "Segoe UI", sans-serif';
        ctx.fillStyle = '#ffcc88';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Image at infinity', cw * 0.75, axisY - objHeight - 20);
      }
    }

    // --- Info panel ---
    const infoY = ch - 95;
    const infoW = Math.min(cw - 40, 500);
    const infoX = (cw - infoW) / 2;

    ctx.fillStyle = 'rgba(30, 20, 50, 0.7)';
    ctx.beginPath();
    ctx.roundRect(infoX, infoY, infoW, 85, 10);
    ctx.fill();
    ctx.strokeStyle = 'rgba(160,100,255,0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(infoX, infoY, infoW, 85, 10);
    ctx.stroke();

    ctx.font = 'bold 12px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#e0c0ff';
    ctx.fillText('Lens Formula: 1/v - 1/u = 1/f', cw / 2, infoY + 6);

    ctx.font = '11px "Courier New", monospace';
    ctx.fillStyle = '#aaccff';
    const uStr = u.toFixed(1);
    const vStr = imageAtInfinity ? '∞' : v.toFixed(1);
    ctx.fillText(
      `u = ${uStr} cm | v = ${vStr} cm | f = ${f} cm`,
      cw / 2, infoY + 24
    );

    ctx.fillStyle = '#ffcc88';
    ctx.fillText(
      `m = ${imageAtInfinity ? '∞' : magnification.toFixed(2)} | ${getImageNature()} | ${getImageOrientation()} | ${getImageSize()}`,
      cw / 2, infoY + 42
    );

    // Verification
    if (!imageAtInfinity && isFinite(v)) {
      const lhs = (1 / v - 1 / u);
      const rhs = 1 / f;
      ctx.font = '10px "Courier New", monospace';
      ctx.fillStyle = Math.abs(lhs - rhs) < 0.001 ? '#4CAF50' : '#ff8888';
      ctx.fillText(
        `Verify: 1/v - 1/u = ${lhs.toFixed(4)} | 1/f = ${rhs.toFixed(4)} ✓`,
        cw / 2, infoY + 62
      );
    }

    // --- Scale label ---
    ctx.font = '10px "Segoe UI", sans-serif';
    ctx.fillStyle = '#666';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`Scale: 1 cm = ${scale.toFixed(1)} px`, 20, ch - 4);

  }, [objectDist, u, v, magnification, imageAtInfinity, isReal, isDragging, showRays, f]);

  // Canvas setup and animation
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let running = true;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = container.getBoundingClientRect();
      const canvasH = 420;
      canvas.width = rect.width * dpr;
      canvas.height = canvasH * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${canvasH}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    window.addEventListener('resize', resize);

    const animate = (time: number) => {
      if (!running) return;
      timeRef.current = time;
      drawScene(ctx, canvas.width, canvas.height, time);
      animFrameRef.current = requestAnimationFrame(animate);
    };

    animFrameRef.current = requestAnimationFrame(animate);

    return () => {
      running = false;
      cancelAnimationFrame(animFrameRef.current);
      window.removeEventListener('resize', resize);
    };
  }, [drawScene]);

  // Pointer interaction for dragging object
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const cw = rect.width;
    const lensX = cw / 2;
    const sc = Math.min((cw - 80) / 120, 4);
    const objX = lensX + objectDist * sc;

    if (Math.abs(x - objX) < 30) {
      setIsDragging(true);
      canvas.setPointerCapture(e.pointerId);
    }
  }, [objectDist]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDragging) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const cw = rect.width;
    const lensX = cw / 2;
    const sc = Math.min((cw - 80) / 120, 4);
    const newU = (x - lensX) / sc;
    // Object must be on the left side (negative u), and not at lens
    setObjectDist(clamp(newU, -55, -3));
  }, [isDragging]);

  const handlePointerUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleReset = () => {
    setObjectDist(-40);
    setDataTable([]);
    setShowRays(true);
  };

  // Preset positions
  const presets = [
    { label: 'Beyond 2F', u: -45 },
    { label: 'At 2F', u: -30 },
    { label: 'Between F & 2F', u: -22 },
    { label: 'At F', u: -15 },
    { label: 'Between F & Lens', u: -8 },
  ];

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        maxWidth: 640,
        margin: '0 auto',
        fontFamily: '"Segoe UI", system-ui, sans-serif',
      }}
    >
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="Convex lens simulation showing object, image, and ray diagram for different object positions"
        style={{
          width: '100%',
          height: 420,
          borderRadius: 16,
          display: 'block',
          cursor: isDragging ? 'grabbing' : 'grab',
          touchAction: 'none',
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />

      <div
        style={{
          padding: '20px 4px 8px',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        {/* Object distance slider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <label
            style={{
              minWidth: 150,
              color: '#ff8888',
              fontWeight: 700,
              fontSize: 14,
            }}
          >
            Object u = {objectDist.toFixed(1)} cm
          </label>
          <input
            type="range"
            min={-55}
            max={-3}
            step={0.5}
            value={objectDist}
            onChange={(e) => setObjectDist(parseFloat(e.target.value))}
            aria-label={`Object distance, ${objectDist.toFixed(1)} cm`}
            style={{
              flex: 1,
              accentColor: '#ff6633',
              height: 6,
              cursor: 'pointer',
            }}
          />
        </div>

        {/* Preset positions */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {presets.map((p) => (
            <button
              key={p.label}
              onClick={() => setObjectDist(p.u)}
              style={{
                background: Math.abs(objectDist - p.u) < 2
                  ? 'linear-gradient(135deg, #1b5e20 0%, #2e7d32 100%)'
                  : 'rgba(40, 30, 60, 0.8)',
                border: `1px solid ${Math.abs(objectDist - p.u) < 2 ? 'rgba(76,175,80,0.6)' : 'rgba(160,100,255,0.3)'}`,
                borderRadius: 8,
                padding: '5px 10px',
                color: Math.abs(objectDist - p.u) < 2 ? '#c8e6c9' : '#c090ff',
                fontWeight: 600,
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Actions row */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 8,
          }}
        >
          <button
            onClick={recordReading}
            aria-label="Record current reading"
            style={{
              background: 'linear-gradient(135deg, #1b5e20 0%, #2e7d32 100%)',
              border: '1px solid rgba(76,175,80,0.7)',
              borderRadius: 10,
              padding: '8px 16px',
              color: '#c8e6c9',
              fontWeight: 700,
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            Record ({dataTable.length})
          </button>

          <button
            onClick={() => setShowRays(prev => !prev)}
            style={{
              background: showRays
                ? 'linear-gradient(135deg, #1a237e 0%, #283593 100%)'
                : 'rgba(40, 30, 60, 0.6)',
              border: `1px solid ${showRays ? 'rgba(100,140,255,0.5)' : 'rgba(100,100,100,0.3)'}`,
              borderRadius: 10,
              padding: '8px 16px',
              color: showRays ? '#bbccff' : '#888',
              fontWeight: 700,
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            {showRays ? 'Rays ON' : 'Rays OFF'}
          </button>

          <button
            onClick={handleReset}
            aria-label="Reset simulation"
            style={{
              background: 'linear-gradient(135deg, #2a1845 0%, #3a2060 100%)',
              border: '1px solid rgba(160,100,255,0.4)',
              borderRadius: 10,
              padding: '8px 16px',
              color: '#d0b0ff',
              fontWeight: 700,
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            Reset
          </button>
        </div>

        {/* Data table */}
        {dataTable.length > 0 && (
          <div
            style={{
              background: 'rgba(30, 20, 50, 0.5)',
              border: '1px solid rgba(160,100,255,0.2)',
              borderRadius: 10,
              padding: 12,
              overflowX: 'auto',
            }}
          >
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: 11,
                fontFamily: '"Courier New", monospace',
              }}
            >
              <thead>
                <tr>
                  {['#', 'u (cm)', 'v (cm)', 'f (cm)', 'm', 'Nature', 'Size', 'Orient.'].map(h => (
                    <th key={h} style={{ padding: '3px 6px', color: '#c090ff', textAlign: 'center', borderBottom: '1px solid rgba(160,100,255,0.3)', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dataTable.map((row, i) => (
                  <tr key={i}>
                    <td style={{ padding: '3px 6px', color: '#aaa', textAlign: 'center' }}>{i + 1}</td>
                    <td style={{ padding: '3px 6px', color: '#ff8888', textAlign: 'center' }}>{row.u}</td>
                    <td style={{ padding: '3px 6px', color: '#88ff88', textAlign: 'center' }}>{isFinite(row.v) ? row.v : '∞'}</td>
                    <td style={{ padding: '3px 6px', color: '#88bbff', textAlign: 'center' }}>{isFinite(row.f_calc) ? row.f_calc : '-'}</td>
                    <td style={{ padding: '3px 6px', color: '#ffcc88', textAlign: 'center' }}>{isFinite(row.magnification) ? row.magnification : '∞'}</td>
                    <td style={{ padding: '3px 6px', color: '#aaa', textAlign: 'center' }}>{row.nature}</td>
                    <td style={{ padding: '3px 6px', color: '#aaa', textAlign: 'center' }}>{row.size}</td>
                    <td style={{ padding: '3px 6px', color: '#aaa', textAlign: 'center' }}>{row.orientation}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Tip */}
        <p
          style={{
            margin: 0,
            padding: '8px 12px',
            background: 'rgba(255, 170, 50, 0.08)',
            border: '1px solid rgba(255, 170, 50, 0.2)',
            borderRadius: 10,
            color: '#ffcc88',
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          <strong>CBSE Tip:</strong> Drag the object to each of the 5 standard positions (beyond 2F,
          at 2F, between F and 2F, at F, between F and lens) and record readings. Note how the image
          changes from real-inverted to virtual-erect as the object crosses the focal point.
        </p>
      </div>
    </div>
  );
}
