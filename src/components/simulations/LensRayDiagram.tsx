'use client';
import { useState, useRef, useEffect, useCallback } from 'react';

type OpticsType = 'convex-lens' | 'concave-lens' | 'convex-mirror' | 'concave-mirror';

interface ImageInfo {
  v: number;
  magnification: number;
  nature: string;
  orientation: string;
  size: string;
}

function computeImage(u: number, f: number, optType: OpticsType): ImageInfo {
  // Sign convention: object on left, distances measured from optic center
  // For lens: 1/v - 1/u = 1/f  =>  1/v = 1/f + 1/u
  // For mirror: 1/v + 1/u = 1/f  =>  1/v = 1/f - 1/u
  // u is negative (object on left), f: convex lens +, concave lens -, concave mirror +, convex mirror -
  const uSigned = -Math.abs(u);
  let fSigned: number;
  if (optType === 'convex-lens') fSigned = Math.abs(f);
  else if (optType === 'concave-lens') fSigned = -Math.abs(f);
  else if (optType === 'concave-mirror') fSigned = -Math.abs(f);
  else fSigned = Math.abs(f);

  let v: number;
  if (optType.includes('lens')) {
    // 1/v = 1/f + 1/u
    const inv = 1 / fSigned + 1 / uSigned;
    if (Math.abs(inv) < 0.0001) return { v: Infinity, magnification: Infinity, nature: 'At infinity', orientation: '—', size: '—' };
    v = 1 / inv;
  } else {
    // mirror: 1/v = 1/f - 1/u
    const inv = 1 / fSigned - 1 / uSigned;
    if (Math.abs(inv) < 0.0001) return { v: Infinity, magnification: Infinity, nature: 'At infinity', orientation: '—', size: '—' };
    v = 1 / inv;
  }

  const m = optType.includes('lens') ? v / uSigned : -(v / uSigned);
  const nature = v > 0 ? (optType.includes('lens') ? 'Real' : 'Virtual') : (optType.includes('lens') ? 'Virtual' : 'Real');
  const orientation = m > 0 ? 'Erect' : 'Inverted';
  const absM = Math.abs(m);
  const size = absM > 1.05 ? 'Magnified' : absM < 0.95 ? 'Diminished' : 'Same size';

  return { v, magnification: m, nature, orientation, size };
}

