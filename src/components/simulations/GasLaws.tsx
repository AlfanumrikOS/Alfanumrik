'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

/**
 * Gas Laws Lab — Interactive PV = nRT Simulation
 *
 * CBSE Class 11, Chapter 5: States of Matter
 * Board Exam Relevance: HIGH
 *
 * Demonstrates:
 * - Boyle's Law: P ∝ 1/V (at constant T)
 * - Charles's Law: V ∝ T (at constant P)
 * - Combined: PV = nRT
 *
 * Students manipulate pressure, volume, and temperature
 * and see gas particles respond in real-time.
 */

const R = 8.314; // J/(mol·K)
const PARTICLE_COUNT = 60;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

function createParticles(count: number, width: number, height: number, speed: number): Particle[] {
  return Array.from({ length: count }, () => ({
    x: Math.random() * width,
    y: Math.random() * height,
    vx: (Math.random() - 0.5) * speed,
    vy: (Math.random() - 0.5) * speed,
  }));
}

export default function GasLaws() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number>(0);
  const particlesRef = useRef<Particle[]>([]);

  const [temperature, setTemperature] = useState(300); // Kelvin
  const [volume, setVolume] = useState(50); // arbitrary units (maps to container width %)
  const [moles, setMoles] = useState(1);
  const [mode, setMode] = useState<'boyle' | 'charles' | 'free'>('boyle');
  const [canvasWidth, setCanvasWidth] = useState(500);

  // Derived: P = nRT/V
  const pressure = (moles * R * temperature) / volume;
  // Particle speed proportional to √T
  const particleSpeed = Math.sqrt(temperature / 300) * 3;
  // Container width proportional to volume
  const containerFraction = Math.max(0.3, Math.min(0.95, volume / 100));

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(entries => {
      for (const e of entries) setCanvasWidth(e.contentRect.width);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Initialize particles
  useEffect(() => {
    const w = canvasWidth * containerFraction;
    const h = 250;
    particlesRef.current = createParticles(PARTICLE_COUNT, w - 20, h - 20, particleSpeed);
  }, [canvasWidth, containerFraction, particleSpeed]);

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
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, w, h);

    // Container (piston visualization)
    const containerW = w * containerFraction;
    const containerH = h - 40;
    const containerX = 10;
    const containerY = 20;

    // Container walls
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(containerX, containerY);
    ctx.lineTo(containerX, containerY + containerH);
    ctx.lineTo(containerX + containerW, containerY + containerH);
    ctx.lineTo(containerX + containerW, containerY);
    ctx.stroke();

    // Top wall (fixed)
    ctx.beginPath();
    ctx.moveTo(containerX, containerY);
    ctx.lineTo(containerX + containerW, containerY);
    ctx.stroke();

    // Piston (right wall — movable)
    const pistonX = containerX + containerW;
    ctx.fillStyle = '#64748B';
    ctx.fillRect(pistonX - 4, containerY, 8, containerH);

    // Piston handle
    ctx.fillStyle = '#94A3B8';
    ctx.fillRect(pistonX + 4, containerY + containerH / 2 - 15, 20, 30);
    ctx.fillStyle = '#475569';
    ctx.font = '10px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('◀▶', pistonX + 14, containerY + containerH / 2 + 4);

    // Temperature color (blue=cold, red=hot)
    const tempFrac = Math.min(1, Math.max(0, (temperature - 200) / 400));
    const bgR = Math.round(30 + tempFrac * 200);
    const bgB = Math.round(200 - tempFrac * 150);
    ctx.fillStyle = `rgba(${bgR}, 50, ${bgB}, 0.06)`;
    ctx.fillRect(containerX + 2, containerY + 2, containerW - 4, containerH - 4);

    // Particles
    const particles = particlesRef.current;
    for (const p of particles) {
      // Update position
      p.x += p.vx;
      p.y += p.vy;

      // Bounce off walls
      const maxX = containerW - 16;
      const maxY = containerH - 16;
      if (p.x < 4) { p.x = 4; p.vx = Math.abs(p.vx); }
      if (p.x > maxX) { p.x = maxX; p.vx = -Math.abs(p.vx); }
      if (p.y < 4) { p.y = 4; p.vy = Math.abs(p.vy); }
      if (p.y > maxY) { p.y = maxY; p.vy = -Math.abs(p.vy); }

      // Adjust speed based on temperature
      const currentSpeed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
      if (currentSpeed > 0.01) {
        const targetSpeed = particleSpeed;
        const factor = 0.98 + 0.02 * (targetSpeed / currentSpeed);
        p.vx *= factor;
        p.vy *= factor;
      }

      // Draw particle
      const alpha = Math.min(1, 0.5 + tempFrac * 0.5);
      ctx.beginPath();
      ctx.arc(containerX + p.x + 8, containerY + p.y + 8, 3, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${bgR + 50}, 80, ${bgB + 30}, ${alpha})`;
      ctx.fill();
    }

    // Pressure gauge (right side)
    const gaugeX = containerX + containerW + 40;
    const gaugeW = 30;
    const gaugeH = containerH - 20;
    const gaugeY = containerY + 10;
    const pressureFrac = Math.min(1, pressure / 200000);

    ctx.fillStyle = '#f1f5f9';
    ctx.fillRect(gaugeX, gaugeY, gaugeW, gaugeH);
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1;
    ctx.strokeRect(gaugeX, gaugeY, gaugeW, gaugeH);

    // Pressure fill
    const fillH = gaugeH * pressureFrac;
    const pressColor = pressureFrac > 0.7 ? '#ef4444' : pressureFrac > 0.4 ? '#f59e0b' : '#22c55e';
    ctx.fillStyle = pressColor;
    ctx.fillRect(gaugeX + 2, gaugeY + gaugeH - fillH, gaugeW - 4, fillH);

    // Pressure label
    ctx.fillStyle = '#334155';
    ctx.font = 'bold 11px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('P', gaugeX + gaugeW / 2, gaugeY - 4);
    ctx.font = '10px system-ui';
    ctx.fillText(`${(pressure / 1000).toFixed(1)}`, gaugeX + gaugeW / 2, gaugeY + gaugeH + 14);
    ctx.fillText('kPa', gaugeX + gaugeW / 2, gaugeY + gaugeH + 26);

    animRef.current = requestAnimationFrame(draw);
  }, [canvasWidth, containerFraction, particleSpeed, pressure, temperature]);

  useEffect(() => {
    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, [draw]);

  return (
    <div ref={containerRef} style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", maxWidth: 600, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#6366F1' }}>🧪 Gas Laws Lab</div>
        <div style={{ fontSize: 11, color: '#64748B' }}>PV = nRT — Boyle&apos;s &amp; Charles&apos;s Law</div>
      </div>

      {/* Mode selector */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 12, justifyContent: 'center' }}>
        {([
          { id: 'boyle' as const, label: "Boyle's Law", labelHi: 'बॉयल नियम', desc: 'P vs V (T constant)' },
          { id: 'charles' as const, label: "Charles's Law", labelHi: 'चार्ल्स नियम', desc: 'V vs T (P adjust)' },
          { id: 'free' as const, label: 'Free Explore', labelHi: 'खुला अन्वेषण', desc: 'Change anything' },
        ]).map(m => (
          <button key={m.id} onClick={() => setMode(m.id)} style={{ padding: '6px 12px', borderRadius: 6, border: `1px solid ${mode === m.id ? '#6366F1' : '#e2e8f0'}`, background: mode === m.id ? '#6366F1' : '#fff', color: mode === m.id ? '#fff' : '#64748B', fontSize: 11, cursor: 'pointer', fontWeight: mode === m.id ? 600 : 400 }}>
            {m.label}
          </button>
        ))}
      </div>

      {/* Canvas */}
      <canvas ref={canvasRef} style={{ width: '100%', height: 280, borderRadius: 8, border: '1px solid #e2e8f0' }} />

      {/* Controls */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
        {/* Temperature */}
        <div style={{ padding: '10px 12px', background: '#fef2f2', borderRadius: 8, border: '1px solid #fecaca' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#991b1b', marginBottom: 4 }}>🌡️ Temperature</div>
          <input type="range" min={200} max={600} step={10} value={temperature} onChange={e => setTemperature(Number(e.target.value))} disabled={mode === 'boyle'} style={{ width: '100%', accentColor: '#ef4444' }} />
          <div style={{ fontSize: 14, fontWeight: 700, color: '#1e293b', textAlign: 'center' }}>{temperature} K <span style={{ fontSize: 10, color: '#64748B' }}>({(temperature - 273).toFixed(0)}°C)</span></div>
        </div>

        {/* Volume */}
        <div style={{ padding: '10px 12px', background: '#eff6ff', borderRadius: 8, border: '1px solid #bfdbfe' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#1e40af', marginBottom: 4 }}>📦 Volume</div>
          <input type="range" min={20} max={100} step={5} value={volume} onChange={e => setVolume(Number(e.target.value))} disabled={mode === 'charles'} style={{ width: '100%', accentColor: '#3b82f6' }} />
          <div style={{ fontSize: 14, fontWeight: 700, color: '#1e293b', textAlign: 'center' }}>{volume} L</div>
        </div>

        {/* Moles */}
        <div style={{ padding: '10px 12px', background: '#f0fdf4', borderRadius: 8, border: '1px solid #bbf7d0' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#166534', marginBottom: 4 }}>⚛️ Moles (n)</div>
          <input type="range" min={0.5} max={3} step={0.5} value={moles} onChange={e => setMoles(Number(e.target.value))} style={{ width: '100%', accentColor: '#22c55e' }} />
          <div style={{ fontSize: 14, fontWeight: 700, color: '#1e293b', textAlign: 'center' }}>{moles} mol</div>
        </div>

        {/* Pressure (calculated) */}
        <div style={{ padding: '10px 12px', background: '#faf5ff', borderRadius: 8, border: '1px solid #e9d5ff' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#6b21a8', marginBottom: 4 }}>⬆️ Pressure (P)</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: pressure > 150000 ? '#ef4444' : '#1e293b', textAlign: 'center', marginTop: 8 }}>
            {(pressure / 1000).toFixed(1)} <span style={{ fontSize: 11, fontWeight: 400, color: '#64748B' }}>kPa</span>
          </div>
          <div style={{ fontSize: 10, color: '#64748B', textAlign: 'center' }}>
            {(pressure / 101325).toFixed(2)} atm
          </div>
        </div>
      </div>

      {/* Formula display */}
      <div style={{ marginTop: 12, padding: '8px 12px', background: '#f1f5f9', borderRadius: 8, textAlign: 'center' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#334155' }}>
          PV = nRT → {(pressure / 1000).toFixed(1)} × {volume} = {moles} × 8.314 × {temperature}
        </span>
        <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>
          {mode === 'boyle' ? "Boyle's Law: as V ↓, P ↑ (T constant)" :
           mode === 'charles' ? "Charles's Law: as T ↑, V ↑ (P adjusts)" :
           'Ideal Gas Law: PV = nRT'}
        </div>
      </div>
    </div>
  );
}
