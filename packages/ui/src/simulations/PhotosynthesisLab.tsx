'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';

/* ─── Constants ─── */
const DEFAULT_LIGHT = 70;     // 0–100 %
const DEFAULT_CO2 = 60;       // 0–100 %
const DEFAULT_WATER = true;

interface Bubble {
  x: number;
  y: number;
  r: number;
  speed: number;
  opacity: number;
}

interface Photon {
  x: number;
  y: number;
  angle: number;
  speed: number;
  opacity: number;
  len: number;
}

interface CO2Particle {
  x: number;
  y: number;
  baseX: number;
  baseY: number;
  phase: number;
  speed: number;
  entering: boolean;
  progress: number;
}

interface WaterDot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  opacity: number;
}

export default function PhotosynthesisLab() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number>(0);

  const lightRef = useRef(DEFAULT_LIGHT);
  const co2Ref = useRef(DEFAULT_CO2);
  const waterRef = useRef(DEFAULT_WATER);

  const bubblesRef = useRef<Bubble[]>([]);
  const photonsRef = useRef<Photon[]>([]);
  const co2Ref2 = useRef<CO2Particle[]>([]);
  const waterDotsRef = useRef<WaterDot[]>([]);
  const glucoseCountRef = useRef(0);
  const lastTimeRef = useRef(0);

  const [light, setLight] = useState(DEFAULT_LIGHT);
  const [co2, setCO2] = useState(DEFAULT_CO2);
  const [water, setWater] = useState(DEFAULT_WATER);
  const [glucoseDisplay, setGlucoseDisplay] = useState(0);

  useEffect(() => { lightRef.current = light; }, [light]);
  useEffect(() => { co2Ref.current = co2; }, [co2]);
  useEffect(() => { waterRef.current = water; }, [water]);

  /* ─── Glucose production rate ─── */
  const getRate = useCallback(() => {
    const l = lightRef.current / 100;
    const c = co2Ref.current / 100;
    const w = waterRef.current ? 1 : 0;
    // Rate is limited by the minimum factor (Liebig's law)
    return Math.min(l, c) * w;
  }, []);

  /* ─── Draw ─── */
  const draw = useCallback((ctx: CanvasRenderingContext2D, W: number, H: number, time: number) => {
    const dpr = window.devicePixelRatio || 1;
    const w = W / dpr;
    const h = H / dpr;
    const dt = lastTimeRef.current ? (time - lastTimeRef.current) / 1000 : 0.016;
    lastTimeRef.current = time;

    const rate = getRate();

    /* ─── Background ─── */
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#e8f4fd');
    sky.addColorStop(0.3, '#d4eef9');
    sky.addColorStop(1, '#8b6f47');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    /* ─── Sun ─── */
    const sunX = w * 0.85;
    const sunY = h * 0.1;
    const sunBrightness = lightRef.current / 100;
    if (sunBrightness > 0) {
      const sunGlow = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, 60 + sunBrightness * 40);
      sunGlow.addColorStop(0, `rgba(255, 230, 80, ${sunBrightness})`);
      sunGlow.addColorStop(0.4, `rgba(255, 200, 50, ${sunBrightness * 0.5})`);
      sunGlow.addColorStop(1, 'rgba(255, 200, 50, 0)');
      ctx.fillStyle = sunGlow;
      ctx.fillRect(sunX - 100, sunY - 100, 200, 200);

      ctx.fillStyle = `rgba(255, 220, 50, ${0.8 * sunBrightness})`;
      ctx.beginPath();
      ctx.arc(sunX, sunY, 20 + sunBrightness * 10, 0, Math.PI * 2);
      ctx.fill();
    }

    /* ─── Leaf cross-section ─── */
    const leafX = w * 0.12;
    const leafY = h * 0.18;
    const leafW = w * 0.76;
    const leafH = h * 0.52;

    // Outer leaf shape — rounded rect
    ctx.fillStyle = '#4a8f3c';
    ctx.beginPath();
    ctx.roundRect(leafX, leafY, leafW, leafH, 20);
    ctx.fill();

    // Epidermis layers
    ctx.fillStyle = '#5ea64e';
    ctx.beginPath();
    ctx.roundRect(leafX + 4, leafY + 4, leafW - 8, 18, [16, 16, 0, 0]);
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(leafX + 4, leafY + leafH - 22, leafW - 8, 18, [0, 0, 16, 16]);
    ctx.fill();

    // Mesophyll / inner
    ctx.fillStyle = '#6cc25a';
    ctx.beginPath();
    ctx.roundRect(leafX + 8, leafY + 24, leafW - 16, leafH - 48, 10);
    ctx.fill();

    // Labels
    ctx.font = 'bold 11px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.fillText('Upper Epidermis', leafX + leafW / 2, leafY + 15);
    ctx.fillText('Lower Epidermis', leafX + leafW / 2, leafY + leafH - 9);

    /* ─── Stomata (bottom of leaf) ─── */
    const stCount = 3;
    const stY = leafY + leafH - 14;
    for (let i = 0; i < stCount; i++) {
      const sx = leafX + leafW * (0.25 + i * 0.25);
      const openW = 6 + rate * 6;
      ctx.strokeStyle = '#3a7530';
      ctx.lineWidth = 2;
      // Left guard cell
      ctx.beginPath();
      ctx.ellipse(sx - openW / 2, stY, 5, 8, -0.2, 0, Math.PI * 2);
      ctx.stroke();
      // Right guard cell
      ctx.beginPath();
      ctx.ellipse(sx + openW / 2, stY, 5, 8, 0.2, 0, Math.PI * 2);
      ctx.stroke();
      // Pore
      ctx.fillStyle = '#3a6330';
      ctx.beginPath();
      ctx.ellipse(sx, stY, openW / 2 - 1, 4, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    /* ─── Chloroplasts ─── */
    const cpCount = 6;
    const cpPositions = [
      [0.22, 0.38], [0.42, 0.32], [0.62, 0.38],
      [0.28, 0.55], [0.52, 0.58], [0.72, 0.52],
    ];
    for (let i = 0; i < cpCount; i++) {
      const cpx = leafX + leafW * cpPositions[i][0];
      const cpy = leafY + leafH * cpPositions[i][1];
      const cpw = 32 + (i % 3) * 6;
      const cph = 16 + (i % 2) * 4;

      // Green glow when active
      if (rate > 0) {
        const glow = ctx.createRadialGradient(cpx, cpy, 0, cpx, cpy, cpw);
        glow.addColorStop(0, `rgba(100, 255, 80, ${rate * 0.3})`);
        glow.addColorStop(1, 'rgba(100, 255, 80, 0)');
        ctx.fillStyle = glow;
        ctx.fillRect(cpx - cpw, cpy - cpw, cpw * 2, cpw * 2);
      }

      // Chloroplast body
      const cpGrad = ctx.createLinearGradient(cpx - cpw / 2, cpy, cpx + cpw / 2, cpy);
      cpGrad.addColorStop(0, '#2d7a1f');
      cpGrad.addColorStop(0.5, `rgb(${60 + Math.round(rate * 80)}, ${140 + Math.round(rate * 60)}, ${40 + Math.round(rate * 40)})`);
      cpGrad.addColorStop(1, '#2d7a1f');
      ctx.fillStyle = cpGrad;
      ctx.beginPath();
      ctx.ellipse(cpx, cpy, cpw / 2, cph / 2, 0, 0, Math.PI * 2);
      ctx.fill();

      // Inner thylakoid lines
      ctx.strokeStyle = 'rgba(20, 80, 15, 0.5)';
      ctx.lineWidth = 1;
      for (let j = -2; j <= 2; j++) {
        ctx.beginPath();
        ctx.ellipse(cpx, cpy + j * 3, cpw / 2 - 4, 2, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    /* ─── Photons (light rays) ─── */
    if (sunBrightness > 0.05) {
      const photons = photonsRef.current;
      // Spawn photons
      while (photons.length < Math.floor(sunBrightness * 25)) {
        photons.push({
          x: sunX - 40 + Math.random() * 80,
          y: sunY + 20,
          angle: Math.PI * 0.55 + Math.random() * 0.3,
          speed: 80 + Math.random() * 60,
          opacity: 0.5 + Math.random() * 0.5,
          len: 10 + Math.random() * 15,
        });
      }

      for (let i = photons.length - 1; i >= 0; i--) {
        const p = photons[i];
        p.x += Math.cos(p.angle) * p.speed * dt * -1;
        p.y += Math.sin(p.angle) * p.speed * dt;

        // Draw photon ray
        ctx.strokeStyle = `rgba(255, 230, 80, ${p.opacity * sunBrightness})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + Math.cos(p.angle) * p.len, p.y - Math.sin(p.angle) * p.len);
        ctx.stroke();

        // Remove if out of bounds or absorbed by leaf
        if (p.y > leafY + leafH || p.x < 0 || p.y < 0) {
          photons.splice(i, 1);
        }
      }
    } else {
      photonsRef.current = [];
    }

    /* ─── CO2 particles entering through stomata ─── */
    const co2Parts = co2Ref2.current;
    const co2Level = co2Ref.current / 100;
    // Spawn
    while (co2Parts.length < Math.floor(co2Level * 12)) {
      const stIdx = Math.floor(Math.random() * stCount);
      const sx = leafX + leafW * (0.25 + stIdx * 0.25);
      co2Parts.push({
        x: sx + (Math.random() - 0.5) * 20,
        y: leafY + leafH + 10 + Math.random() * 30,
        baseX: sx,
        baseY: leafY + leafH * 0.45,
        phase: Math.random() * Math.PI * 2,
        speed: 30 + Math.random() * 20,
        entering: true,
        progress: 0,
      });
    }
    // Remove excess
    while (co2Parts.length > Math.floor(co2Level * 12) + 1) {
      co2Parts.pop();
    }

    for (let i = co2Parts.length - 1; i >= 0; i--) {
      const p = co2Parts[i];
      p.progress += dt * 0.15;
      if (p.progress > 1) {
        p.progress = 0;
        p.x = p.baseX + (Math.random() - 0.5) * 20;
        p.y = leafY + leafH + 10 + Math.random() * 30;
      }

      const t = p.progress;
      const drawX = p.x + (p.baseX - p.x) * t + Math.sin(time * 0.002 + p.phase) * 8 * (1 - t);
      const drawY = p.y + (p.baseY - p.y) * t;

      ctx.fillStyle = `rgba(150, 150, 170, ${0.7 * (1 - t * 0.5)})`;
      ctx.font = 'bold 10px "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('CO\u2082', drawX, drawY);
    }

    /* ─── Water molecules (blue dots rising inside leaf) ─── */
    if (waterRef.current) {
      const wDots = waterDotsRef.current;
      while (wDots.length < 10) {
        wDots.push({
          x: leafX + leafW * 0.1 + Math.random() * leafW * 0.8,
          y: leafY + leafH * 0.7 + Math.random() * leafH * 0.2,
          vx: (Math.random() - 0.5) * 10,
          vy: -(10 + Math.random() * 20),
          opacity: 0.6 + Math.random() * 0.4,
        });
      }

      for (let i = wDots.length - 1; i >= 0; i--) {
        const d = wDots[i];
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        d.opacity -= dt * 0.3;

        if (d.opacity > 0.05) {
          ctx.fillStyle = `rgba(80, 160, 255, ${d.opacity})`;
          ctx.beginPath();
          ctx.arc(d.x, d.y, 3, 0, Math.PI * 2);
          ctx.fill();
          ctx.font = '8px sans-serif';
          ctx.fillStyle = `rgba(60, 130, 220, ${d.opacity})`;
          ctx.fillText('H\u2082O', d.x + 6, d.y + 3);
        } else {
          wDots.splice(i, 1);
        }
      }
    } else {
      waterDotsRef.current = [];
    }

    /* ─── O2 Bubbles released ─── */
    const bubbles = bubblesRef.current;
    if (rate > 0.05) {
      // Spawn bubbles
      if (Math.random() < rate * 0.15) {
        const stIdx = Math.floor(Math.random() * stCount);
        const sx = leafX + leafW * (0.25 + stIdx * 0.25);
        bubbles.push({
          x: sx + (Math.random() - 0.5) * 10,
          y: leafY - 5,
          r: 3 + Math.random() * 4,
          speed: 20 + Math.random() * 30,
          opacity: 0.8,
        });
      }
    }

    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i];
      b.y -= b.speed * dt;
      b.x += Math.sin(time * 0.003 + i) * 0.5;
      b.opacity -= dt * 0.3;

      if (b.opacity > 0.02 && b.y > 0) {
        ctx.strokeStyle = `rgba(100, 200, 255, ${b.opacity})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.stroke();
        // O2 label
        ctx.font = '8px sans-serif';
        ctx.fillStyle = `rgba(80, 180, 240, ${b.opacity})`;
        ctx.textAlign = 'center';
        ctx.fillText('O\u2082', b.x, b.y - b.r - 3);
      } else {
        bubbles.splice(i, 1);
      }
    }

    /* ─── Glucose production counter ─── */
    glucoseCountRef.current += rate * dt * 5;
    const gCount = Math.floor(glucoseCountRef.current * 10) / 10;
    // Push display update via state (throttled)
    if (Math.abs(gCount - glucoseDisplay) > 0.05) {
      setGlucoseDisplay(gCount);
    }

    /* ─── Glucose molecule indicators in leaf ─── */
    if (rate > 0.1) {
      const gCount2 = Math.floor(rate * 4) + 1;
      for (let i = 0; i < gCount2; i++) {
        const gx = leafX + leafW * (0.3 + i * 0.15);
        const gy = leafY + leafH * 0.42 + Math.sin(time * 0.002 + i * 1.5) * 6;
        ctx.fillStyle = `rgba(255, 200, 50, ${0.4 + rate * 0.4})`;
        ctx.beginPath();
        ctx.arc(gx, gy, 5, 0, Math.PI * 2);
        ctx.fill();
        // Hexagon outline for glucose
        ctx.strokeStyle = `rgba(220, 170, 30, ${0.5 + rate * 0.3})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let s = 0; s < 6; s++) {
          const a = (Math.PI / 3) * s - Math.PI / 6;
          const px = gx + 7 * Math.cos(a);
          const py = gy + 7 * Math.sin(a);
          if (s === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.stroke();
      }
    }

    /* ─── Formula bar at bottom ─── */
    const formulaY = h - 38;
    const pillW = Math.min(w - 30, 420);
    const pillX = (w - pillW) / 2;

    ctx.fillStyle = 'rgba(30, 60, 30, 0.85)';
    ctx.beginPath();
    ctx.roundRect(pillX, formulaY - 14, pillW, 30, 15);
    ctx.fill();
    ctx.strokeStyle = 'rgba(100, 200, 80, 0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(pillX, formulaY - 14, pillW, 30, 15);
    ctx.stroke();

    // Highlight changing parts based on rate
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 12px "Courier New", monospace';

    // Build formula with highlighting
    const parts = [
      { text: '6CO\u2082', color: co2Level > 0.1 ? '#aaddaa' : '#667766' },
      { text: ' + ', color: '#88aa88' },
      { text: '6H\u2082O', color: waterRef.current ? '#88bbff' : '#667766' },
      { text: ' \u2192 ', color: '#88aa88' },
      { text: 'C\u2086H\u2081\u2082O\u2086', color: rate > 0.1 ? '#ffdd66' : '#667766' },
      { text: ' + ', color: '#88aa88' },
      { text: '6O\u2082', color: rate > 0.1 ? '#88ddff' : '#667766' },
    ];

    let totalW = 0;
    const measures: number[] = [];
    for (const p of parts) {
      const m = ctx.measureText(p.text).width;
      measures.push(m);
      totalW += m;
    }
    let curX = w / 2 - totalW / 2;
    for (let i = 0; i < parts.length; i++) {
      ctx.fillStyle = parts[i].color;
      ctx.textAlign = 'left';
      ctx.fillText(parts[i].text, curX, formulaY);
      curX += measures[i];
    }

    /* ─── Title ─── */
    ctx.font = 'bold 14px "Segoe UI", sans-serif';
    ctx.fillStyle = '#2d6a1f';
    ctx.textAlign = 'center';
    ctx.fillText('Photosynthesis: Light, CO\u2082 & Glucose', w / 2, 16);

    /* ─── Rate display ─── */
    const ratePercent = Math.round(rate * 100);
    ctx.font = 'bold 12px "Courier New", monospace';
    ctx.textAlign = 'right';
    ctx.fillStyle = rate > 0.5 ? '#2d8a1f' : rate > 0.1 ? '#8a7a1f' : '#8a3a1f';
    ctx.fillText(`Rate: ${ratePercent}%`, w - 14, 16);

    /* ─── No water warning ─── */
    if (!waterRef.current) {
      ctx.font = 'bold 13px "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(200, 60, 60, 0.8)';
      ctx.fillText('No water — photosynthesis stopped!', w / 2, leafY + leafH / 2);
    }

  }, [getRate, glucoseDisplay]);

  /* ─── Animation loop ─── */
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
      canvas.width = rect.width * dpr;
      canvas.height = 420 * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = '420px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);

    const animate = (time: number) => {
      if (!running) return;
      draw(ctx, canvas.width, canvas.height, time);
      animRef.current = requestAnimationFrame(animate);
    };

    animRef.current = requestAnimationFrame(animate);

    return () => {
      running = false;
      cancelAnimationFrame(animRef.current);
      ro.disconnect();
    };
  }, [draw]);

  const handleReset = () => {
    setLight(DEFAULT_LIGHT);
    setCO2(DEFAULT_CO2);
    setWater(DEFAULT_WATER);
    glucoseCountRef.current = 0;
    setGlucoseDisplay(0);
    bubblesRef.current = [];
    photonsRef.current = [];
    co2Ref2.current = [];
    waterDotsRef.current = [];
  };

  const rate = Math.min(light / 100, co2 / 100) * (water ? 1 : 0);

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
        aria-label="Photosynthesis simulation showing a leaf cross-section with light absorption, CO2 intake, and O2 release"
        style={{
          width: '100%',
          height: 420,
          borderRadius: 16,
          display: 'block',
        }}
      />

      <div style={{ padding: '16px 4px 8px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Light Intensity Slider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <label style={{ minWidth: 120, color: '#b8860b', fontWeight: 700, fontSize: 14 }}>
            Light: {light}%
          </label>
          <input
            type="range" min={0} max={100} step={1} value={light}
            onChange={(e) => setLight(parseInt(e.target.value))}
            aria-label={`Light intensity slider, ${light}%, range 0 to 100`}
            style={{ flex: 1, accentColor: '#daa520', height: 6, cursor: 'pointer' }}
          />
        </div>

        {/* CO2 Concentration Slider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <label style={{ minWidth: 120, color: '#6b7b8d', fontWeight: 700, fontSize: 14 }}>
            CO&#x2082;: {co2}%
          </label>
          <input
            type="range" min={0} max={100} step={1} value={co2}
            onChange={(e) => setCO2(parseInt(e.target.value))}
            aria-label={`CO2 concentration slider, ${co2}%, range 0 to 100`}
            style={{ flex: 1, accentColor: '#708090', height: 6, cursor: 'pointer' }}
          />
        </div>

        {/* Water Toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <label style={{ minWidth: 120, color: '#4682b4', fontWeight: 700, fontSize: 14 }}>
            Water: {water ? 'Available' : 'None'}
          </label>
          <button
            onClick={() => setWater(!water)}
            aria-label={`Water availability toggle, currently ${water ? 'on' : 'off'}`}
            style={{
              padding: '6px 20px',
              borderRadius: 20,
              border: `2px solid ${water ? '#4682b4' : '#cc6666'}`,
              background: water ? 'rgba(70, 130, 180, 0.15)' : 'rgba(200, 100, 100, 0.1)',
              color: water ? '#4682b4' : '#cc6666',
              fontWeight: 700,
              fontSize: 13,
              cursor: 'pointer',
              transition: 'all 0.2s',
              minHeight: 44,
              minWidth: 44,
            }}
          >
            {water ? 'H\u2082O ON' : 'H\u2082O OFF'}
          </button>
        </div>

        {/* Output panel */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 8,
          }}
        >
          <div
            style={{
              background: 'linear-gradient(135deg, #2a4a1a 0%, #3a6a2a 100%)',
              border: '1px solid rgba(100,200,80,0.3)',
              borderRadius: 12,
              padding: '8px 16px',
              color: '#a0e080',
              fontWeight: 700,
              fontSize: 14,
              fontFamily: '"Courier New", monospace',
            }}
          >
            Glucose: {glucoseDisplay.toFixed(1)} units
            <span style={{ marginLeft: 10, color: '#ffdd66', fontSize: 12 }}>
              Rate: {Math.round(rate * 100)}%
            </span>
          </div>

          <button
            onClick={handleReset}
            aria-label="Reset simulation to default values"
            style={{
              background: 'linear-gradient(135deg, #2a4a1a 0%, #3a6a2a 100%)',
              border: '1px solid rgba(100,200,80,0.4)',
              borderRadius: 10,
              padding: '8px 20px',
              color: '#b0e090',
              fontWeight: 700,
              fontSize: 14,
              cursor: 'pointer',
              transition: 'all 0.2s',
              minHeight: 44,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'linear-gradient(135deg, #3a6a2a 0%, #4a8a3a 100%)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'linear-gradient(135deg, #2a4a1a 0%, #3a6a2a 100%)';
            }}
          >
            Reset
          </button>
        </div>

        {/* Discovery tip */}
        <p
          style={{
            margin: 0,
            padding: '8px 12px',
            background: 'rgba(40, 120, 40, 0.08)',
            border: '1px solid rgba(40, 120, 40, 0.2)',
            borderRadius: 10,
            color: '#3a7a30',
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          <strong>Discover:</strong> Reduce light to 0% — glucose production stops!
          Now try high light but low CO&#x2082; — the rate is limited by the lowest factor
          (Liebig&apos;s Law of the Minimum).
        </p>
      </div>
    </div>
  );
}
