'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';

/**
 * Electric Circuit Basic Simulation
 * CBSE Class 6 Ch12, Class 7 Ch14 — Electricity and Circuits
 *
 * Simple circuit builder: battery, bulb, switch, wire.
 * Toggle switch ON/OFF, series vs parallel circuit.
 * Teaches: closed circuit = current flows, open = no current.
 */

type CircuitMode = 'series' | 'parallel';

const COLORS = {
  bg: '#0f172a',
  wire: '#94a3b8',
  wireActive: '#fbbf24',
  battery: '#22c55e',
  batteryTerminal: '#ef4444',
  bulbOff: '#334155',
  bulbOn: '#fbbf24',
  bulbGlow: 'rgba(251, 191, 36, 0.35)',
  switchOpen: '#ef4444',
  switchClosed: '#22c55e',
  text: '#e2e8f0',
  textDim: '#94a3b8',
  label: '#cbd5e1',
  electron: '#60a5fa',
};

interface Electron {
  t: number;
  speed: number;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

interface Point {
  x: number;
  y: number;
}

function getPointOnPath(path: Point[], t: number): Point {
  const totalSegments = path.length - 1;
  const segment = Math.min(Math.floor(t * totalSegments), totalSegments - 1);
  const localT = (t * totalSegments) - segment;
  return {
    x: lerp(path[segment].x, path[segment + 1].x, localT),
    y: lerp(path[segment].y, path[segment + 1].y, localT),
  };
}

function buildSeriesPath(cx: number, cy: number, w: number, h: number): Point[] {
  const pad = 50;
  const l = cx - w / 2 + pad;
  const r = cx + w / 2 - pad;
  const t = cy - h / 2 + pad;
  const b = cy + h / 2 - pad;
  // Clockwise: bottom-left (battery-) → top-left → top-right → bottom-right → bottom-left
  return [
    { x: l, y: b }, { x: l, y: t },
    { x: cx, y: t }, { x: r, y: t },
    { x: r, y: b }, { x: cx, y: b }, { x: l, y: b },
  ];
}

function buildParallelPaths(cx: number, cy: number, w: number, h: number): { main: Point[]; branch1: Point[]; branch2: Point[] } {
  const pad = 50;
  const l = cx - w / 2 + pad;
  const r = cx + w / 2 - pad;
  const t = cy - h / 2 + pad + 20;
  const b = cy + h / 2 - pad - 20;
  const midY = cy;
  const splitX = cx - w * 0.15;
  const joinX = cx + w * 0.15;

  const main: Point[] = [
    { x: l, y: midY }, { x: splitX, y: midY },
  ];
  const branch1: Point[] = [
    { x: splitX, y: midY }, { x: splitX, y: t }, { x: joinX, y: t }, { x: joinX, y: midY },
  ];
  const branch2: Point[] = [
    { x: splitX, y: midY }, { x: splitX, y: b }, { x: joinX, y: b }, { x: joinX, y: midY },
  ];
  const mainEnd: Point[] = [
    { x: joinX, y: midY }, { x: r, y: midY }, { x: r, y: b + 30 },
    { x: cx, y: b + 30 }, { x: l, y: b + 30 }, { x: l, y: midY },
  ];
  return { main: [...main, ...mainEnd], branch1, branch2 };
}

export default function ElectricCircuitBasic() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number>(0);
  const electronsRef = useRef<Electron[]>([]);
  const electronsBranch1Ref = useRef<Electron[]>([]);
  const electronsBranch2Ref = useRef<Electron[]>([]);

  const [switchOn, setSwitchOn] = useState(false);
  const [mode, setMode] = useState<CircuitMode>('series');
  const [glowIntensity, setGlowIntensity] = useState(0);

  const NUM_ELECTRONS = 16;

  const initElectrons = useCallback(() => {
    const make = (count: number) =>
      Array.from({ length: count }, (_, i) => ({
        t: i / count,
        speed: 0.15 + Math.random() * 0.05,
      }));
    electronsRef.current = make(NUM_ELECTRONS);
    electronsBranch1Ref.current = make(8);
    electronsBranch2Ref.current = make(8);
  }, []);

