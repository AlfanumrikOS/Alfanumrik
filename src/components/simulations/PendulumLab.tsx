'use client';

import { useRef, useEffect, useState, useCallback } from 'react';

/* ═══════════════════════════════════════════════════════════════
   PENDULUM LAB — Interactive Simple Pendulum Simulation
   For CBSE Class 9-10 Physics (Oscillations & Waves)
   ═══════════════════════════════════════════════════════════════ */

interface PendulumState {
  angle: number;
  angularVelocity: number;
  time: number;
  periodCount: number;
  lastCrossing: number;
  measuredPeriod: number;
}

interface GhostPosition {
  x: number;
  y: number;
  opacity: number;
}

const CANVAS_HEIGHT = 450;
const PIVOT_Y = 60;
const BOB_RADIUS = 18;
const MAX_TRAIL = 40;
const DEG = Math.PI / 180;

export default function PendulumLab() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number>(0);
  const stateRef = useRef<PendulumState>({
    angle: 30 * DEG,
    angularVelocity: 0,
    time: 0,
    periodCount: 0,
    lastCrossing: 0,
    measuredPeriod: 0,
  });
  const trailRef = useRef<GhostPosition[]>([]);
  const lastTimeRef = useRef<number>(0);
  const isRunningRef = useRef<boolean>(true);

  const [length, setLength] = useState(1.5);
  const [gravity, setGravity] = useState(9.8);
  const [initialAngle, setInitialAngle] = useState(30);
  const [damping, setDamping] = useState(true);
  const [displayAngle, setDisplayAngle] = useState(30);
  const [displayVelocity, setDisplayVelocity] = useState(0);
  const [displayTime, setDisplayTime] = useState(0);
  const [displayPeriodCount, setDisplayPeriodCount] = useState(0);
  const [displayMeasuredPeriod, setDisplayMeasuredPeriod] = useState(0);
  const [canvasWidth, setCanvasWidth] = useState(600);

  const theoreticalPeriod = 2 * Math.PI * Math.sqrt(length / gravity);

  const resetPendulum = useCallback(() => {
    const s = stateRef.current;
    s.angle = initialAngle * DEG;
    s.angularVelocity = 0;
    s.time = 0;
    s.periodCount = 0;
    s.lastCrossing = 0;
    s.measuredPeriod = 0;
    trailRef.current = [];
    lastTimeRef.current = 0;
    isRunningRef.current = true;
    setDisplayAngle(initialAngle);
    setDisplayVelocity(0);
    setDisplayTime(0);
    setDisplayPeriodCount(0);
    setDisplayMeasuredPeriod(0);
  }, [initialAngle]);

  /* ─── Canvas Drawing ─────────────────────────────────────── */
  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, w: number, h: number) => {
      const s = stateRef.current;
      const scale = Math.min(w, h) * 0.22;
      const pivotX = w / 2;
      const stringLen = length * scale;
      const bobX = pivotX + Math.sin(s.angle) * stringLen;
      const bobY = PIVOT_Y + Math.cos(s.angle) * stringLen;
      const speed = Math.abs(s.angularVelocity);

      // --- Background gradient ---
      const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
      bgGrad.addColorStop(0, '#1a1a2e');
      bgGrad.addColorStop(0.5, '#16213e');
      bgGrad.addColorStop(1, '#0f3460');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, w, h);

      // --- Subtle grid ---
      ctx.strokeStyle = 'rgba(255,255,255,0.03)';
      ctx.lineWidth = 1;
      const gridSpacing = 40;
      for (let gx = 0; gx < w; gx += gridSpacing) {
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, h);
        ctx.stroke();
      }
      for (let gy = 0; gy < h; gy += gridSpacing) {
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.lineTo(w, gy);
        ctx.stroke();
      }

      // --- Ground line ---
      const groundY = h - 40;
      const groundGrad = ctx.createLinearGradient(0, groundY - 5, 0, groundY + 5);
      groundGrad.addColorStop(0, 'rgba(255,255,255,0.08)');
      groundGrad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = groundGrad;
      ctx.fillRect(0, groundY - 2, w, 6);

      // --- Equilibrium line (dashed) ---
      ctx.setLineDash([6, 6]);
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pivotX, PIVOT_Y);
      ctx.lineTo(pivotX, groundY);
      ctx.stroke();
      ctx.setLineDash([]);

      // --- Arc showing angle ---
      if (Math.abs(s.angle) > 0.01) {
        const arcRadius = Math.min(50, stringLen * 0.3);
        ctx.strokeStyle = 'rgba(255,200,100,0.3)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        const startArc = s.angle > 0 ? 0 : s.angle;
        const endArc = s.angle > 0 ? s.angle : 0;
        ctx.arc(pivotX, PIVOT_Y, arcRadius, Math.PI / 2 + startArc, Math.PI / 2 + endArc);
        ctx.stroke();

        // Angle label
        ctx.fillStyle = 'rgba(255,200,100,0.6)';
        ctx.font = '11px "Sora", system-ui, sans-serif';
        ctx.textAlign = 'center';
        const labelAngle = Math.PI / 2 + s.angle / 2;
        const labelR = arcRadius + 14;
        ctx.fillText(
          `${Math.abs(s.angle / DEG).toFixed(1)}°`,
          pivotX + Math.cos(labelAngle) * labelR,
          PIVOT_Y + Math.sin(labelAngle) * labelR
        );
      }

      // --- Ghost trail ---
      const trail = trailRef.current;
      for (let i = 0; i < trail.length; i++) {
        const ghost = trail[i];
        const alpha = ghost.opacity * 0.5;
        ctx.beginPath();
        ctx.arc(ghost.x, ghost.y, BOB_RADIUS * 0.6, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 160, 60, ${alpha})`;
        ctx.fill();
      }

      // --- Bob shadow on ground ---
      const shadowX = bobX;
      const shadowScale = Math.max(0.3, 1 - (groundY - bobY) / (groundY - PIVOT_Y));
      const shadowW = BOB_RADIUS * 2 * shadowScale;
      const shadowH = 6 * shadowScale;
      ctx.beginPath();
      ctx.ellipse(shadowX, groundY, shadowW, shadowH, 0, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(0,0,0,${0.3 * shadowScale})`;
      ctx.fill();

      // --- String ---
      ctx.beginPath();
      ctx.moveTo(pivotX, PIVOT_Y);
      ctx.lineTo(bobX, bobY);
      ctx.strokeStyle = 'rgba(220,220,200,0.85)';
      ctx.lineWidth = 2;
      ctx.stroke();

      // --- Pivot mount ---
      // Bracket
      ctx.fillStyle = '#555';
      ctx.fillRect(pivotX - 30, PIVOT_Y - 12, 60, 14);
      ctx.fillStyle = '#777';
      ctx.fillRect(pivotX - 28, PIVOT_Y - 10, 56, 10);
      // Pivot circle
      ctx.beginPath();
      ctx.arc(pivotX, PIVOT_Y, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#aaa';
      ctx.fill();
      ctx.strokeStyle = '#888';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // --- Motion blur (draw stretched bob when fast) ---
      const blurStrength = Math.min(speed * 8, 25);
      if (blurStrength > 2) {
        const tangentX = Math.cos(s.angle);
        const tangentY = -Math.sin(s.angle);
        const dir = s.angularVelocity > 0 ? -1 : 1;
        for (let b = 1; b <= 4; b++) {
          const offset = b * blurStrength * 0.3;
          const bx = bobX + tangentX * offset * dir;
          const by = bobY + tangentY * offset * dir;
          ctx.beginPath();
          ctx.arc(bx, by, BOB_RADIUS, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(230, 120, 50, ${0.08 / b})`;
          ctx.fill();
        }
      }

      // --- Bob (gradient sphere) ---
      const bobGrad = ctx.createRadialGradient(
        bobX - BOB_RADIUS * 0.3,
        bobY - BOB_RADIUS * 0.3,
        BOB_RADIUS * 0.1,
        bobX,
        bobY,
        BOB_RADIUS
      );
      bobGrad.addColorStop(0, '#FFD699');
      bobGrad.addColorStop(0.3, '#F5A623');
      bobGrad.addColorStop(0.7, '#E8751A');
      bobGrad.addColorStop(1, '#B8451A');
      ctx.beginPath();
      ctx.arc(bobX, bobY, BOB_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = bobGrad;
      ctx.fill();

      // Bob highlight
      ctx.beginPath();
      ctx.arc(bobX - BOB_RADIUS * 0.25, bobY - BOB_RADIUS * 0.25, BOB_RADIUS * 0.35, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.fill();

      // Bob outline
      ctx.beginPath();
      ctx.arc(bobX, bobY, BOB_RADIUS, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(180,70,20,0.5)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // --- Length label on string ---
      const midX = (pivotX + bobX) / 2;
      const midY = (PIVOT_Y + bobY) / 2;
      ctx.save();
      ctx.translate(midX + 12, midY);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.font = '10px "Sora", system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`L = ${length.toFixed(2)} m`, 0, 0);
      ctx.restore();
    },
    [length]
  );

  /* ─── Physics step ───────────────────────────────────────── */
  const step = useCallback(
    (dt: number) => {
      const s = stateRef.current;
      if (!isRunningRef.current) return;

      // Cap dt to avoid spiral of death
      const clampedDt = Math.min(dt, 0.033);

      // Sub-step for stability
      const subSteps = 4;
      const subDt = clampedDt / subSteps;

      for (let i = 0; i < subSteps; i++) {
        // Angular acceleration: α = -(g/L) sin(θ)
        const angularAccel = -(gravity / length) * Math.sin(s.angle);
        s.angularVelocity += angularAccel * subDt;

        // Damping
        if (damping) {
          s.angularVelocity *= 0.999;
        }

        s.angle += s.angularVelocity * subDt;
      }

      s.time += clampedDt;

      // Detect zero-crossing (positive direction) to count periods
      const prevAngle = s.angle - s.angularVelocity * clampedDt;
      if (prevAngle < 0 && s.angle >= 0 && s.angularVelocity > 0) {
        s.periodCount++;
        if (s.lastCrossing > 0) {
          s.measuredPeriod = (s.time - s.lastCrossing);
        }
        s.lastCrossing = s.time;
      }

      // Stop if energy is negligible
      if (
        damping &&
        Math.abs(s.angle) < 0.0005 &&
        Math.abs(s.angularVelocity) < 0.0005
      ) {
        s.angle = 0;
        s.angularVelocity = 0;
        isRunningRef.current = false;
      }
    },
    [gravity, length, damping]
  );

  /* ─── Animation loop ─────────────────────────────────────── */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let frameCount = 0;

    const loop = (timestamp: number) => {
      if (lastTimeRef.current === 0) {
        lastTimeRef.current = timestamp;
      }
      const dt = (timestamp - lastTimeRef.current) / 1000;
      lastTimeRef.current = timestamp;

      step(dt);

      // Update trail
      const s = stateRef.current;
      const w = canvas.width;
      const scale = Math.min(w, CANVAS_HEIGHT) * 0.22;
      const pivotX = w / 2;
      const stringLen = length * scale;
      const bobX = pivotX + Math.sin(s.angle) * stringLen;
      const bobY = PIVOT_Y + Math.cos(s.angle) * stringLen;

      const trail = trailRef.current;
      if (frameCount % 2 === 0) {
        trail.push({ x: bobX, y: bobY, opacity: 1 });
        if (trail.length > MAX_TRAIL) {
          trail.shift();
        }
      }
      // Fade trail
      for (let i = 0; i < trail.length; i++) {
        trail[i].opacity = (i + 1) / trail.length;
      }

      draw(ctx, w, CANVAS_HEIGHT);

      // Update React state every ~6 frames for display
      frameCount++;
      if (frameCount % 6 === 0) {
        setDisplayAngle(Math.round((s.angle / DEG) * 10) / 10);
        setDisplayVelocity(
          Math.round(Math.abs(s.angularVelocity) * length * 100) / 100
        );
        setDisplayTime(Math.round(s.time * 10) / 10);
        setDisplayPeriodCount(s.periodCount);
        setDisplayMeasuredPeriod(Math.round(s.measuredPeriod * 1000) / 1000);
      }

      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(animRef.current);
    };
  }, [step, draw, length]);

  /* ─── Resize handler ─────────────────────────────────────── */
  useEffect(() => {
    const handleResize = () => {
      const container = containerRef.current;
      const canvas = canvasRef.current;
      if (!container || !canvas) return;
      const w = container.clientWidth;
      setCanvasWidth(w);
      canvas.width = w;
      canvas.height = CANVAS_HEIGHT;
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  /* ─── Slider component ──────────────────────────────────── */
  const Slider = ({
    label,
    value,
    min,
    max,
    step: stepVal,
    unit,
    onChange,
    color = '#F5A623',
  }: {
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
    unit: string;
    onChange: (v: number) => void;
    color?: string;
  }) => (
    <div style={{ marginBottom: 10 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 4,
        }}
      >
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: 'rgba(255,255,255,0.7)',
            fontFamily: '"Sora", system-ui, sans-serif',
          }}
        >
          {label}
        </span>
        <span
          style={{
            fontSize: 13,
            fontWeight: 700,
            color,
            fontFamily: '"Sora", monospace, sans-serif',
          }}
        >
          {value.toFixed(stepVal < 1 ? 1 : 0)} {unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={stepVal}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{
          width: '100%',
          accentColor: color,
          cursor: 'pointer',
        }}
      />
    </div>
  );

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        maxWidth: 800,
        margin: '0 auto',
        fontFamily: '"Sora", "Plus Jakarta Sans", system-ui, sans-serif',
        color: '#e5e5e5',
      }}
    >
      {/* Canvas */}
      <div
        style={{
          borderRadius: '16px 16px 0 0',
          overflow: 'hidden',
          position: 'relative',
          border: '1px solid rgba(255,255,255,0.08)',
          borderBottom: 'none',
        }}
      >
        <canvas
          ref={canvasRef}
          width={canvasWidth}
          height={CANVAS_HEIGHT}
          style={{
            width: '100%',
            height: CANVAS_HEIGHT,
            display: 'block',
          }}
        />
      </div>

      {/* Controls panel */}
      <div
        style={{
          background: 'linear-gradient(180deg, #16213e 0%, #1a1a2e 100%)',
          borderRadius: '0 0 16px 16px',
          padding: '16px 20px 20px',
          border: '1px solid rgba(255,255,255,0.08)',
          borderTop: '1px solid rgba(255,255,255,0.05)',
        }}
      >
        {/* Stats row */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))',
            gap: 10,
            marginBottom: 16,
          }}
        >
          <StatBox
            label="Angle"
            value={`${displayAngle.toFixed(1)}°`}
            color="#F5A623"
          />
          <StatBox
            label="Velocity"
            value={`${displayVelocity.toFixed(2)} m/s`}
            color="#4ECDC4"
          />
          <StatBox
            label="Time"
            value={`${displayTime.toFixed(1)} s`}
            color="#A78BFA"
          />
          <StatBox
            label="Periods"
            value={`${displayPeriodCount}`}
            color="#F472B6"
          />
          <StatBox
            label="Measured T"
            value={
              displayMeasuredPeriod > 0
                ? `${displayMeasuredPeriod.toFixed(3)} s`
                : '---'
            }
            color="#60A5FA"
          />
        </div>

        {/* Formula */}
        <div
          style={{
            background: 'rgba(255,255,255,0.04)',
            borderRadius: 10,
            padding: '10px 14px',
            marginBottom: 14,
            border: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          <div
            style={{
              fontSize: 11,
              color: 'rgba(255,255,255,0.4)',
              marginBottom: 4,
              fontWeight: 600,
              textTransform: 'uppercase' as const,
              letterSpacing: 1,
            }}
          >
            Time Period Formula
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span
              style={{
                fontFamily: '"Times New Roman", serif',
                fontSize: 18,
                color: '#F5A623',
                fontStyle: 'italic',
              }}
            >
              T = 2&pi;&radic;(L/g)
            </span>
            <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>=</span>
            <span
              style={{
                fontSize: 13,
                color: 'rgba(255,255,255,0.6)',
                fontFamily: 'monospace',
              }}
            >
              2&pi;&radic;({length.toFixed(2)}/{gravity.toFixed(1)})
            </span>
            <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>=</span>
            <span
              style={{
                fontSize: 15,
                fontWeight: 700,
                color: '#4ECDC4',
                fontFamily: '"Sora", monospace',
              }}
            >
              {theoreticalPeriod.toFixed(3)} s
            </span>
          </div>
        </div>

        {/* Sliders */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: canvasWidth > 500 ? '1fr 1fr' : '1fr',
            gap: '4px 20px',
          }}
        >
          <Slider
            label="Length (L)"
            value={length}
            min={0.5}
            max={3}
            step={0.1}
            unit="m"
            onChange={(v) => setLength(v)}
            color="#F5A623"
          />
          <Slider
            label="Gravity (g)"
            value={gravity}
            min={1}
            max={25}
            step={0.1}
            unit="m/s²"
            onChange={(v) => setGravity(v)}
            color="#4ECDC4"
          />
          <Slider
            label="Initial Angle"
            value={initialAngle}
            min={10}
            max={80}
            step={1}
            unit="°"
            onChange={(v) => setInitialAngle(v)}
            color="#A78BFA"
          />
        </div>

        {/* Buttons row */}
        <div
          style={{
            display: 'flex',
            gap: 10,
            marginTop: 14,
            flexWrap: 'wrap',
            alignItems: 'center',
          }}
        >
          <button
            onClick={resetPendulum}
            style={{
              background: 'linear-gradient(135deg, #F5A623, #E8751A)',
              border: 'none',
              color: '#fff',
              padding: '10px 24px',
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 700,
              cursor: 'pointer',
              fontFamily: '"Sora", system-ui, sans-serif',
              boxShadow: '0 4px 15px rgba(245,166,35,0.3)',
              transition: 'transform 0.15s, box-shadow 0.15s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'scale(1.04)';
              e.currentTarget.style.boxShadow = '0 6px 20px rgba(245,166,35,0.45)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
              e.currentTarget.style.boxShadow = '0 4px 15px rgba(245,166,35,0.3)';
            }}
          >
            Release
          </button>

          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 12,
              color: 'rgba(255,255,255,0.6)',
              cursor: 'pointer',
              userSelect: 'none',
            }}
          >
            <div
              onClick={() => setDamping(!damping)}
              style={{
                width: 40,
                height: 22,
                borderRadius: 11,
                background: damping
                  ? 'rgba(255,255,255,0.15)'
                  : 'rgba(78,205,196,0.6)',
                position: 'relative',
                transition: 'background 0.2s',
                cursor: 'pointer',
                border: '1px solid rgba(255,255,255,0.15)',
              }}
            >
              <div
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: '50%',
                  background: '#fff',
                  position: 'absolute',
                  top: 2,
                  left: damping ? 2 : 20,
                  transition: 'left 0.2s',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                }}
              />
            </div>
            <span style={{ fontWeight: 500 }}>
              {damping ? 'Damping ON' : 'No Damping'}
            </span>
          </label>

          {!isRunningRef.current && (
            <span
              style={{
                fontSize: 11,
                color: 'rgba(255,100,100,0.7)',
                fontWeight: 600,
                marginLeft: 'auto',
              }}
            >
              Pendulum stopped — press Release
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Stat display box ─────────────────────────────────────── */
function StatBox({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div
      style={{
        background: 'rgba(255,255,255,0.04)',
        borderRadius: 10,
        padding: '8px 10px',
        textAlign: 'center',
        border: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      <div
        style={{
          fontSize: 10,
          color: 'rgba(255,255,255,0.4)',
          fontWeight: 600,
          textTransform: 'uppercase' as const,
          letterSpacing: 0.5,
          marginBottom: 2,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 15,
          fontWeight: 700,
          color,
          fontFamily: '"Sora", monospace, sans-serif',
        }}
      >
        {value}
      </div>
    </div>
  );
}
