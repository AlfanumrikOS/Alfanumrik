'use client';
import { useState, useRef, useEffect, useCallback } from 'react';

const PLANETS = [
  { name: 'Mercury', r: 28,  size: 4,  color: '#9ca3af', speed: 4.15 },
  { name: 'Venus',   r: 50,  size: 6,  color: '#fcd34d', speed: 1.62 },
  { name: 'Earth',   r: 74,  size: 7,  color: '#3b82f6', speed: 1.0  },
  { name: 'Mars',    r: 96,  size: 5,  color: '#ef4444', speed: 0.53 },
  { name: 'Jupiter', r: 124, size: 12, color: '#f97316', speed: 0.084},
  { name: 'Saturn',  r: 150, size: 10, color: '#fbbf24', speed: 0.034},
  { name: 'Uranus',  r: 174, size: 8,  color: '#67e8f9', speed: 0.012},
  { name: 'Neptune', r: 194, size: 8,  color: '#818cf8', speed: 0.006},
];

export default function SolarSystem() {
  const [paused, setPaused] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const anglesRef = useRef<number[]>(PLANETS.map((_, i) => (i * Math.PI * 2) / PLANETS.length));
  const pausedRef = useRef(false);

  useEffect(() => { pausedRef.current = paused; }, [paused]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2;

    // Starfield (static seed)
    ctx.fillStyle = '#fff';
    for (let i = 0; i < 60; i++) {
      const sx = ((i * 137 + 23) % w);
      const sy = ((i * 83 + 11) % h);
      ctx.fillRect(sx, sy, 1, 1);
    }

    // Sun
    const sunGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 25);
    sunGrad.addColorStop(0, '#fff7aa'); sunGrad.addColorStop(1, '#f59e0b');
    ctx.beginPath(); ctx.arc(cx, cy, 25, 0, Math.PI * 2);
    ctx.fillStyle = sunGrad; ctx.fill();

    // Orbits + planets
    if (!pausedRef.current) {
      PLANETS.forEach((p, i) => { anglesRef.current[i] += p.speed * 0.01; });
    }

    PLANETS.forEach((p, i) => {
      // Orbit ring
      ctx.beginPath(); ctx.arc(cx, cy, p.r, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1; ctx.stroke();
      // Planet
      const px = cx + Math.cos(anglesRef.current[i]) * p.r;
      const py = cy + Math.sin(anglesRef.current[i]) * p.r;
      ctx.beginPath(); ctx.arc(px, py, p.size, 0, Math.PI * 2);
      ctx.fillStyle = p.name === selected ? '#fff' : p.color; ctx.fill();
      if (p.name === selected) {
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(px, py, p.size + 4, 0, Math.PI * 2); ctx.stroke();
      }
      // Saturn rings
      if (p.name === 'Saturn') {
        ctx.save(); ctx.translate(px, py); ctx.scale(1, 0.3);
        ctx.beginPath(); ctx.arc(0, 0, p.size + 6, 0, Math.PI * 2);
        ctx.strokeStyle = '#fbbf2488'; ctx.lineWidth = 3; ctx.stroke();
        ctx.restore();
      }
    });

    rafRef.current = requestAnimationFrame(draw);
  }, [selected]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [draw]);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current; if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const mx = (e.clientX - rect.left) * scaleX;
    const my = (e.clientY - rect.top) * scaleY;
    const cx = canvas.width / 2, cy = canvas.height / 2;
    let nearest = null, minD = 20;
    PLANETS.forEach((p, i) => {
      const px = cx + Math.cos(anglesRef.current[i]) * p.r;
      const py = cy + Math.sin(anglesRef.current[i]) * p.r;
      const d = Math.sqrt((mx - px) ** 2 + (my - py) ** 2);
      if (d < minD) { minD = d; nearest = p.name; }
    });
    setSelected(nearest);
  };

  const selPlanet = PLANETS.find(p => p.name === selected);

  return (
    <div style={{ background: 'var(--surface-1)', borderRadius: 12, padding: 16, maxWidth: 600, margin: '0 auto', fontFamily: 'inherit' }}>
      <h3 style={{ color: 'var(--text-1)', fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Solar System — Kepler's Third Law</h3>
      <canvas ref={canvasRef} width={560} height={320} onClick={handleClick}
        style={{ width: '100%', borderRadius: 8, background: '#0f172a', display: 'block', cursor: 'crosshair' }} />
      <div style={{ marginTop: 8, display: 'flex', gap: 10, alignItems: 'center' }}>
        <button onClick={() => setPaused(p => !p)} style={{ padding: '6px 16px', borderRadius: 6, border: 'none', cursor: 'pointer', background: 'var(--orange)', color: '#fff', fontWeight: 700 }}>
          {paused ? 'Play' : 'Pause'}
        </button>
        {selPlanet && (
          <span style={{ color: 'var(--text-1)', fontSize: 13 }}>
            Selected: <b style={{ color: selPlanet.color }}>{selPlanet.name}</b> — orbital radius: <b>{selPlanet.r} units</b>
          </span>
        )}
        {!selPlanet && <span style={{ color: 'var(--text-2)', fontSize: 12 }}>Click a planet to inspect</span>}
      </div>
      <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 8, fontSize: 13, color: 'var(--text-1)', textAlign: 'center' }}>
        T² ∝ r³ &nbsp;(Kepler's Third Law — orbital period² ∝ orbital radius³)
      </div>
    </div>
  );
}
