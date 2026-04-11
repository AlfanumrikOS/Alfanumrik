'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

export const metadata = {
  id: 'states-of-matter',
  name: 'States of Matter',
  subject: 'Chemistry',
  grade: '9-10',
  description: 'See how temperature affects particle motion in solids, liquids, and gases',
};

const N_PARTICLES = 60;
const MELT_TEMP = 300;
const BOIL_TEMP = 400;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  homeX: number;
  homeY: number;
  r: number;
  hue: number;
}

function getState(temp: number): 'Solid' | 'Liquid' | 'Gas' | 'Supercritical' {
  if (temp < MELT_TEMP) return 'Solid';
  if (temp < BOIL_TEMP) return 'Liquid';
  if (temp < 550) return 'Gas';
  return 'Supercritical';
}

function getStateColor(state: string): string {
  switch (state) {
    case 'Solid': return '#7c3aed';
    case 'Liquid': return '#0ea5e9';
    case 'Gas': return '#F97316';
    case 'Supercritical': return '#ef4444';
    default: return '#64748b';
  }
}

function initParticles(W: number, H: number): Particle[] {
  const cols = Math.ceil(Math.sqrt(N_PARTICLES));
  const rows = Math.ceil(N_PARTICLES / cols);
  const padX = 20;
  const padY = 20;
  const spacingX = (W - padX * 2) / (cols - 1 || 1);
  const spacingY = (H - padY * 2) / (rows - 1 || 1);

  return Array.from({ length: N_PARTICLES }, (_, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const hx = padX + col * spacingX;
    const hy = padY + row * spacingY;
    return {
      x: hx + (Math.random() - 0.5) * 4,
      y: hy + (Math.random() - 0.5) * 4,
      vx: (Math.random() - 0.5) * 0.5,
      vy: (Math.random() - 0.5) * 0.5,
      homeX: hx,
      homeY: hy,
      r: 5 + Math.random() * 2,
      hue: Math.floor(Math.random() * 60) + 200,
    };
  });
}

