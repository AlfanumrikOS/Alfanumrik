'use client';

import { useRef, useEffect, useState, useCallback } from 'react';

/* ═══════════════════════════════════════════════════════════════
   WAVE ON A STRING — Interactive Transverse Wave Simulation
   CBSE Class 9-11 Physics: Wavelength, Amplitude, Frequency
   ═══════════════════════════════════════════════════════════════ */

interface SliderConfig {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  unit: string;
  symbol: string;
}

interface PulseState {
  active: boolean;
  startTime: number;
}

const CANVAS_HEIGHT = 350;
const BEAD_SPACING = 18;
const WAVE_THICKNESS = 3;
const BEAD_RADIUS = 5;
const GRID_COLOR = 'rgba(100, 120, 180, 0.08)';
const GRID_COLOR_AXIS = 'rgba(100, 120, 180, 0.18)';

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function waveGradientColor(t: number): string {
  // Blue (#3b82f6) to Purple (#a855f7)
  const r = Math.round(lerp(59, 168, t));
  const g = Math.round(lerp(130, 85, t));
  const b = Math.round(lerp(246, 247, t));
  return `rgb(${r},${g},${b})`;
}

export default function WaveOnString() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number>(0);
  const timeRef = useRef<number>(0);
  const lastFrameRef = useRef<number>(0);

  const [frequency, setFrequency] = useState(2);
  const [amplitude, setAmplitude] = useState(50);
  const [waveSpeed, setWaveSpeed] = useState(150);
  const [showParticles, setShowParticles] = useState(true);
  const [standingWave, setStandingWave] = useState(false);
  const [pulseState, setPulseState] = useState<PulseState>({ active: false, startTime: 0 });
  const [isPaused, setIsPaused] = useState(false);

  const wavelength = waveSpeed / frequency;

  const sendPulse = useCallback(() => {
    setPulseState({ active: true, startTime: timeRef.current });
  }, []);

  // Main render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resizeCanvas = () => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = CANVAS_HEIGHT * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${CANVAS_HEIGHT}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resizeCanvas();
    const resizeObserver = new ResizeObserver(resizeCanvas);
    resizeObserver.observe(container);

    const draw = (timestamp: number) => {
      if (!lastFrameRef.current) lastFrameRef.current = timestamp;
      const dt = (timestamp - lastFrameRef.current) / 1000;
      lastFrameRef.current = timestamp;

      if (!isPaused) {
        timeRef.current += dt;
      }

      const t = timeRef.current;
      const w = canvas.width / (window.devicePixelRatio || 1);
      const h = CANVAS_HEIGHT;
      const midY = h / 2 + 20; // offset down slightly for annotation room

      ctx.clearRect(0, 0, w, h);

      // ── Background gradient ──
      const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
      bgGrad.addColorStop(0, '#0f0f1a');
      bgGrad.addColorStop(1, '#1a1a2e');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, w, h);

      // ── Grid lines ──
      ctx.lineWidth = 1;
      const gridSpacing = 40;
      for (let gx = gridSpacing; gx < w; gx += gridSpacing) {
        ctx.strokeStyle = GRID_COLOR;
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, h);
        ctx.stroke();
      }
      for (let gy = gridSpacing; gy < h; gy += gridSpacing) {
        ctx.strokeStyle = gy === Math.round(midY / gridSpacing) * gridSpacing ? GRID_COLOR_AXIS : GRID_COLOR;
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.lineTo(w, gy);
        ctx.stroke();
      }

      // ── Equilibrium line ──
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(0, midY);
      ctx.lineTo(w, midY);
      ctx.stroke();
      ctx.setLineDash([]);

      // ── Wave displacement function ──
      const omega = 2 * Math.PI * frequency;
      const k = (2 * Math.PI) / wavelength;

      const getY = (x: number): number => {
        if (pulseState.active) {
          // Single Gaussian pulse traveling right
          const elapsed = t - pulseState.startTime;
          const pulseCenter = elapsed * waveSpeed;
          const pulseWidth = wavelength * 0.4;
          const dist = x - pulseCenter;
          const env = Math.exp(-(dist * dist) / (2 * pulseWidth * pulseWidth));
          const osc = Math.sin(k * x - omega * t);
          // Fade out when pulse leaves canvas
          if (pulseCenter > w + pulseWidth * 3) {
            setPulseState({ active: false, startTime: 0 });
          }
          return env * osc * amplitude;
        }

        if (standingWave) {
          // Standing wave: 2A sin(kx) cos(wt)
          return 2 * amplitude * 0.5 * Math.sin(k * x) * Math.cos(omega * t);
        }

        // Traveling wave: A sin(kx - wt)
        return amplitude * Math.sin(k * x - omega * t);
      };

      // ── Draw wave with gradient thickness ──
      const segments = Math.ceil(w / 2);
      for (let i = 0; i < segments; i++) {
        const x1 = (i / segments) * w;
        const x2 = ((i + 1) / segments) * w;
        const y1 = midY - getY(x1);
        const y2 = midY - getY(x2);

        const colorT = i / segments;
        ctx.strokeStyle = waveGradientColor(colorT);
        ctx.lineWidth = WAVE_THICKNESS;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }

      // ── Glow effect on wave ──
      ctx.save();
      ctx.globalAlpha = 0.15;
      ctx.filter = 'blur(6px)';
      for (let i = 0; i < segments; i++) {
        const x1 = (i / segments) * w;
        const x2 = ((i + 1) / segments) * w;
        const y1 = midY - getY(x1);
        const y2 = midY - getY(x2);
        ctx.strokeStyle = waveGradientColor(i / segments);
        ctx.lineWidth = 8;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
      ctx.restore();

      // ── Beads / Particles ──
      if (showParticles) {
        for (let bx = BEAD_SPACING; bx < w; bx += BEAD_SPACING) {
          const by = midY - getY(bx);
          const displacement = getY(bx);
          const normalizedDisp = Math.abs(displacement) / amplitude;

          // Particle glow
          const glowRadius = BEAD_RADIUS + 4 + normalizedDisp * 6;
          const glowGrad = ctx.createRadialGradient(bx, by, 0, bx, by, glowRadius);
          glowGrad.addColorStop(0, `rgba(168, 85, 247, ${0.3 + normalizedDisp * 0.4})`);
          glowGrad.addColorStop(1, 'rgba(168, 85, 247, 0)');
          ctx.fillStyle = glowGrad;
          ctx.beginPath();
          ctx.arc(bx, by, glowRadius, 0, 2 * Math.PI);
          ctx.fill();

          // Particle dot
          const particleGrad = ctx.createRadialGradient(bx - 1, by - 1, 0, bx, by, BEAD_RADIUS);
          particleGrad.addColorStop(0, '#ffffff');
          particleGrad.addColorStop(0.4, `rgb(${180 + normalizedDisp * 75}, ${160 + normalizedDisp * 40}, 255)`);
          particleGrad.addColorStop(1, 'rgba(139, 92, 246, 0.8)');
          ctx.fillStyle = particleGrad;
          ctx.beginPath();
          ctx.arc(bx, by, BEAD_RADIUS, 0, 2 * Math.PI);
          ctx.fill();

          // Vertical motion trail
          ctx.strokeStyle = `rgba(168, 85, 247, ${0.1 + normalizedDisp * 0.15})`;
          ctx.lineWidth = 1;
          ctx.setLineDash([2, 3]);
          ctx.beginPath();
          ctx.moveTo(bx, midY - amplitude - 5);
          ctx.lineTo(bx, midY + amplitude + 5);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      // ── Standing wave: show nodes and antinodes ──
      if (standingWave) {
        for (let n = 0; n * (wavelength / 2) < w; n++) {
          const nodeX = n * (wavelength / 2);
          // Node marker
          ctx.fillStyle = 'rgba(239, 68, 68, 0.8)';
          ctx.beginPath();
          ctx.arc(nodeX, midY, 4, 0, 2 * Math.PI);
          ctx.fill();
          ctx.fillStyle = 'rgba(239, 68, 68, 0.6)';
          ctx.font = 'bold 9px system-ui';
          ctx.textAlign = 'center';
          ctx.fillText('N', nodeX, midY + 14);

          // Antinode marker (midpoint between nodes)
          if ((n + 0.5) * (wavelength / 2) < w) {
            const antiX = (n + 0.5) * (wavelength / 2);
            ctx.fillStyle = 'rgba(34, 197, 94, 0.6)';
            ctx.beginPath();
            ctx.arc(antiX, midY - amplitude * 0.5 * Math.abs(Math.cos(omega * t)), 3, 0, 2 * Math.PI);
            ctx.fill();
            ctx.fillStyle = 'rgba(34, 197, 94, 0.6)';
            ctx.font = 'bold 9px system-ui';
            ctx.textAlign = 'center';
            ctx.fillText('AN', antiX, midY + 14);
          }
        }
      }

      // ── Wavelength annotation ──
      if (!pulseState.active) {
        // Find a full crest-to-crest span near center
        const annotY = midY + amplitude + 35;
        const lambdaStartX = w * 0.2;
        const lambdaEndX = lambdaStartX + wavelength;

        if (lambdaEndX < w - 20) {
          // Bracket lines
          ctx.strokeStyle = 'rgba(250, 204, 21, 0.8)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          // Left vertical tick
          ctx.moveTo(lambdaStartX, annotY - 6);
          ctx.lineTo(lambdaStartX, annotY + 6);
          // Horizontal line
          ctx.moveTo(lambdaStartX, annotY);
          ctx.lineTo(lambdaEndX, annotY);
          // Right vertical tick
          ctx.moveTo(lambdaEndX, annotY - 6);
          ctx.lineTo(lambdaEndX, annotY + 6);
          ctx.stroke();

          // Arrow heads
          ctx.fillStyle = 'rgba(250, 204, 21, 0.8)';
          // Left arrow
          ctx.beginPath();
          ctx.moveTo(lambdaStartX, annotY);
          ctx.lineTo(lambdaStartX + 6, annotY - 3);
          ctx.lineTo(lambdaStartX + 6, annotY + 3);
          ctx.fill();
          // Right arrow
          ctx.beginPath();
          ctx.moveTo(lambdaEndX, annotY);
          ctx.lineTo(lambdaEndX - 6, annotY - 3);
          ctx.lineTo(lambdaEndX - 6, annotY + 3);
          ctx.fill();

          // Lambda label
          ctx.fillStyle = 'rgba(250, 204, 21, 0.95)';
          ctx.font = 'bold 13px system-ui';
          ctx.textAlign = 'center';
          ctx.fillText(`\u03BB = ${wavelength.toFixed(0)} px`, (lambdaStartX + lambdaEndX) / 2, annotY - 10);
        }
      }

      // ── Amplitude annotation ──
      {
        const ampX = 35;
        const ampTop = midY - amplitude;
        const ampBot = midY;

        // Vertical arrow line
        ctx.strokeStyle = 'rgba(52, 211, 153, 0.8)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(ampX, ampTop);
        ctx.lineTo(ampX, ampBot);
        ctx.stroke();

        // Top arrow head
        ctx.fillStyle = 'rgba(52, 211, 153, 0.8)';
        ctx.beginPath();
        ctx.moveTo(ampX, ampTop);
        ctx.lineTo(ampX - 3, ampTop + 6);
        ctx.lineTo(ampX + 3, ampTop + 6);
        ctx.fill();

        // Bottom arrow head
        ctx.beginPath();
        ctx.moveTo(ampX, ampBot);
        ctx.lineTo(ampX - 3, ampBot - 6);
        ctx.lineTo(ampX + 3, ampBot - 6);
        ctx.fill();

        // Label
        ctx.fillStyle = 'rgba(52, 211, 153, 0.95)';
        ctx.font = 'bold 11px system-ui';
        ctx.textAlign = 'center';
        ctx.save();
        ctx.translate(ampX - 14, (ampTop + ampBot) / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(`A = ${amplitude} px`, 0, 0);
        ctx.restore();
      }

      // ── Formula label (top right) ──
      {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.font = 'bold 14px system-ui';
        ctx.textAlign = 'right';
        ctx.fillText(`\u03BB = v / f`, w - 16, 24);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
        ctx.font = '12px system-ui';
        ctx.fillText(`${waveSpeed} / ${frequency.toFixed(1)} = ${wavelength.toFixed(0)} px`, w - 16, 42);
      }

      // ── Wave direction arrow (if not standing) ──
      if (!standingWave && !pulseState.active) {
        const arrowY = 24;
        const arrowX = w * 0.45;
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.font = '11px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText('wave direction \u2192', arrowX, arrowY);
      }

      animRef.current = requestAnimationFrame(draw);
    };

    animRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(animRef.current);
      resizeObserver.disconnect();
    };
  }, [frequency, amplitude, waveSpeed, wavelength, showParticles, standingWave, pulseState, isPaused]);

  const sliders: SliderConfig[] = [
    { label: 'Frequency', min: 0.5, max: 5, step: 0.1, value: frequency, unit: 'Hz', symbol: 'f' },
    { label: 'Amplitude', min: 10, max: 80, step: 1, value: amplitude, unit: 'px', symbol: 'A' },
    { label: 'Wave Speed', min: 50, max: 300, step: 5, value: waveSpeed, unit: 'px/s', symbol: 'v' },
  ];

  const setters = [setFrequency, setAmplitude, setWaveSpeed];

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        fontFamily: "'Sora', 'Plus Jakarta Sans', system-ui, sans-serif",
        background: '#1a1a2e',
        borderRadius: '16px',
        overflow: 'hidden',
        border: '1px solid rgba(99,102,241,0.2)',
        boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
      }}
    >
      {/* Title bar */}
      <div
        style={{
          padding: '12px 18px',
          background: 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 50%, #a855f7 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ color: '#fff', fontWeight: 700, fontSize: '15px', letterSpacing: '-0.01em' }}>
          Transverse Wave on a String
        </div>
        <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: '11px' }}>
          CBSE Physics
        </div>
      </div>

      {/* Canvas */}
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="Transverse wave on a string simulation showing wave propagation with adjustable amplitude, frequency, and speed"
        style={{ display: 'block', width: '100%', height: `${CANVAS_HEIGHT}px`, cursor: 'crosshair' }}
      />

      {/* Controls */}
      <div style={{ padding: '14px 18px 18px', background: '#16213e' }}>
        {/* Sliders */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px', marginBottom: '14px' }}>
          {sliders.map((s, i) => (
            <div key={s.label}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '6px' }}>
                <label style={{ color: 'rgba(255,255,255,0.7)', fontSize: '12px', fontWeight: 600 }}>
                  {s.symbol} &mdash; {s.label}
                </label>
                <span style={{ color: '#a5b4fc', fontSize: '13px', fontWeight: 700, fontFamily: 'monospace' }}>
                  {s.value % 1 === 0 ? s.value : s.value.toFixed(1)} {s.unit}
                </span>
              </div>
              <input
                type="range"
                min={s.min}
                max={s.max}
                step={s.step}
                value={s.value}
                onChange={(e) => setters[i](parseFloat(e.target.value))}
                aria-label={`${s.label} slider, ${s.value % 1 === 0 ? s.value : s.value.toFixed(1)} ${s.unit}, range ${s.min} to ${s.max}`}
                style={{
                  width: '100%',
                  height: '6px',
                  borderRadius: '3px',
                  background: `linear-gradient(to right, #6366f1 0%, #a855f7 ${((s.value - s.min) / (s.max - s.min)) * 100}%, #334155 ${((s.value - s.min) / (s.max - s.min)) * 100}%)`,
                  appearance: 'none',
                  WebkitAppearance: 'none',
                  outline: 'none',
                  cursor: 'pointer',
                }}
              />
            </div>
          ))}
        </div>

        {/* Computed wavelength display */}
        <div
          style={{
            background: 'rgba(250, 204, 21, 0.08)',
            border: '1px solid rgba(250, 204, 21, 0.25)',
            borderRadius: '10px',
            padding: '8px 14px',
            marginBottom: '14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
          }}
        >
          <span style={{ color: 'rgba(250, 204, 21, 0.9)', fontSize: '14px', fontWeight: 700, fontFamily: 'monospace' }}>
            {'\u03BB'} = v / f = {waveSpeed} / {frequency.toFixed(1)} = {wavelength.toFixed(1)} px
          </span>
        </div>

        {/* Buttons and toggles */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
          <ToggleButton
            active={showParticles}
            onClick={() => setShowParticles(!showParticles)}
            label="Show Particles"
            color="#a855f7"
          />
          <ToggleButton
            active={standingWave}
            onClick={() => { setStandingWave(!standingWave); setPulseState({ active: false, startTime: 0 }); }}
            label="Standing Wave"
            color="#3b82f6"
          />
          <button
            onClick={sendPulse}
            aria-label="Send a single wave pulse"
            style={{
              padding: '7px 16px',
              borderRadius: '8px',
              border: '1px solid rgba(250, 204, 21, 0.4)',
              background: 'rgba(250, 204, 21, 0.1)',
              color: 'rgba(250, 204, 21, 0.95)',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
              transition: 'all 0.15s',
            }}
          >
            Pulse
          </button>
          <button
            onClick={() => setIsPaused(!isPaused)}
            aria-label={isPaused ? 'Play wave animation' : 'Pause wave animation'}
            style={{
              padding: '7px 16px',
              borderRadius: '8px',
              border: '1px solid rgba(255,255,255,0.2)',
              background: isPaused ? 'rgba(52, 211, 153, 0.15)' : 'rgba(255,255,255,0.06)',
              color: isPaused ? 'rgba(52, 211, 153, 0.95)' : 'rgba(255,255,255,0.7)',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
              transition: 'all 0.15s',
            }}
          >
            {isPaused ? '\u25B6 Play' : '\u23F8 Pause'}
          </button>
          <button
            onClick={() => { timeRef.current = 0; setPulseState({ active: false, startTime: 0 }); }}
            aria-label="Reset wave simulation"
            style={{
              padding: '7px 16px',
              borderRadius: '8px',
              border: '1px solid rgba(255,255,255,0.15)',
              background: 'rgba(255,255,255,0.04)',
              color: 'rgba(255,255,255,0.5)',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
              transition: 'all 0.15s',
            }}
          >
            Reset
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Toggle Button sub-component ── */
function ToggleButton({
  active,
  onClick,
  label,
  color,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  color: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={`Toggle ${label}, currently ${active ? 'on' : 'off'}`}
      style={{
        padding: '7px 16px',
        borderRadius: '8px',
        border: `1px solid ${active ? color : 'rgba(255,255,255,0.15)'}`,
        background: active ? `${color}22` : 'rgba(255,255,255,0.04)',
        color: active ? color : 'rgba(255,255,255,0.5)',
        fontSize: '12px',
        fontWeight: 600,
        cursor: 'pointer',
        fontFamily: 'inherit',
        transition: 'all 0.15s',
      }}
    >
      {active ? '\u25C9' : '\u25CB'} {label}
    </button>
  );
}