  useEffect(() => {
    initElectrons();
  }, [initElectrons]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;

    const resizeCanvas = () => {
      const rect = container.getBoundingClientRect();
      const h = Math.min(rect.width * 0.7, 500);
      canvas.width = rect.width * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resizeCanvas();
    const resizeObserver = new ResizeObserver(resizeCanvas);
    resizeObserver.observe(container);

    let lastTime = 0;
    let glow = 0;

    const draw = (timestamp: number) => {
      const dt = lastTime ? (timestamp - lastTime) / 1000 : 0.016;
      lastTime = timestamp;

      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      const cx = w / 2;
      const cy = h / 2;

      ctx.clearRect(0, 0, w, h);

      // Background
      ctx.fillStyle = COLORS.bg;
      ctx.fillRect(0, 0, w, h);

      const circuitClosed = switchOn;

      // Glow animation
      if (circuitClosed) {
        glow = Math.min(glow + dt * 3, 1);
      } else {
        glow = Math.max(glow - dt * 3, 0);
      }
      setGlowIntensity(glow);

      if (mode === 'series') {
        drawSeriesCircuit(ctx, cx, cy, w, h, dt, circuitClosed, glow);
      } else {
        drawParallelCircuit(ctx, cx, cy, w, h, dt, circuitClosed, glow);
      }

      animRef.current = requestAnimationFrame(draw);
    };

    const drawWirePath = (ctx: CanvasRenderingContext2D, path: Point[], active: boolean) => {
      ctx.beginPath();
      ctx.moveTo(path[0].x, path[0].y);
      for (let i = 1; i < path.length; i++) {
        ctx.lineTo(path[i].x, path[i].y);
      }
      ctx.strokeStyle = active ? COLORS.wireActive : COLORS.wire;
      ctx.lineWidth = active ? 3 : 2.5;
      ctx.stroke();
    };

    const drawElectronsOnPath = (
      ctx: CanvasRenderingContext2D,
      electrons: Electron[],
      path: Point[],
      dt: number,
      active: boolean,
    ) => {
      if (!active) return;
      for (const e of electrons) {
        e.t = (e.t + e.speed * dt) % 1;
        const pos = getPointOnPath(path, e.t);
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = COLORS.electron;
        ctx.fill();
        // Glow
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 7, 0, Math.PI * 2);
        const g = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, 7);
        g.addColorStop(0, 'rgba(96,165,250,0.4)');
        g.addColorStop(1, 'rgba(96,165,250,0)');
        ctx.fillStyle = g;
        ctx.fill();
      }
    };