export default function LensRayDiagram() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [optType, setOptType] = useState<OpticsType>('convex-lens');
  const [focalLength, setFocalLength] = useState(12);
  const [objectDist, setObjectDist] = useState(30); // in "units" (mapped to pixels)
  const [isDragging, setIsDragging] = useState(false);
  const [canvasWidth, setCanvasWidth] = useState(700);
  const canvasHeight = 420;

  // Responsive width
  useEffect(() => {
    const updateWidth = () => {
      if (containerRef.current) {
        setCanvasWidth(Math.min(containerRef.current.offsetWidth, 900));
      }
    };
    updateWidth();
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  const scale = canvasWidth / 80; // pixels per unit
  const cx = canvasWidth / 2;
  const cy = canvasHeight / 2;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    // Background
    const bgGrad = ctx.createLinearGradient(0, 0, 0, canvasHeight);
    bgGrad.addColorStop(0, '#f0f4ff');
    bgGrad.addColorStop(1, '#e8eeff');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    // Grid
    ctx.strokeStyle = 'rgba(99,102,241,0.06)';
    ctx.lineWidth = 1;
    for (let x = 0; x < canvasWidth; x += scale * 5) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvasHeight); ctx.stroke();
    }
    for (let y = 0; y < canvasHeight; y += scale * 5) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvasWidth, y); ctx.stroke();
    }

    // Principal axis
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 4]);
    ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(canvasWidth, cy); ctx.stroke();
    ctx.setLineDash([]);

    const f = focalLength;
    const fPx = f * scale;
    const isLens = optType.includes('lens');
    const isConvex = optType === 'convex-lens' || optType === 'convex-mirror';

    // Draw optic element
    if (isLens) {
      // Lens
      ctx.strokeStyle = '#6366F1';
      ctx.lineWidth = 3;
      ctx.fillStyle = 'rgba(99,102,241,0.08)';
      const lensH = 140;
      const bulge = isConvex ? 18 : -18;
      ctx.beginPath();
      ctx.moveTo(cx - bulge, cy - lensH / 2);
      ctx.quadraticCurveTo(cx + bulge, cy, cx - bulge, cy + lensH / 2);
      ctx.fill(); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx + bulge, cy - lensH / 2);
      ctx.quadraticCurveTo(cx - bulge, cy, cx + bulge, cy + lensH / 2);
      ctx.fill(); ctx.stroke();
      // Arrows at tips
      ctx.fillStyle = '#6366F1';
      const arr = isConvex ? 8 : -8;
      ctx.beginPath(); ctx.moveTo(cx - bulge - arr, cy - lensH / 2 - 5); ctx.lineTo(cx - bulge, cy - lensH / 2); ctx.lineTo(cx - bulge + arr, cy - lensH / 2 - 5); ctx.fill();
      ctx.beginPath(); ctx.moveTo(cx - bulge - arr, cy + lensH / 2 + 5); ctx.lineTo(cx - bulge, cy + lensH / 2); ctx.lineTo(cx - bulge + arr, cy + lensH / 2 + 5); ctx.fill();
    } else {
      // Mirror (curved line)
      ctx.strokeStyle = '#6366F1';
      ctx.lineWidth = 3;
      const mirH = 140;
      const curv = isConvex ? -25 : 25;
      ctx.beginPath();
      ctx.moveTo(cx + curv, cy - mirH / 2);
      ctx.quadraticCurveTo(cx - curv, cy, cx + curv, cy + mirH / 2);
      ctx.stroke();
      // Hatching on back
      ctx.strokeStyle = 'rgba(99,102,241,0.4)';
      ctx.lineWidth = 1;
      for (let i = -mirH / 2; i <= mirH / 2; i += 8) {
        const t = (i + mirH / 2) / mirH;
        const xc = cx + curv - curv * 2 * (4 * t * (1 - t)) * 0.5;
        ctx.beginPath(); ctx.moveTo(xc, cy + i); ctx.lineTo(xc + 8, cy + i - 6); ctx.stroke();
      }
    }

    // Mark focal points and 2F
    const markX = (dist: number, label: string) => {
      ctx.fillStyle = '#6366F1';
      ctx.font = 'bold 11px Sora, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.beginPath(); ctx.arc(cx + dist, cy, 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillText(label, cx + dist, cy + 16);
    };

    markX(-fPx, 'F');
    markX(fPx, "F'");
    markX(-fPx * 2, '2F');
    markX(fPx * 2, "2F'");
    markX(0, 'O');

    // Object (arrow on the left)
    const objX = cx - objectDist * scale;
    const objH = 60;
    ctx.strokeStyle = '#E8581C';
    ctx.fillStyle = '#E8581C';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(objX, cy); ctx.lineTo(objX, cy - objH); ctx.stroke();
    // Arrowhead
    ctx.beginPath();
    ctx.moveTo(objX - 7, cy - objH + 10);
    ctx.lineTo(objX, cy - objH);
    ctx.lineTo(objX + 7, cy - objH + 10);
    ctx.fill();
    ctx.font = '12px Sora, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Object', objX, cy + 24);

    // Compute image
    const imgInfo = computeImage(objectDist, focalLength, optType);
    const v = imgInfo.v;
    const m = imgInfo.magnification;

    if (Math.abs(v) < 500 && isFinite(v)) {
      const imgH = objH * Math.abs(m);
      const clampedImgH = Math.min(imgH, 160);
      let imgX: number;

      if (isLens) {
        imgX = cx + v * scale;
      } else {
        imgX = cx + v * scale;
      }

      const isVirtual = imgInfo.nature === 'Virtual';
      const isInverted = m < 0;
      const imgTop = isInverted ? cy + clampedImgH : cy - clampedImgH;

      // Draw rays
      const objTipX = objX;
      const objTipY = cy - objH;

      // Ray 1: Parallel to axis -> through F' (or appear from F for concave)
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(objTipX, objTipY);
      if (isLens) {
        ctx.lineTo(cx, objTipY); // parallel to lens
        if (isConvex) {
          ctx.stroke();
          ctx.beginPath(); ctx.moveTo(cx, objTipY);
          ctx.lineTo(imgX, imgTop); // through F'
          ctx.stroke();
          // Extend beyond
          const ext = 40;
          const dx = imgX - cx; const dy = imgTop - objTipY;
          ctx.setLineDash([4, 4]);
          ctx.beginPath(); ctx.moveTo(imgX, imgTop);
          ctx.lineTo(imgX + dx / Math.abs(dx) * ext, imgTop + dy / Math.abs(dx || 1) * ext);
          ctx.stroke(); ctx.setLineDash([]);
        } else {
          ctx.stroke();
          // Concave lens: diverge as if from F on same side
          ctx.beginPath(); ctx.moveTo(cx, objTipY);
          ctx.lineTo(cx + fPx * 3, objTipY + (objTipY - cy) * 2);
          ctx.stroke();
          // Virtual ray
          ctx.setLineDash([4, 4]);
          ctx.beginPath(); ctx.moveTo(cx, objTipY);
          ctx.lineTo(cx - fPx, cy); ctx.stroke();
          ctx.setLineDash([]);
        }
      } else {
        ctx.lineTo(cx, objTipY);
        ctx.stroke();
        if (!isConvex) {
          ctx.beginPath(); ctx.moveTo(cx, objTipY);
          ctx.lineTo(imgX, imgTop); ctx.stroke();
        } else {
          ctx.beginPath(); ctx.moveTo(cx, objTipY);
          ctx.lineTo(cx - fPx * 3, objTipY + (objTipY - cy)); ctx.stroke();
        }
      }

      // Ray 2: Through center -> straight
      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(objTipX, objTipY);
      if (isLens) {
        // Goes straight through center
        const slope = (objTipY - cy) / (objTipX - cx);
        const extX = imgX + 40;
        ctx.lineTo(extX, cy + slope * (extX - cx));
        ctx.stroke();
      } else {
        // For mirror: ray toward center of curvature (2F), reflects back
        ctx.lineTo(cx, cy - objH * (cx - objTipX) / (cx - objTipX)); // simplified
        ctx.stroke();
      }

      // Ray 3: Through F -> parallel after refraction
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 2;
      if (isLens && isConvex) {
        const fPointX = cx - fPx;
        const slope = (objTipY - cy) / (objTipX - fPointX);
        const yAtLens = cy + slope * (cx - fPointX);
        ctx.beginPath();
        ctx.moveTo(objTipX, objTipY);
        ctx.lineTo(cx, yAtLens);
        ctx.stroke();
        // After lens: parallel
        ctx.beginPath();
        ctx.moveTo(cx, yAtLens);
        ctx.lineTo(cx + fPx * 3, yAtLens);
        ctx.stroke();
      }

      // Draw image arrow
      ctx.strokeStyle = isVirtual ? '#8b5cf6' : '#dc2626';
      ctx.fillStyle = isVirtual ? '#8b5cf6' : '#dc2626';
      ctx.lineWidth = 3;
      if (isVirtual) ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(imgX, cy);
      ctx.lineTo(imgX, imgTop);
      ctx.stroke();
      ctx.setLineDash([]);
      // Arrowhead
      const arrowDir = isInverted ? 1 : -1;
      ctx.beginPath();
      ctx.moveTo(imgX - 7, imgTop - arrowDir * 10);
      ctx.lineTo(imgX, imgTop);
      ctx.lineTo(imgX + 7, imgTop - arrowDir * 10);
      ctx.fill();

      ctx.font = '11px Sora, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(isVirtual ? 'Virtual Image' : 'Real Image', imgX, isInverted ? imgTop + 20 : imgTop - 8);
    }

    // "Drag the object" hint
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Drag the object arrow or use the slider below', 10, canvasHeight - 10);
  }, [canvasWidth, canvasHeight, cx, cy, scale, optType, focalLength, objectDist]);

  useEffect(() => { draw(); }, [draw]);

  // Mouse/touch handling for dragging the object
  const getPointerX = (e: React.MouseEvent | React.TouchEvent): number => {
    const canvas = canvasRef.current;
    if (!canvas) return 0;
    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    return clientX - rect.left;
  };

  const handlePointerDown = (e: React.MouseEvent | React.TouchEvent) => {
    const px = getPointerX(e);
    const objX = cx - objectDist * scale;
    if (Math.abs(px - objX) < 30) {
      setIsDragging(true);
      e.preventDefault();
    }
  };

  const handlePointerMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDragging) return;
    e.preventDefault();
    const px = getPointerX(e);
    const newDist = (cx - px) / scale;
    setObjectDist(Math.max(2, Math.min(35, newDist)));
  };

  const handlePointerUp = () => setIsDragging(false);

  const imgInfo = computeImage(objectDist, focalLength, optType);

  const opticTypes: { value: OpticsType; label: string }[] = [
    { value: 'convex-lens', label: 'Convex Lens' },
    { value: 'concave-lens', label: 'Concave Lens' },
    { value: 'concave-mirror', label: 'Concave Mirror' },
    { value: 'convex-mirror', label: 'Convex Mirror' },
  ];

  return (
    <div style={{ padding: '16px', fontFamily: 'Sora, system-ui, sans-serif' }} ref={containerRef}>
      {/* Type selector */}
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '14px' }}>
        {opticTypes.map(t => (
          <button
            key={t.value}
            onClick={() => setOptType(t.value)}
            aria-label={`Select ${t.label} optical element`}
            style={{
              padding: '7px 14px', borderRadius: '10px', border: '1.5px solid',
              borderColor: optType === t.value ? '#6366F1' : '#e0e0e0',
              background: optType === t.value ? '#6366F1' : '#fff',
              color: optType === t.value ? '#fff' : '#555',
              fontSize: '12px', fontWeight: 600, cursor: 'pointer',
              transition: 'all 0.2s',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Canvas */}
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="Lens ray diagram showing object, image formation, and light ray paths through a lens"
        width={canvasWidth}
        height={canvasHeight}
        style={{
          width: '100%', height: 'auto', borderRadius: '12px',
          border: '1px solid rgba(99,102,241,0.15)', cursor: isDragging ? 'grabbing' : 'grab',
          touchAction: 'none',
        }}
        onMouseDown={handlePointerDown}
        onMouseMove={handlePointerMove}
        onMouseUp={handlePointerUp}
        onMouseLeave={handlePointerUp}
        onTouchStart={handlePointerDown}
        onTouchMove={handlePointerMove}
        onTouchEnd={handlePointerUp}
      />

      {/* Controls */}
      <div style={{ marginTop: '16px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
        <div>
          <label style={{ fontSize: '12px', fontWeight: 600, color: '#555', display: 'block', marginBottom: '6px' }}>
            Object Distance (u): {objectDist.toFixed(1)} cm
          </label>
          <input
            type="range" min="2" max="35" step="0.5"
            value={objectDist}
            onChange={e => setObjectDist(parseFloat(e.target.value))}
            aria-label={`Object distance slider, ${objectDist.toFixed(1)} centimetres, range 2 to 35`}
            style={{ width: '100%', accentColor: '#E8581C' }}
          />
        </div>
        <div>
          <label style={{ fontSize: '12px', fontWeight: 600, color: '#555', display: 'block', marginBottom: '6px' }}>
            Focal Length (f): {focalLength} cm
          </label>
          <input
            type="range" min="5" max="20" step="1"
            value={focalLength}
            onChange={e => setFocalLength(parseInt(e.target.value))}
            aria-label={`Focal length slider, ${focalLength} centimetres, range 5 to 20`}
            style={{ width: '100%', accentColor: '#6366F1' }}
          />
        </div>
      </div>

      {/* Image properties */}
      <div style={{
        marginTop: '16px', background: '#f8f7ff', borderRadius: '12px', padding: '14px',
        border: '1px solid rgba(99,102,241,0.1)',
      }}>
        <div style={{ fontSize: '13px', fontWeight: 700, color: '#1a1a1a', marginBottom: '10px' }}>
          Image Properties
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '8px' }}>
          <div style={{ background: '#fff', borderRadius: '8px', padding: '8px 10px', textAlign: 'center' }}>
            <div style={{ fontSize: '10px', color: '#888', fontWeight: 600, textTransform: 'uppercase' }}>Distance (v)</div>
            <div style={{ fontSize: '15px', fontWeight: 700, color: '#1a1a1a', marginTop: '2px' }}>
              {isFinite(imgInfo.v) ? `${imgInfo.v.toFixed(1)} cm` : '∞'}
            </div>
          </div>
          <div style={{ background: '#fff', borderRadius: '8px', padding: '8px 10px', textAlign: 'center' }}>
            <div style={{ fontSize: '10px', color: '#888', fontWeight: 600, textTransform: 'uppercase' }}>Nature</div>
            <div style={{ fontSize: '15px', fontWeight: 700, color: imgInfo.nature === 'Real' ? '#dc2626' : '#8b5cf6', marginTop: '2px' }}>
              {imgInfo.nature}
            </div>
          </div>
          <div style={{ background: '#fff', borderRadius: '8px', padding: '8px 10px', textAlign: 'center' }}>
            <div style={{ fontSize: '10px', color: '#888', fontWeight: 600, textTransform: 'uppercase' }}>Orientation</div>
            <div style={{ fontSize: '15px', fontWeight: 700, color: '#1a1a1a', marginTop: '2px' }}>
              {imgInfo.orientation}
            </div>
          </div>
          <div style={{ background: '#fff', borderRadius: '8px', padding: '8px 10px', textAlign: 'center' }}>
            <div style={{ fontSize: '10px', color: '#888', fontWeight: 600, textTransform: 'uppercase' }}>Size</div>
            <div style={{ fontSize: '15px', fontWeight: 700, color: '#1a1a1a', marginTop: '2px' }}>
              {imgInfo.size}
            </div>
          </div>
          <div style={{ background: '#fff', borderRadius: '8px', padding: '8px 10px', textAlign: 'center' }}>
            <div style={{ fontSize: '10px', color: '#888', fontWeight: 600, textTransform: 'uppercase' }}>Magnification</div>
            <div style={{ fontSize: '15px', fontWeight: 700, color: '#1a1a1a', marginTop: '2px' }}>
              {isFinite(imgInfo.magnification) ? imgInfo.magnification.toFixed(2) + '×' : '∞'}
            </div>
          </div>
        </div>

        {/* Formula */}
        <div style={{
          marginTop: '12px', padding: '10px', background: '#fff',
          borderRadius: '8px', textAlign: 'center', fontSize: '13px', color: '#555',
        }}>
          <span style={{ fontWeight: 700 }}>Lens Formula: </span>
          1/v − 1/u = 1/f &nbsp;→&nbsp;
          1/{isFinite(imgInfo.v) ? imgInfo.v.toFixed(1) : '∞'} − 1/(-{objectDist.toFixed(1)}) = 1/{focalLength}
        </div>
      </div>

      {/* Ray legend */}
      <div style={{ marginTop: '12px', display: 'flex', gap: '16px', flexWrap: 'wrap', fontSize: '11px', color: '#666' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <div style={{ width: 20, height: 3, background: '#ef4444', borderRadius: 2 }} /> Parallel ray
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <div style={{ width: 20, height: 3, background: '#22c55e', borderRadius: 2 }} /> Central ray
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <div style={{ width: 20, height: 3, background: '#3b82f6', borderRadius: 2 }} /> Focal ray
        </div>
      </div>

      {/* Reset */}
      <button
        onClick={() => { setObjectDist(30); setFocalLength(12); setOptType('convex-lens'); }}
        aria-label="Reset simulation to default values"
        style={{
          marginTop: '14px', padding: '8px 20px', borderRadius: '10px',
          border: '1.5px solid #e0e0e0', background: '#fff', fontSize: '12px',
          fontWeight: 600, cursor: 'pointer', color: '#555',
        }}
      >
        Reset
      </button>
    </div>
  );
}
