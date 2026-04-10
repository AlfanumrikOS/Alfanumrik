'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';

interface Electron {
  t: number; // parameter along the path [0, 1]
  speed: number;
}

interface Point {
  x: number;
  y: number;
}

const DEFAULT_VOLTAGE = 6;
const DEFAULT_RESISTANCE = 10;
const NUM_ELECTRONS = 28;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function buildCircuitPath(cx: number, cy: number, w: number, h: number): Point[] {
  const pad = 40;
  const left = cx - w / 2 + pad;
  const right = cx + w / 2 - pad;
  const top = cy - h / 2 + pad;
  const bottom = cy + h / 2 - pad;

  // Build the path clockwise starting from bottom-left (battery negative)
  // Bottom-left corner to top-left (left wire going up) — battery on left side
  // Top-left to top-right (top wire) — ammeter in the middle
  // Top-right to bottom-right (right wire going down)
  // Bottom-right to bottom-left (bottom wire) — resistor in the middle

  const points: Point[] = [];
  const segments = 6; // per straight section for smooth interpolation

  // LEFT SIDE: bottom-left going up (battery here)
  for (let i = 0; i <= segments; i++) {
    points.push({ x: left, y: lerp(bottom, top, i / segments) });
  }

  // TOP SIDE: top-left going right (ammeter here)
  for (let i = 1; i <= segments; i++) {
    points.push({ x: lerp(left, right, i / segments), y: top });
  }

  // RIGHT SIDE: top-right going down
  for (let i = 1; i <= segments; i++) {
    points.push({ x: right, y: lerp(top, bottom, i / segments) });
  }

  // BOTTOM SIDE: bottom-right going left (resistor here) — with zigzag
  const zigzagStart = 0.25;
  const zigzagEnd = 0.75;
  const zigzagTeeth = 7;
  const zigzagAmplitude = 14;

  for (let i = 1; i <= segments * 3; i++) {
    const t = i / (segments * 3);
    const xPos = lerp(right, left, t);
    let yPos = bottom;

    if (t >= zigzagStart && t <= zigzagEnd) {
      const zt = (t - zigzagStart) / (zigzagEnd - zigzagStart);
      yPos = bottom + Math.sin(zt * zigzagTeeth * Math.PI) * zigzagAmplitude;
    }

    points.push({ x: xPos, y: yPos });
  }

  return points;
}

function getPointOnPath(path: Point[], t: number): Point {
  const totalSegments = path.length - 1;
  const clampedT = ((t % 1) + 1) % 1;
  const idx = clampedT * totalSegments;
  const i = Math.floor(idx);
  const frac = idx - i;

  const p0 = path[Math.min(i, totalSegments)];
  const p1 = path[Math.min(i + 1, totalSegments)];

  return {
    x: lerp(p0.x, p1.x, frac),
    y: lerp(p0.y, p1.y, frac),
  };
}

function computePathLength(path: Point[]): number {
  let len = 0;
  for (let i = 1; i < path.length; i++) {
    const dx = path[i].x - path[i - 1].x;
    const dy = path[i].y - path[i - 1].y;
    len += Math.sqrt(dx * dx + dy * dy);
  }
  return len;
}

