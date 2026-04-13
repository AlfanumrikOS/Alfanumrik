'use client';
import { useState, useEffect } from 'react';
import { useResponsiveCanvas } from '@/hooks/useResponsiveCanvas';

export default function ShadowFormation() {
  const [srcHeight, setSrcHeight] = useState(150);
  const [dualSrc, setDualSrc] = useState(false);
  const { canvasRef, containerRef, size } = useResponsiveCanvas(2);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const w = size.width, h = size.height;

    const OBJ_X = w * 0.5, OBJ_R = Math.min(24, w * 0.04);
    const SCREEN_X = w * 0.9;
    const OBJ_Y = h * 0.86;
    ctx.clearRect(0, 0, w, h);

    // Background
    ctx.fillStyle = '#0f172a'; ctx.fillRect(0, 0, w, h);

    const srcX = 60;
    const srcY = h - srcHeight;

    // Shadow calculation
    // Line from srcY through top of object to screen: slope = (OBJ_Y - OBJ_R - srcY) / (OBJ_X - srcX)
    const slopeTop = (OBJ_Y - OBJ_R - srcY) / (OBJ_X - srcX);
    const shadowTop = srcY + slopeTop * (SCREEN_X - srcX);
    const slopeBot = (OBJ_Y + OBJ_R - srcY) / (OBJ_X - srcX);
    const shadowBot = srcY + slopeBot * (SCREEN_X - srcX);
    const shadowH = Math.abs(shadowBot - shadowTop);

    // Umbra (darkest shadow cone)
    ctx.beginPath();
    ctx.moveTo(srcX, srcY);
    ctx.lineTo(SCREEN_X, shadowTop);
    ctx.lineTo(SCREEN_X, shadowBot);
    ctx.closePath();
    ctx.fillStyle = 'rgba(0,0,0,0.8)'; ctx.fill();

    // Penumbra (if dual source)
    if (dualSrc) {
      const src2Y = srcY - 30;
      const sT2 = (OBJ_Y - OBJ_R - src2Y) / (OBJ_X - srcX);
      const sB2 = (OBJ_Y + OBJ_R - src2Y) / (OBJ_X - srcX);
      const shT2 = src2Y + sT2 * (SCREEN_X - srcX);
      const shB2 = src2Y + sB2 * (SCREEN_X - srcX);
      // penumbra above umbra
      ctx.beginPath();
      ctx.moveTo(srcX, src2Y);
      ctx.lineTo(SCREEN_X, Math.min(shadowTop, shT2) - 10);
      ctx.lineTo(SCREEN_X, shadowTop);
      ctx.closePath();
      ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fill();
      // penumbra below umbra
      ctx.beginPath();
      ctx.moveTo(srcX, src2Y);
      ctx.lineTo(SCREEN_X, shadowBot);
      ctx.lineTo(SCREEN_X, Math.max(shadowBot, shB2) + 10);
      ctx.closePath();
      ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fill();
      // second source
      ctx.beginPath(); ctx.arc(srcX, src2Y, 8, 0, Math.PI * 2);
      ctx.fillStyle = '#fcd34d88'; ctx.fill();
    }

    // Light rays (from source to object edges)
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = 'rgba(253,224,71,0.4)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(srcX, srcY); ctx.lineTo(SCREEN_X, shadowTop); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(srcX, srcY); ctx.lineTo(SCREEN_X, shadowBot); ctx.stroke();
    ctx.setLineDash([]);

    // Screen (wall on right)
    ctx.fillStyle = '#94a3b8'; ctx.fillRect(SCREEN_X, 20, 12, h - 40);
    ctx.fillStyle = '#1e293b'; ctx.fillRect(SCREEN_X + 2, shadowTop, 8, shadowH);

    // Object (opaque circle)
    ctx.beginPath(); ctx.arc(OBJ_X, OBJ_Y, OBJ_R, 0, Math.PI * 2);
    ctx.fillStyle = '#374151'; ctx.fill();
    ctx.strokeStyle = '#9ca3af'; ctx.lineWidth = 2; ctx.stroke();

    // Light source
    const srcGrad = ctx.createRadialGradient(srcX, srcY, 0, srcX, srcY, 18);
    srcGrad.addColorStop(0, '#fef08a'); srcGrad.addColorStop(1, 'rgba(251,191,36,0)');
    ctx.beginPath(); ctx.arc(srcX, srcY, 18, 0, Math.PI * 2);
    ctx.fillStyle = srcGrad; ctx.fill();
    ctx.beginPath(); ctx.arc(srcX, srcY, 10, 0, Math.PI * 2);
    ctx.fillStyle = '#fcd34d'; ctx.fill();

    // Labels
    ctx.fillStyle = '#94a3b8'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('Light', srcX, srcY - 22);
    ctx.fillText('Source', srcX, srcY - 10);
    ctx.fillText('Object', OBJ_X, OBJ_Y - OBJ_R - 8);
    ctx.fillText('Screen', SCREEN_X + 6, 16);
    if (shadowH > 10) {
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillText('Umbra', SCREEN_X - 20, (shadowTop + shadowBot) / 2 + 4);
    }
    if (dualSrc) {
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillText('Penumbra', SCREEN_X - 32, shadowTop - 14);
    }

    // Shadow height indicator
    ctx.strokeStyle = '#f97316'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(SCREEN_X + 18, shadowTop); ctx.lineTo(SCREEN_X + 18, shadowBot); ctx.stroke();
    ctx.fillStyle = 'var(--orange)'; ctx.font = 'bold 11px sans-serif';
    ctx.fillText(`${shadowH.toFixed(0)}px`, SCREEN_X + 36, (shadowTop + shadowBot) / 2 + 4);
  }, [srcHeight, dualSrc, size, canvasRef]);

  // Use reference dimensions for display formula
  const refW = size.width;
  const refObjX = refW * 0.5, refObjR = Math.min(24, refW * 0.04), refScreenX = refW * 0.9;
  const shadowSize = ((refObjR * 2 * (refScreenX - refObjX)) / (refObjX - 60)).toFixed(1);

  return (
    <div style={{ background: 'var(--surface-1)', borderRadius: 12, padding: 16, maxWidth: 600, margin: '0 auto', fontFamily: 'inherit' }}>
      <h3 style={{ color: 'var(--text-1)', fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Shadow Formation</h3>
      <div ref={containerRef} className="w-full" style={{ aspectRatio: '2/1' }}>
        <canvas ref={canvasRef} className="rounded-lg" style={{ background: '#0f172a', display: 'block' }} />
      </div>
      <div style={{ marginTop: 10 }}>
        <label style={{ color: 'var(--text-2)', fontSize: 13 }}>Light Source Height: {srcHeight} px</label>
        <input type="range" min={50} max={250} value={srcHeight} onChange={e => setSrcHeight(+e.target.value)} style={{ width: '100%' }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-2)', fontSize: 13, marginTop: 6, cursor: 'pointer' }}>
          <input type="checkbox" checked={dualSrc} onChange={e => setDualSrc(e.target.checked)} />
          Show second source (reveals Penumbra)
        </label>
      </div>
      <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 8, fontSize: 13, color: 'var(--text-1)', textAlign: 'center' }}>
        Shadow size = Object × Screen dist / Source dist ≈ <b style={{ color: 'var(--orange)' }}>{shadowSize} px</b>
      </div>
    </div>
  );
}