export default function StatesOfMatter() {
  const [temperature, setTemperature] = useState(200);
  const [isRunning, setIsRunning] = useState(true);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const animRef = useRef<number>(0);
  const isRunningRef = useRef(isRunning);
  const tempRef = useRef(temperature);

  useEffect(() => { isRunningRef.current = isRunning; }, [isRunning]);
  useEffect(() => { tempRef.current = temperature; }, [temperature]);

  const state = getState(temperature);
  const stateColor = getStateColor(state);
  const tempC = temperature - 273;

  const animate = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    const temp = tempRef.current;
    const running = isRunningRef.current;
    const curState = getState(temp);

    ctx.clearRect(0, 0, W, H);

    // Background gradient based on state
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    if (curState === 'Solid') { bg.addColorStop(0, '#1e1b4b'); bg.addColorStop(1, '#312e81'); }
    else if (curState === 'Liquid') { bg.addColorStop(0, '#0c4a6e'); bg.addColorStop(1, '#0369a1'); }
    else if (curState === 'Gas') { bg.addColorStop(0, '#431407'); bg.addColorStop(1, '#7c2d12'); }
    else { bg.addColorStop(0, '#450a0a'); bg.addColorStop(1, '#991b1b'); }
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    const particles = particlesRef.current;
    if (!particles.length) return;

    particles.forEach(p => {
      if (running) {
        let maxSpeed = 0;
        if (curState === 'Solid') {
          // Vibrate near home
          maxSpeed = (temp / 2000) * 0.5;
          const dx = p.homeX - p.x;
          const dy = p.homeY - p.y;
          p.vx += dx * 0.15 + (Math.random() - 0.5) * maxSpeed * 0.5;
          p.vy += dy * 0.15 + (Math.random() - 0.5) * maxSpeed * 0.5;
          const spd = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
          if (spd > maxSpeed) { p.vx = (p.vx / spd) * maxSpeed; p.vy = (p.vy / spd) * maxSpeed; }
        } else if (curState === 'Liquid') {
          maxSpeed = (temp / 2000) * 3;
          p.vx += (Math.random() - 0.5) * 0.3;
          p.vy += (Math.random() - 0.5) * 0.3 + 0.01; // slight gravity-like
          const spd = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
          if (spd > maxSpeed) { p.vx = (p.vx / spd) * maxSpeed; p.vy = (p.vy / spd) * maxSpeed; }
        } else {
          // Gas / Supercritical
          maxSpeed = (temp / 2000) * (curState === 'Supercritical' ? 14 : 10);
          p.vx += (Math.random() - 0.5) * 0.5;
          p.vy += (Math.random() - 0.5) * 0.5;
          const spd = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
          if (spd > maxSpeed) { p.vx = (p.vx / spd) * maxSpeed; p.vy = (p.vy / spd) * maxSpeed; }
        }

        p.x += p.vx;
        p.y += p.vy;

        // Wall bouncing
        const margin = curState === 'Liquid' ? 15 : 5;
        if (p.x < margin) { p.x = margin; p.vx = Math.abs(p.vx); }
        if (p.x > W - margin) { p.x = W - margin; p.vx = -Math.abs(p.vx); }
        if (p.y < margin) { p.y = margin; p.vy = Math.abs(p.vy); }
        if (p.y > H - margin) { p.y = H - margin; p.vy = -Math.abs(p.vy); }

        // Liquid clustering: pull toward center-bottom if liquid
        if (curState === 'Liquid') {
          const cx = W / 2;
          const cy = H * 0.65;
          const dxc = cx - p.x;
          const dyc = cy - p.y;
          const distC = Math.sqrt(dxc * dxc + dyc * dyc);
          if (distC > 80) {
            p.vx += dxc * 0.002;
            p.vy += dyc * 0.002;
          }
        }
      }

      // Draw particle
      const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
      const alpha = curState === 'Gas' ? 0.7 : 0.9;
      const lightness = curState === 'Solid' ? 60 : curState === 'Liquid' ? 65 : 70;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      const hue = curState === 'Solid' ? 260 : curState === 'Liquid' ? 200 : 30;
      ctx.fillStyle = `hsla(${hue + speed * 8}, 80%, ${lightness}%, ${alpha})`;
      ctx.fill();

      // Glow on fast particles
      if (speed > 1.5) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r + 3, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${hue}, 90%, 80%, 0.2)`;
        ctx.fill();
      }
    });

    // State label overlay
    ctx.font = 'bold 13px "Plus Jakarta Sans", sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.textAlign = 'right';
    ctx.fillText(curState.toUpperCase(), W - 8, H - 8);

    animRef.current = requestAnimationFrame(animate);
  }, []);

  // Init particles when canvas mounts
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    particlesRef.current = initParticles(canvas.width, canvas.height);
    animRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animRef.current);
  }, [animate]);

  return (
    <div style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", maxWidth: 520, margin: '0 auto', padding: '0 4px' }}>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#F97316' }}>States of Matter</div>
        <div style={{ fontSize: 11, color: '#64748b' }}>Particle Simulation — CBSE Class 9-10</div>
      </div>

      {/* Canvas */}
      <canvas
        ref={canvasRef}
        width={500}
        height={260}
        role="img"
        aria-label={`Particle simulation showing ${state} state at ${temperature}K`}
        style={{ width: '100%', borderRadius: 12, border: '2px solid #e2e8f0', display: 'block' }}
      />

      {/* State Display */}
      <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
        <div style={{ padding: '10px 8px', background: '#f8fafc', borderRadius: 10, textAlign: 'center', border: `2px solid ${stateColor}` }}>
          <div style={{ fontSize: 9, color: '#64748b', fontWeight: 600 }}>STATE</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: stateColor, marginTop: 2 }}>{state}</div>
        </div>
        <div style={{ padding: '10px 8px', background: '#f8fafc', borderRadius: 10, textAlign: 'center' }}>
          <div style={{ fontSize: 9, color: '#64748b', fontWeight: 600 }}>TEMPERATURE</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#334155', marginTop: 2 }}>{temperature} K</div>
          <div style={{ fontSize: 10, color: '#94a3b8' }}>{tempC > 0 ? '+' : ''}{tempC}°C</div>
        </div>
        <div style={{ padding: '10px 8px', background: '#f8fafc', borderRadius: 10, textAlign: 'center' }}>
          <div style={{ fontSize: 9, color: '#64748b', fontWeight: 600 }}>PARTICLES</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#334155', marginTop: 2 }}>{N_PARTICLES}</div>
          <div style={{ fontSize: 10, color: '#94a3b8' }}>molecules</div>
        </div>
      </div>

      {/* Temperature Slider */}
      <div style={{ marginTop: 10, padding: '12px', background: '#f8fafc', borderRadius: 10, border: '1px solid #e2e8f0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 600, color: '#334155', marginBottom: 6 }}>
          <span>Temperature</span>
          <span style={{ color: stateColor }}>{temperature} K</span>
        </div>
        <input
          type="range"
          min={50}
          max={600}
          step={5}
          value={temperature}
          onChange={e => setTemperature(Number(e.target.value))}
          aria-label={`Temperature: ${temperature} K`}
          style={{ width: '100%', accentColor: stateColor }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#94a3b8', marginTop: 2 }}>
          <span>50 K</span>
          <span style={{ color: '#7c3aed', fontWeight: 600 }}>Melt: 300K</span>
          <span style={{ color: '#F97316', fontWeight: 600 }}>Boil: 400K</span>
          <span>600 K</span>
        </div>
      </div>

      {/* Controls */}
      <div style={{ marginTop: 10, display: 'flex', gap: 8, justifyContent: 'center' }}>
        <button
          onClick={() => setIsRunning(!isRunning)}
          style={{
            padding: '10px 24px', borderRadius: 10, border: 'none', cursor: 'pointer',
            background: isRunning ? '#ef4444' : '#22c55e',
            color: '#fff', fontWeight: 700, fontSize: 12,
            minWidth: 100, minHeight: 44,
          }}
        >
          {isRunning ? 'Pause' : 'Resume'}
        </button>
        {['Solid', 'Liquid', 'Gas'].map((s, i) => (
          <button
            key={s}
            onClick={() => setTemperature([200, 350, 470][i])}
            style={{
              padding: '10px 12px', borderRadius: 10, fontSize: 11, cursor: 'pointer', fontWeight: 600,
              border: `1px solid ${state === s ? getStateColor(s) : '#e2e8f0'}`,
              background: state === s ? getStateColor(s) : '#fff',
              color: state === s ? '#fff' : '#64748b',
              minHeight: 44,
            }}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Phase description */}
      <div style={{ marginTop: 10, padding: '8px 12px', background: `${stateColor}15`, borderRadius: 8, border: `1px solid ${stateColor}40`, fontSize: 11, color: '#334155' }}>
        {state === 'Solid' && 'Solid: Particles vibrate about fixed positions in a regular lattice. Very low kinetic energy. Fixed shape and volume.'}
        {state === 'Liquid' && 'Liquid: Particles move freely but stay close together. Moderate kinetic energy. Fixed volume but no fixed shape.'}
        {state === 'Gas' && 'Gas: Particles move rapidly and spread to fill the container. High kinetic energy. No fixed shape or volume.'}
        {state === 'Supercritical' && 'Supercritical Fluid: Beyond the critical point — properties of both liquid and gas. Very high kinetic energy.'}
      </div>
    </div>
  );
}