    const drawBattery = (ctx: CanvasRenderingContext2D, x: number, y: number, vertical: boolean) => {
      ctx.save();
      if (vertical) {
        // Battery on left side, vertical
        const bw = 14;
        const bh = 40;

        // Body
        ctx.fillStyle = COLORS.battery;
        ctx.fillRect(x - bw / 2, y - bh / 2, bw, bh);
        ctx.strokeStyle = '#166534';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x - bw / 2, y - bh / 2, bw, bh);

        // Positive terminal (top)
        ctx.fillStyle = COLORS.batteryTerminal;
        ctx.fillRect(x - 5, y - bh / 2 - 6, 10, 6);

        // Labels
        ctx.fillStyle = COLORS.text;
        ctx.font = 'bold 11px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText('+', x, y - bh / 2 - 9);
        ctx.fillText('−', x, y + bh / 2 + 13);

        // Battery label
        ctx.fillStyle = COLORS.textDim;
        ctx.font = '10px system-ui';
        ctx.fillText('Battery', x, y + bh / 2 + 26);
      } else {
        // Horizontal battery
        const bw = 40;
        const bh = 14;
        ctx.fillStyle = COLORS.battery;
        ctx.fillRect(x - bw / 2, y - bh / 2, bw, bh);
        ctx.strokeStyle = '#166534';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x - bw / 2, y - bh / 2, bw, bh);
        ctx.fillStyle = COLORS.batteryTerminal;
        ctx.fillRect(x + bw / 2, y - 4, 6, 8);
        ctx.fillStyle = COLORS.text;
        ctx.font = 'bold 11px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText('+', x + bw / 2 + 10, y + 4);
        ctx.fillText('−', x - bw / 2 - 10, y + 4);
        ctx.fillStyle = COLORS.textDim;
        ctx.font = '10px system-ui';
        ctx.fillText('Battery', x, y + bh / 2 + 15);
      }
      ctx.restore();
    };

    const drawBulb = (
      ctx: CanvasRenderingContext2D,
      x: number,
      y: number,
      on: boolean,
      glowVal: number,
      label: string,
    ) => {
      const radius = 18;
      // Glow effect
      if (on && glowVal > 0) {
        const glowR = radius + 25 * glowVal;
        const g = ctx.createRadialGradient(x, y, radius * 0.5, x, y, glowR);
        g.addColorStop(0, `rgba(251, 191, 36, ${0.5 * glowVal})`);
        g.addColorStop(0.5, `rgba(251, 191, 36, ${0.2 * glowVal})`);
        g.addColorStop(1, 'rgba(251, 191, 36, 0)');
        ctx.beginPath();
        ctx.arc(x, y, glowR, 0, Math.PI * 2);
        ctx.fillStyle = g;
        ctx.fill();
      }

      // Bulb body
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      const bulbColor = on
        ? `rgb(${Math.round(251 * glowVal + 51 * (1 - glowVal))}, ${Math.round(191 * glowVal + 65 * (1 - glowVal))}, ${Math.round(36 * glowVal + 85 * (1 - glowVal))})`
        : COLORS.bulbOff;
      ctx.fillStyle = bulbColor;
      ctx.fill();
      ctx.strokeStyle = on ? '#d97706' : '#475569';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Filament
      ctx.beginPath();
      ctx.moveTo(x - 6, y + 4);
      ctx.lineTo(x - 3, y - 6);
      ctx.lineTo(x + 3, y + 4);
      ctx.lineTo(x + 6, y - 6);
      ctx.strokeStyle = on ? `rgba(255,255,255,${0.5 + 0.5 * glowVal})` : '#64748b';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Base
      ctx.fillStyle = '#78716c';
      ctx.fillRect(x - 8, y + radius - 2, 16, 8);

      // Label
      ctx.fillStyle = COLORS.textDim;
      ctx.font = '10px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(label, x, y + radius + 22);
    };

    const drawSwitch = (
      ctx: CanvasRenderingContext2D,
      x: number,
      y: number,
      closed: boolean,
      horizontal: boolean,
    ) => {
      const len = 30;
      ctx.save();

      // Terminals
      ctx.fillStyle = '#94a3b8';
      if (horizontal) {
        ctx.beginPath();
        ctx.arc(x - len / 2, y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x + len / 2, y, 4, 0, Math.PI * 2);
        ctx.fill();

        // Switch arm
        ctx.beginPath();
        ctx.moveTo(x - len / 2, y);
        if (closed) {
          ctx.lineTo(x + len / 2, y);
        } else {
          ctx.lineTo(x + len / 2 - 5, y - 20);
        }
        ctx.strokeStyle = closed ? COLORS.switchClosed : COLORS.switchOpen;
        ctx.lineWidth = 3;
        ctx.stroke();

        // Label
        ctx.fillStyle = closed ? COLORS.switchClosed : COLORS.switchOpen;
        ctx.font = 'bold 10px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText(closed ? 'CLOSED' : 'OPEN', x, y + 18);
        ctx.fillStyle = COLORS.textDim;
        ctx.font = '10px system-ui';
        ctx.fillText('Switch', x, y + 30);
      } else {
        ctx.beginPath();
        ctx.arc(x, y - len / 2, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x, y + len / 2, 4, 0, Math.PI * 2);
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(x, y + len / 2);
        if (closed) {
          ctx.lineTo(x, y - len / 2);
        } else {
          ctx.lineTo(x - 20, y - len / 2 + 5);
        }
        ctx.strokeStyle = closed ? COLORS.switchClosed : COLORS.switchOpen;
        ctx.lineWidth = 3;
        ctx.stroke();

        ctx.fillStyle = closed ? COLORS.switchClosed : COLORS.switchOpen;
        ctx.font = 'bold 10px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText(closed ? 'CLOSED' : 'OPEN', x + 28, y + 4);
        ctx.fillStyle = COLORS.textDim;
        ctx.font = '10px system-ui';
        ctx.fillText('Switch', x + 28, y + 16);
      }

      ctx.restore();
    };

    const drawSeriesCircuit = (
      ctx: CanvasRenderingContext2D,
      cx: number,
      cy: number,
      w: number,
      h: number,
      dt: number,
      closed: boolean,
      glowVal: number,
    ) => {
      const path = buildSeriesPath(cx, cy, w, h);

      drawWirePath(ctx, path, closed);
      drawElectronsOnPath(ctx, electronsRef.current, path, dt, closed);

      const pad = 50;
      const l = cx - w / 2 + pad;
      const r = cx + w / 2 - pad;
      const t = cy - h / 2 + pad;
      const b = cy + h / 2 - pad;

      // Battery on left side
      drawBattery(ctx, l, cy, true);

      // Switch on top
      drawSwitch(ctx, cx, t, closed, true);

      // Bulb 1 on right side (upper)
      drawBulb(ctx, r, cy - 30, closed, glowVal, 'Bulb 1');

      // Bulb 2 on bottom
      drawBulb(ctx, cx, b, closed, glowVal, 'Bulb 2');

      // Title
      ctx.fillStyle = COLORS.text;
      ctx.font = 'bold 14px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('Series Circuit', cx, 25);

      // Status
      if (!closed) {
        ctx.fillStyle = COLORS.switchOpen;
        ctx.font = 'bold 12px system-ui';
        ctx.fillText('Circuit is OPEN — no current flows', cx, h - 12);
      } else {
        ctx.fillStyle = COLORS.switchClosed;
        ctx.font = 'bold 12px system-ui';
        ctx.fillText('Circuit is CLOSED — current flows through both bulbs', cx, h - 12);
      }
    };

    const drawParallelCircuit = (
      ctx: CanvasRenderingContext2D,
      cx: number,
      cy: number,
      w: number,
      h: number,
      dt: number,
      closed: boolean,
      glowVal: number,
    ) => {
      const { main, branch1, branch2 } = buildParallelPaths(cx, cy, w, h);

      drawWirePath(ctx, main, closed);
      drawWirePath(ctx, branch1, closed);
      drawWirePath(ctx, branch2, closed);

      drawElectronsOnPath(ctx, electronsRef.current, main, dt, closed);
      drawElectronsOnPath(ctx, electronsBranch1Ref.current, branch1, dt, closed);
      drawElectronsOnPath(ctx, electronsBranch2Ref.current, branch2, dt, closed);

      const pad = 50;
      const l = cx - w / 2 + pad;
      const r = cx + w / 2 - pad;
      const b = cy + h / 2 - pad;
      const splitX = cx - w * 0.15;
      const joinX = cx + w * 0.15;
      const t = cy - h / 2 + pad + 20;
      const bY = cy + h / 2 - pad - 20;

      // Battery on left
      drawBattery(ctx, l, cy, false);

      // Switch on right
      drawSwitch(ctx, r, cy, closed, false);

      // Bulb 1 (top branch)
      const bulb1X = (splitX + joinX) / 2;
      drawBulb(ctx, bulb1X, t, closed, glowVal, 'Bulb 1');

      // Bulb 2 (bottom branch)
      drawBulb(ctx, bulb1X, bY, closed, glowVal, 'Bulb 2');

      // Branch labels
      ctx.fillStyle = COLORS.textDim;
      ctx.font = '9px system-ui';
      ctx.textAlign = 'left';
      ctx.fillText('Branch 1', joinX + 8, t);
      ctx.fillText('Branch 2', joinX + 8, bY);

      // Title
      ctx.fillStyle = COLORS.text;
      ctx.font = 'bold 14px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('Parallel Circuit', cx, 25);

      // Status
      if (!closed) {
        ctx.fillStyle = COLORS.switchOpen;
        ctx.font = 'bold 12px system-ui';
        ctx.fillText('Circuit is OPEN — no current flows', cx, h - 12);
      } else {
        ctx.fillStyle = COLORS.switchClosed;
        ctx.font = 'bold 12px system-ui';
        ctx.fillText('Each bulb has its own path — both glow equally bright', cx, h - 12);
      }
    };

    animRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(animRef.current);
      resizeObserver.disconnect();
    };
  }, [switchOn, mode]);

  return (
    <div
      ref={containerRef}
      style={{
        minHeight: '100vh',
        background: `linear-gradient(135deg, ${COLORS.bg} 0%, #1e293b 100%)`,
        padding: '16px',
        fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
        color: COLORS.text,
      }}
    >
      {/* Title */}
      <div style={{ textAlign: 'center', marginBottom: '12px' }}>
        <h1
          style={{
            fontSize: 'clamp(1.3rem, 3.5vw, 2rem)',
            fontWeight: 800,
            margin: 0,
            background: 'linear-gradient(90deg, #fbbf24, #60a5fa)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}
        >
          Electric Circuit Lab
        </h1>
        <p style={{ margin: '4px 0 0', fontSize: 'clamp(0.8rem, 2vw, 0.95rem)', color: COLORS.textDim }}>
          Build a circuit, flip the switch, and watch current flow!
        </p>
      </div>

      {/* Canvas */}
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          borderRadius: '16px',
          border: '1px solid rgba(255,255,255,0.1)',
          background: COLORS.bg,
          display: 'block',
          touchAction: 'none',
        }}
      />

      {/* Controls */}
      <div
        style={{
          maxWidth: '600px',
          margin: '16px auto 0',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
        {/* Switch toggle */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '16px',
            flexWrap: 'wrap',
          }}
        >
          <button
            onClick={() => setSwitchOn(!switchOn)}
            type="button"
            style={{
              padding: '12px 28px',
              borderRadius: '12px',
              border: 'none',
              background: switchOn
                ? 'linear-gradient(135deg, #22c55e, #16a34a)'
                : 'linear-gradient(135deg, #ef4444, #dc2626)',
              color: '#fff',
              fontWeight: 700,
              fontSize: 'clamp(0.9rem, 2vw, 1.05rem)',
              cursor: 'pointer',
              boxShadow: switchOn
                ? '0 0 20px rgba(34,197,94,0.4)'
                : '0 0 20px rgba(239,68,68,0.3)',
              transition: 'all 0.3s ease',
              minWidth: '140px',
              minHeight: '44px',
            }}
          >
            {switchOn ? 'Switch OFF' : 'Switch ON'}
          </button>
        </div>

        {/* Mode toggle */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            gap: '8px',
          }}
        >
          {(['series', 'parallel'] as CircuitMode[]).map((m) => (
            <button
              key={m}
              onClick={() => { setMode(m); initElectrons(); }}
              type="button"
              style={{
                padding: '8px 20px',
                borderRadius: '10px',
                border: `2px solid ${mode === m ? '#60a5fa' : 'rgba(255,255,255,0.15)'}`,
                background: mode === m ? 'rgba(96,165,250,0.15)' : 'rgba(255,255,255,0.05)',
                color: mode === m ? '#93c5fd' : COLORS.textDim,
                fontWeight: 600,
                fontSize: '0.85rem',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                minHeight: '44px',
                textTransform: 'capitalize',
              }}
            >
              {m} Circuit
            </button>
          ))}
        </div>

        {/* Info card */}
        <div
          style={{
            background: 'rgba(255,255,255,0.06)',
            borderRadius: '14px',
            padding: '14px 16px',
            border: '1px solid rgba(255,255,255,0.08)',
            fontSize: 'clamp(0.78rem, 1.8vw, 0.88rem)',
            lineHeight: 1.6,
            color: COLORS.label,
          }}
        >
          {mode === 'series' ? (
            <>
              <strong style={{ color: '#fbbf24' }}>Series Circuit:</strong> Both bulbs share the same single
              path. If one bulb breaks, the entire circuit stops. Both bulbs receive less brightness
              because they share the battery voltage.
            </>
          ) : (
            <>
              <strong style={{ color: '#60a5fa' }}>Parallel Circuit:</strong> Each bulb has its own separate
              path to the battery. If one bulb breaks, the other still works. Both bulbs glow at full
              brightness because each gets the full battery voltage.
            </>
          )}
        </div>
      </div>

      {/* Footer */}
      <div style={{ textAlign: 'center', marginTop: '16px', fontSize: '0.75rem', color: '#475569' }}>
        CBSE Class 6-8 Science — Electricity and Circuits
      </div>
    </div>
  );
}
