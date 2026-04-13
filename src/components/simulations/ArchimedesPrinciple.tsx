'use client';
import { useState, useEffect } from 'react';
import { useResponsiveCanvas } from '@/hooks/useResponsiveCanvas';

export default function ArchimedesPrinciple() {
  const [density, setDensity] = useState(2000);
  const [volume, setVolume] = useState(200);
  const [depth, setDepth] = useState(50);
  const { canvasRef, containerRef, size } = useResponsiveCanvas(500 / 300);

  const g = 10;
  const rhoWater = 1000;
  const weightAir = density * (volume / 1e6) * g;
  const maxBuoy = rhoWater * (volume / 1e6) * g;
  const subFrac = Math.min(depth / 100, 1);
  const buoyForce = maxBuoy * subFrac;
  const apparentWeight = Math.max(0, weightAir - buoyForce);
  const floats = density < rhoWater;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const W = size.width, H = size.height;
    ctx.clearRect(0, 0, W, H);

    ctx.fillStyle = '#111827';
    ctx.fillRect(0, 0, W, H);

    // Water tank (scaled to canvas)
    const sx = W / 500, sy = H / 300;
    const tankX = 40 * sx, tankY = 80 * sy, tankW = 200 * sx, tankH = 200 * sy;
    ctx.strokeStyle = '#60a5fa';
    ctx.lineWidth = 2;
    ctx.strokeRect(tankX, tankY, tankW, tankH);

    // Water fill
    ctx.fillStyle = 'rgba(96,165,250,0.25)';
    ctx.fillRect(tankX + 1, tankY + 1, tankW - 2, tankH - 2);

    // Object in tank
    const objSize = Math.max(20, Math.min(50, Math.cbrt(volume) * 2.5));
    const objX = tankX + tankW / 2 - objSize / 2;
    const floatLevel = floats ? tankY + tankH - objSize * (density / rhoWater) - 5 : tankY + 20;
    const submergeY = floats ? floatLevel : tankY + 10 + depth * 1.6;
    const clampedY = Math.min(submergeY, tankY + tankH - objSize - 5);
    ctx.fillStyle = floats ? '#fbbf24' : '#9ca3af';
    ctx.fillRect(objX, clampedY, objSize, objSize);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.strokeRect(objX, clampedY, objSize, objSize);

    // Displaced water indicator
    if (!floats) {
      ctx.fillStyle = 'rgba(96,165,250,0.5)';
      ctx.font = '11px sans-serif';
      ctx.fillText('displaced', tankX + 5, tankY + tankH - 5);
    }

    // Spring scale on right
    const scaleX = 320 * sx, scaleTopY = 40 * sy, scaleH = 200 * sy;
    ctx.strokeStyle = '#6b7280';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(scaleX, scaleTopY);
    ctx.lineTo(scaleX, scaleTopY + scaleH);
    ctx.stroke();

    // Scale body
    ctx.fillStyle = '#374151';
    ctx.fillRect(scaleX - 25, scaleTopY, 50, 60);
    ctx.strokeStyle = '#9ca3af';
    ctx.strokeRect(scaleX - 25, scaleTopY, 50, 60);

    // Scale needle (indicates apparent weight)
    const maxDisplayW = weightAir;
    const needleAngle = maxDisplayW > 0 ? (apparentWeight / maxDisplayW) * Math.PI * 0.8 - Math.PI * 0.4 : -Math.PI * 0.4;
    const nx = scaleX, ny = scaleTopY + 30;
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(nx, ny);
    ctx.lineTo(nx + Math.cos(needleAngle) * 18, ny + Math.sin(needleAngle) * 18);
    ctx.stroke();

    // String from scale to object
    ctx.strokeStyle = '#d1d5db';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 2]);
    ctx.beginPath();
    ctx.moveTo(scaleX, scaleTopY + 60);
    ctx.lineTo(objX + objSize / 2, clampedY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Force arrows
    const arrowBase = objX + objSize / 2;
    // Weight arrow (down)
    const wLen = Math.min(60, weightAir * 6);
    ctx.strokeStyle = '#f97316';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(arrowBase, clampedY + objSize);
    ctx.lineTo(arrowBase, clampedY + objSize + wLen);
    ctx.stroke();

    // Buoyancy arrow (up)
    const bLen = Math.min(60, buoyForce * 6);
    ctx.strokeStyle = '#60a5fa';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(arrowBase - 12, clampedY + objSize);
    ctx.lineTo(arrowBase - 12, clampedY + objSize - bLen);
    ctx.stroke();

    // Labels
    ctx.font = '12px sans-serif';
    ctx.fillStyle = '#9ca3af';
    ctx.textAlign = 'center';
    ctx.fillText('Spring Scale', scaleX, scaleTopY - 8);
    ctx.fillStyle = '#f97316';
    ctx.fillText(`W=${weightAir.toFixed(2)}N`, arrowBase + 30, clampedY + objSize + wLen / 2);
    ctx.fillStyle = '#60a5fa';
    ctx.fillText(`Fb=${buoyForce.toFixed(2)}N`, arrowBase - 45, clampedY + objSize - bLen / 2);
    ctx.fillStyle = '#10b981';
    ctx.fillText(`App.W=${apparentWeight.toFixed(2)}N`, scaleX, scaleTopY + 75);

    if (floats) {
      ctx.fillStyle = '#fbbf24';
      ctx.fillText('Object FLOATS', tankX + tankW / 2, tankY - 10);
    }
  }, [density, volume, depth, weightAir, maxBuoy, subFrac, buoyForce, apparentWeight, floats, size, canvasRef]);

  return (
    <div style={{ background: 'var(--surface-1)', borderRadius: 12, padding: 16, maxWidth: 600, margin: '0 auto', fontFamily: 'inherit' }}>
      <h3 style={{ color: 'var(--text-1)', fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Archimedes' Principle</h3>
      <div ref={containerRef} className="w-full" style={{ aspectRatio: '500/300' }}>
        <canvas ref={canvasRef} className="rounded-lg" style={{ display: 'block' }} />
      </div>
      <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 }}>
        <div>
          <label style={{ color: 'var(--text-2)', fontSize: 13 }}>ρ_obj: {density} kg/m³</label>
          <input type="range" min={500} max={5000} step={100} value={density} onChange={e => setDensity(+e.target.value)} style={{ width: '100%' }} />
        </div>
        <div>
          <label style={{ color: 'var(--text-2)', fontSize: 13 }}>V: {volume} cm³</label>
          <input type="range" min={50} max={500} step={10} value={volume} onChange={e => setVolume(+e.target.value)} style={{ width: '100%' }} />
        </div>
        <div>
          <label style={{ color: 'var(--text-2)', fontSize: 13 }}>Depth: {depth}%</label>
          <input type="range" min={0} max={100} value={depth} onChange={e => setDepth(+e.target.value)} style={{ width: '100%' }} disabled={floats} />
        </div>
      </div>
      <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 8, fontSize: 13, color: 'var(--text-1)', textAlign: 'center' }}>
        F_b = ρ_liq × V × g = <b style={{ color: 'var(--orange,#f97316)' }}>{buoyForce.toFixed(3)} N</b> &nbsp;|&nbsp; App. W = <b style={{ color: 'var(--purple,#7c3aed)' }}>{apparentWeight.toFixed(3)} N</b>
      </div>
    </div>
  );
}