export default function OhmsLaw() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animFrameRef = useRef<number>(0);
  const electronsRef = useRef<Electron[]>([]);
  const voltageRef = useRef(DEFAULT_VOLTAGE);
  const resistanceRef = useRef(DEFAULT_RESISTANCE);

  const [voltage, setVoltage] = useState(DEFAULT_VOLTAGE);
  const [resistance, setResistance] = useState(DEFAULT_RESISTANCE);

  const current = voltage / resistance;

  // Keep refs in sync with state
  useEffect(() => {
    voltageRef.current = voltage;
  }, [voltage]);

  useEffect(() => {
    resistanceRef.current = resistance;
  }, [resistance]);

  // Initialize electrons
  useEffect(() => {
    const electrons: Electron[] = [];
    for (let i = 0; i < NUM_ELECTRONS; i++) {
      electrons.push({
        t: i / NUM_ELECTRONS,
        speed: 0,
      });
    }
    electronsRef.current = electrons;
  }, []);

  const drawCircuit = useCallback((ctx: CanvasRenderingContext2D, width: number, height: number, time: number) => {
    const dpr = window.devicePixelRatio || 1;
    const w = width / dpr;
    const h = height / dpr;
    const cx = w / 2;
    const cy = h / 2;

    const V = voltageRef.current;
    const R = resistanceRef.current;
    const I = V / R;

    // --- Background gradient ---
    const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
    bgGrad.addColorStop(0, '#0f0a1a');
    bgGrad.addColorStop(0.5, '#1a1030');
    bgGrad.addColorStop(1, '#0d0815');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    // Subtle radial glow in center
    const centerGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.5);
    centerGlow.addColorStop(0, 'rgba(100, 50, 150, 0.08)');
    centerGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = centerGlow;
    ctx.fillRect(0, 0, w, h);

    // Circuit dimensions
    const circuitW = Math.min(w - 20, 520);
    const circuitH = Math.min(h - 60, 300);
    const pad = 40;
    const left = cx - circuitW / 2 + pad;
    const right = cx + circuitW / 2 - pad;
    const top_ = cy - circuitH / 2 + pad - 10;
    const bottom_ = cy + circuitH / 2 - pad + 10;

    // Wire glow intensity based on current
    const glowIntensity = Math.min(I / 1.5, 1);
    const wireAlpha = 0.4 + glowIntensity * 0.6;
    const wireWidth = 2.5 + glowIntensity * 1.5;

    const wireColor = `rgba(255, ${Math.round(160 - glowIntensity * 60)}, ${Math.round(80 - glowIntensity * 40)}, ${wireAlpha})`;
    const wireGlowColor = `rgba(255, ${Math.round(140 - glowIntensity * 80)}, ${Math.round(50)}, ${glowIntensity * 0.4})`;

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Helper: draw glowing wire segment
    const drawWire = (fromX: number, fromY: number, toX: number, toY: number) => {
      // Glow layer
      if (glowIntensity > 0.1) {
        ctx.strokeStyle = wireGlowColor;
        ctx.lineWidth = wireWidth + 6;
        ctx.beginPath();
        ctx.moveTo(fromX, fromY);
        ctx.lineTo(toX, toY);
        ctx.stroke();
      }
      // Main wire
      ctx.strokeStyle = wireColor;
      ctx.lineWidth = wireWidth;
      ctx.beginPath();
      ctx.moveTo(fromX, fromY);
      ctx.lineTo(toX, toY);
      ctx.stroke();
    };

    // --- Draw circuit wires ---

    // Left wire (battery side) — split for battery
    const batteryTop = cy - 30;
    const batteryBottom = cy + 30;
    drawWire(left, top_, left, batteryTop);
    drawWire(left, batteryBottom, left, bottom_);

    // Top wire — split for ammeter
    const ammeterX = cx;
    const ammeterLeft = ammeterX - 30;
    const ammeterRight = ammeterX + 30;
    drawWire(left, top_, ammeterLeft, top_);
    drawWire(ammeterRight, top_, right, top_);

    // Right wire
    drawWire(right, top_, right, bottom_);

    // Bottom wire — split for resistor
    const resistorLeft = cx - circuitW * 0.18;
    const resistorRight = cx + circuitW * 0.18;
    drawWire(right, bottom_, resistorRight, bottom_);
    drawWire(resistorLeft, bottom_, left, bottom_);

    // --- Draw Battery (left side) ---
    const battW = 28;
    // Outer glow
    const battGlow = ctx.createRadialGradient(left, cy, 5, left, cy, 45);
    battGlow.addColorStop(0, `rgba(255, 200, 50, ${0.15 + glowIntensity * 0.1})`);
    battGlow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = battGlow;
    ctx.fillRect(left - 50, cy - 50, 100, 100);

    // Positive terminal (shorter, thicker line)
    ctx.strokeStyle = '#ffcc33';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(left - battW / 2 - 4, batteryTop);
    ctx.lineTo(left + battW / 2 + 4, batteryTop);
    ctx.stroke();

    // Negative terminal (longer, thinner line)
    ctx.strokeStyle = '#aaaacc';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(left - battW / 2 + 4, batteryBottom);
    ctx.lineTo(left + battW / 2 - 4, batteryBottom);
    ctx.stroke();

    // Battery body between terminals
    const battBodyGrad = ctx.createLinearGradient(left - 10, batteryTop, left - 10, batteryBottom);
    battBodyGrad.addColorStop(0, 'rgba(255, 200, 50, 0.12)');
    battBodyGrad.addColorStop(0.5, 'rgba(255, 180, 30, 0.06)');
    battBodyGrad.addColorStop(1, 'rgba(150, 150, 200, 0.12)');
    ctx.fillStyle = battBodyGrad;
    ctx.fillRect(left - 12, batteryTop, 24, batteryBottom - batteryTop);

    // + and - labels
    ctx.font = 'bold 14px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffcc33';
    ctx.fillText('+', left, batteryTop - 12);
    ctx.fillStyle = '#aaaacc';
    ctx.fillText('−', left, batteryBottom + 13);

    // Voltage label
    ctx.font = 'bold 13px "Segoe UI", sans-serif';
    ctx.fillStyle = '#ffdd66';
    ctx.fillText(`${V.toFixed(1)} V`, left - 2, cy);

    // --- Draw Resistor (bottom, zigzag) ---
    const zigTeeth = 7;
    const zigAmp = 14;
    const rLen = resistorRight - resistorLeft;

    // Resistor glow
    if (glowIntensity > 0.1) {
      ctx.strokeStyle = `rgba(255, 120, 50, ${glowIntensity * 0.3})`;
      ctx.lineWidth = wireWidth + 8;
      ctx.beginPath();
      ctx.moveTo(resistorLeft, bottom_);
      for (let i = 1; i <= zigTeeth * 2; i++) {
        const px = resistorLeft + (rLen * i) / (zigTeeth * 2);
        const py = bottom_ + (i % 2 === 1 ? -zigAmp : zigAmp);
        ctx.lineTo(px, py);
      }
      ctx.lineTo(resistorRight, bottom_);
      ctx.stroke();
    }

    // Main zigzag
    const zigGrad = ctx.createLinearGradient(resistorLeft, bottom_ - zigAmp, resistorRight, bottom_ + zigAmp);
    zigGrad.addColorStop(0, `rgba(255, ${Math.round(140 + glowIntensity * 60)}, ${Math.round(60 + glowIntensity * 40)}, 1)`);
    zigGrad.addColorStop(0.5, `rgba(255, ${Math.round(100 + glowIntensity * 80)}, ${Math.round(40)}, 1)`);
    zigGrad.addColorStop(1, `rgba(255, ${Math.round(140 + glowIntensity * 60)}, ${Math.round(60 + glowIntensity * 40)}, 1)`);
    ctx.strokeStyle = zigGrad;
    ctx.lineWidth = wireWidth + 0.5;
    ctx.beginPath();
    ctx.moveTo(resistorLeft, bottom_);
    for (let i = 1; i <= zigTeeth * 2; i++) {
      const px = resistorLeft + (rLen * i) / (zigTeeth * 2);
      const py = bottom_ + (i % 2 === 1 ? -zigAmp : zigAmp);
      ctx.lineTo(px, py);
    }
    ctx.lineTo(resistorRight, bottom_);
    ctx.stroke();

    // Resistor label
    ctx.font = 'bold 13px "Segoe UI", sans-serif';
    ctx.fillStyle = '#ff9966';
    ctx.textAlign = 'center';
    ctx.fillText(`${R.toFixed(0)} Ω`, cx, bottom_ + zigAmp + 20);

    // "R" label
    ctx.font = 'bold 11px "Segoe UI", sans-serif';
    ctx.fillStyle = 'rgba(255,153,102,0.7)';
    ctx.fillText('Resistor', cx, bottom_ + zigAmp + 35);

    // --- Draw Ammeter (top, circle) ---
    const ammeterR = 24;

    // Ammeter glow
    const amGlow = ctx.createRadialGradient(ammeterX, top_, 5, ammeterX, top_, ammeterR + 15);
    amGlow.addColorStop(0, `rgba(120, 80, 220, ${0.2 + glowIntensity * 0.15})`);
    amGlow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = amGlow;
    ctx.fillRect(ammeterX - 50, top_ - 50, 100, 100);

    // Circle
    const amCircleGrad = ctx.createRadialGradient(ammeterX - 4, top_ - 4, 2, ammeterX, top_, ammeterR);
    amCircleGrad.addColorStop(0, '#2a1f40');
    amCircleGrad.addColorStop(1, '#1a1030');
    ctx.fillStyle = amCircleGrad;
    ctx.beginPath();
    ctx.arc(ammeterX, top_, ammeterR, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = `rgba(160, 100, 255, ${0.6 + glowIntensity * 0.4})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(ammeterX, top_, ammeterR, 0, Math.PI * 2);
    ctx.stroke();

    // "A" label
    ctx.font = 'bold 13px "Segoe UI", sans-serif';
    ctx.fillStyle = '#c090ff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('A', ammeterX, top_ - 6);

    // Current reading
    ctx.font = 'bold 10px "Courier New", monospace';
    ctx.fillStyle = '#e0c0ff';
    ctx.fillText(`${I.toFixed(2)}`, ammeterX, top_ + 9);

    // Ammeter label below
    ctx.font = 'bold 11px "Segoe UI", sans-serif';
    ctx.fillStyle = 'rgba(180,140,255,0.7)';
    ctx.fillText('Ammeter', ammeterX, top_ - ammeterR - 10);

    // Battery label
    ctx.fillStyle = 'rgba(255,220,100,0.7)';
    ctx.fillText('Battery', left, batteryBottom + 30);

    // --- Draw Electrons ---
    const circuitPath = buildCircuitPath(cx, cy, circuitW, circuitH);
    const electrons = electronsRef.current;

    // Speed based on current (normalized)
    const baseSpeed = I * 0.0012;

    for (const electron of electrons) {
      // Update position
      electron.speed = baseSpeed;
      electron.t = (electron.t + electron.speed) % 1;

      const pos = getPointOnPath(circuitPath, electron.t);

      // Electron glow
      const pulse = 0.7 + 0.3 * Math.sin(time * 0.005 + electron.t * Math.PI * 6);
      const electronSize = 3 + glowIntensity * 1.5;

      // Outer glow
      const eGlow = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, electronSize * 3);
      eGlow.addColorStop(0, `rgba(100, 180, 255, ${0.3 * pulse * (0.5 + glowIntensity * 0.5)})`);
      eGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = eGlow;
      ctx.fillRect(pos.x - electronSize * 3, pos.y - electronSize * 3, electronSize * 6, electronSize * 6);

      // Core
      const eCore = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, electronSize);
      eCore.addColorStop(0, `rgba(180, 220, 255, ${0.9 * pulse})`);
      eCore.addColorStop(0.5, `rgba(80, 160, 255, ${0.7 * pulse})`);
      eCore.addColorStop(1, `rgba(40, 80, 200, ${0.2 * pulse})`);
      ctx.fillStyle = eCore;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, electronSize, 0, Math.PI * 2);
      ctx.fill();
    }

    // --- Direction arrows on wires ---
    if (I > 0.01) {
      const arrowAlpha = Math.min(glowIntensity + 0.3, 0.8);
      ctx.fillStyle = `rgba(100, 180, 255, ${arrowAlpha * 0.5})`;
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // Conventional current direction arrows (clockwise: + terminal up, through top wire right, down, through bottom wire left)
      // Top wire: right arrow
      ctx.fillText('▸', lerp(left, ammeterLeft, 0.5), top_ - 14);
      ctx.fillText('▸', lerp(ammeterRight, right, 0.5), top_ - 14);
      // Right wire: down arrow
      ctx.fillText('▾', right + 14, cy);
      // Left wire: up arrow
      ctx.fillText('▴', left - 14, cy);
    }

    // --- Formula Display ---
    const formulaY = h - 28;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Background pill
    const formulaW = Math.min(w - 40, 380);
    const pillX = cx - formulaW / 2;
    ctx.fillStyle = 'rgba(30, 20, 50, 0.7)';
    ctx.beginPath();
    ctx.roundRect(pillX, formulaY - 16, formulaW, 32, 16);
    ctx.fill();
    ctx.strokeStyle = 'rgba(160, 100, 255, 0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(pillX, formulaY - 16, formulaW, 32, 16);
    ctx.stroke();

    // Formula text
    ctx.font = 'bold 14px "Courier New", monospace';
    ctx.fillStyle = '#e0c0ff';
    ctx.fillText(`V = I × R  →  ${V.toFixed(1)} = ${I.toFixed(3)} × ${R.toFixed(0)}`, cx, formulaY);

    // --- Title ---
    ctx.font = 'bold 16px "Segoe UI", sans-serif';
    ctx.fillStyle = 'rgba(220, 180, 255, 0.9)';
    ctx.textAlign = 'center';
    ctx.fillText("Ohm's Law: V = IR", cx, 20);

    // Current display top-right
    ctx.font = 'bold 13px "Courier New", monospace';
    ctx.textAlign = 'right';
    ctx.fillStyle = '#88ddff';
    ctx.fillText(`Current: ${I.toFixed(3)} A`, w - 16, 20);

  }, []);

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
      canvas.height = 400 * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = '400px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    window.addEventListener('resize', resize);

    const animate = (time: number) => {
      if (!running) return;
      drawCircuit(ctx, canvas.width, canvas.height, time);
      animFrameRef.current = requestAnimationFrame(animate);
    };

    animFrameRef.current = requestAnimationFrame(animate);

    return () => {
      running = false;
      cancelAnimationFrame(animFrameRef.current);
      window.removeEventListener('resize', resize);
    };
  }, [drawCircuit]);

  const handleReset = () => {
    setVoltage(DEFAULT_VOLTAGE);
    setResistance(DEFAULT_RESISTANCE);
  };

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
        aria-label="Ohm's Law circuit simulation showing voltage, resistance, and current flow with animated electrons"
        style={{
          width: '100%',
          height: 400,
          borderRadius: 16,
          display: 'block',
        }}
      />

      <div
        style={{
          padding: '20px 4px 8px',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        {/* Voltage Slider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <label
            style={{
              minWidth: 100,
              color: '#ffdd66',
              fontWeight: 700,
              fontSize: 14,
            }}
          >
            Voltage: {voltage.toFixed(1)} V
          </label>
          <input
            type="range"
            min={0}
            max={12}
            step={0.1}
            value={voltage}
            onChange={(e) => setVoltage(parseFloat(e.target.value))}
            aria-label={`Voltage slider, ${voltage.toFixed(1)} Volts, range 0 to 12`}
            style={{
              flex: 1,
              accentColor: '#ffaa33',
              height: 6,
              cursor: 'pointer',
            }}
          />
        </div>

        {/* Resistance Slider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <label
            style={{
              minWidth: 100,
              color: '#ff9966',
              fontWeight: 700,
              fontSize: 14,
            }}
          >
            Resistance: {resistance.toFixed(0)} Ω
          </label>
          <input
            type="range"
            min={1}
            max={100}
            step={1}
            value={resistance}
            onChange={(e) => setResistance(parseFloat(e.target.value))}
            aria-label={`Resistance slider, ${resistance.toFixed(0)} Ohms, range 1 to 100`}
            style={{
              flex: 1,
              accentColor: '#ff6633',
              height: 6,
              cursor: 'pointer',
            }}
          />
        </div>

        {/* Current Display + Reset */}
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
              background: 'linear-gradient(135deg, #1a1030 0%, #2a1845 100%)',
              border: '1px solid rgba(160,100,255,0.3)',
              borderRadius: 12,
              padding: '8px 16px',
              color: '#c090ff',
              fontWeight: 700,
              fontSize: 15,
              fontFamily: '"Courier New", monospace',
            }}
          >
            I = {current.toFixed(3)} A
            {current >= 1 && (
              <span style={{ marginLeft: 8, color: '#88ddff', fontSize: 13 }}>
                ({(current * 1000).toFixed(0)} mA)
              </span>
            )}
            {current < 1 && (
              <span style={{ marginLeft: 8, color: '#88ddff', fontSize: 13 }}>
                ({(current * 1000).toFixed(1)} mA)
              </span>
            )}
          </div>

          <button
            onClick={handleReset}
            aria-label="Reset simulation to default values"
            style={{
              background: 'linear-gradient(135deg, #2a1845 0%, #3a2060 100%)',
              border: '1px solid rgba(160,100,255,0.4)',
              borderRadius: 10,
              padding: '8px 20px',
              color: '#d0b0ff',
              fontWeight: 700,
              fontSize: 14,
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'linear-gradient(135deg, #3a2060 0%, #5030a0 100%)';
              e.currentTarget.style.borderColor = 'rgba(180,120,255,0.7)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'linear-gradient(135deg, #2a1845 0%, #3a2060 100%)';
              e.currentTarget.style.borderColor = 'rgba(160,100,255,0.4)';
            }}
          >
            Reset
          </button>
        </div>

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
          <strong>Tip:</strong> What happens when resistance is very low? Drag the resistance
          slider to 1 Ω and watch the electrons speed up!
        </p>
      </div>
    </div>
  );
}
