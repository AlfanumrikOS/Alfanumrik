'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { useResponsiveCanvas } from '@/hooks/useResponsiveCanvas';

const METALS = [
  { name: 'Na', phi: 2.3 },
  { name: 'Zn', phi: 4.3 },
  { name: 'Pt', phi: 5.6 },
] as const;

export default function PhotoelectricEffect() {
  const [freq, setFreq] = useState(8);
  const [intensity, setIntensity] = useState(5);
  const [metalIdx, setMetalIdx] = useState(0);
  const { canvasRef, containerRef, size } = useResponsiveCanvas(560 / 260);
  const rafRef = useRef<number>(0);
  const electronsRef = useRef<{ x: number; y: number; vx: number; vy: number; life: number }[]>([]);
  const tickRef = useRef(0);

  const h = 6.626e-34;
  const eV = 1.6e-19;
  const metal = METALS[metalIdx];
  const phi = metal.phi;
  const threshold = (phi * eV) / h / 1e14;
  const aboveThreshold = freq >= threshold;
  const KE = aboveThreshold ? +(h * freq * 1e14 / eV - phi).toFixed(3) : 0;

  const freqToColor = (f: number) => {
    const nm = 3e8 / (f * 1e14) * 1e9;
    if (nm > 700) return '#dc2626';
    if (nm > 590) return '#f97316';
    if (nm > 500) return '#facc15';
    if (nm > 450) return '#4ade80';
    if (nm > 400) return '#60a5fa';
    return '#a78bfa';
  };
  const photonColor = freqToColor(freq);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const W = size.width, H = size.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0a0a14';
    ctx.fillRect(0, 0, W, H);

    const metalY = H - 70;
    const metalX = 60;
    const metalW = W - 120;

    // Metal surface
    ctx.fillStyle = '#374151';
    ctx.fillRect(metalX, metalY, metalW, 50);
    ctx.fillStyle = '#6b7280';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${metal.name}  (φ = ${phi} eV)`, W / 2, metalY + 30);

    // Animate photons falling (wavy lines)
    tickRef.current++;
    const numPhotons = intensity;
    for (let i = 0; i < numPhotons; i++) {
      const px = metalX + 30 + i * (metalW - 60) / (numPhotons - 1 || 1);
      const offset = (tickRef.current * 2 + i * 20) % (metalY - 20);
      const startY = offset;
      ctx.strokeStyle = photonColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let y = startY; y < Math.min(startY + 40, metalY); y++) {
        const x = px + Math.sin((y + tickRef.current) * 0.4) * 4;
        y === startY ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Photon label
      if (offset < 20) {
        ctx.fillStyle = photonColor;
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`hf`, px, 14);
      }
    }

    // Electrons
    if (aboveThreshold && tickRef.current % Math.max(1, 6 - intensity) === 0) {
      const spawnX = metalX + 30 + Math.random() * (metalW - 60);
      electronsRef.current.push({ x: spawnX, y: metalY, vx: (Math.random() - 0.5) * 2, vy: -(2 + KE * 1.5), life: 0 });
    }
    electronsRef.current = electronsRef.current.filter(e => e.life < 80 && e.y > 0);
    electronsRef.current.forEach(e => {
      e.x += e.vx;
      e.y += e.vy;
      e.vy += 0.05;
      e.life++;
      ctx.beginPath();
      ctx.arc(e.x, e.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#fbbf24';
      ctx.fill();
    });

    // Status label
    if (!aboveThreshold) {
      ctx.fillStyle = '#ef4444';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Below threshold — no electrons emitted', W / 2, metalY - 15);
    } else {
      ctx.fillStyle = '#4ade80';
      ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`KE_max = ${KE} eV`, W / 2, metalY - 15);
    }

    // Threshold marker on freq axis (info only)
    ctx.fillStyle = '#9ca3af';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`f₀(threshold) = ${threshold.toFixed(2)} × 10¹⁴ Hz`, W / 2, H - 8);
  }, [freq, intensity, aboveThreshold, KE, metal, phi, photonColor, threshold, size, canvasRef]);

  useEffect(() => {
    const loop = () => {
      draw();
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(rafRef.current); electronsRef.current = []; };
  }, [draw]);

  return (
    <div style={{ background: 'var(--surface-1)', borderRadius: 12, padding: 16, maxWidth: 600, margin: '0 auto', fontFamily: 'inherit' }}>
      <h3 style={{ color: 'var(--text-1)', fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Photoelectric Effect</h3>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        {METALS.map((m, i) => (
          <button key={m.name} onClick={() => setMetalIdx(i)} style={{ padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, background: metalIdx === i ? 'var(--purple,#7c3aed)' : 'var(--surface-2)', color: metalIdx === i ? '#fff' : 'var(--text-2)' }}>{m.name} (φ={m.phi}eV)</button>
        ))}
      </div>
      <div ref={containerRef} className="w-full" style={{ aspectRatio: '560/260' }}>
        <canvas ref={canvasRef} className="rounded-lg" style={{ display: 'block' }} />
      </div>
      <div style={{ marginTop: 10, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 140 }}>
          <label style={{ color: 'var(--text-2)', fontSize: 13 }}>Frequency: {freq} × 10¹⁴ Hz <span style={{ display: 'inline-block', width: 12, height: 12, background: photonColor, borderRadius: 2, verticalAlign: 'middle' }} /></label>
          <input type="range" min={4} max={16} step={0.5} value={freq} onChange={e => setFreq(+e.target.value)} style={{ width: '100%' }} />
        </div>
        <div style={{ flex: 1 }}>
          <label style={{ color: 'var(--text-2)', fontSize: 13 }}>Intensity: {intensity}</label>
          <input type="range" min={1} max={10} value={intensity} onChange={e => setIntensity(+e.target.value)} style={{ width: '100%' }} />
        </div>
      </div>
      <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 8, fontSize: 13, color: 'var(--text-1)', textAlign: 'center' }}>
        KE_max = hf − φ = <b style={{ color: 'var(--orange,#f97316)' }}>{aboveThreshold ? `${KE} eV` : '0 (below threshold)'}</b> &nbsp;|&nbsp; h = 6.63×10⁻³⁴ J·s
      </div>
    </div>
  );
}
