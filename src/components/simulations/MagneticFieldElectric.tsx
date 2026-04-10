'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

/**
 * Magnetic Effects of Electric Current Simulation
 *
 * CBSE Class 10, Chapter 13: Magnetic Effects of Electric Current
 * Board Exam Relevance: HIGH (3-5 marks)
 *
 * Demonstrates:
 * 1. Circular magnetic field lines around a straight current-carrying conductor
 * 2. Right-hand thumb rule
 * 3. Solenoid producing uniform magnetic field
 * 4. Current direction reversal affecting field direction
 * 5. Current strength affecting field line density
 */

type Mode = 'wire' | 'solenoid';

export default function MagneticFieldElectric() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState({ w: 500, h: 400 });
  const [mode, setMode] = useState<Mode>('wire');
  const [currentDirection, setCurrentDirection] = useState<'up' | 'down'>('up');
  const [currentStrength, setCurrentStrength] = useState(5); // 1-10
  const [showRule, setShowRule] = useState(false);
  const animRef = useRef<number>(0);
  const phaseRef = useRef(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(entries => {
      for (const e of entries) {
        const w = e.contentRect.width;
        setCanvasSize({ w, h: Math.min(400, w * 0.8) });
      }
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

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

    if (mode === 'wire') {
      drawStraightWire(ctx, w, h);
    } else {
      drawSolenoid(ctx, w, h);
    }
  }, [mode, currentDirection, currentStrength, showRule]);

  function drawStraightWire(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const midX = w * 0.45;
    const midY = h / 2;
    const isUp = currentDirection === 'up';
    const numRings = Math.floor(2 + currentStrength * 0.6); // 2-8 rings
    const clockwise = isUp; // right-hand rule: current up = clockwise when viewed from above

    // Wire (vertical, going into/out of page representation — cross-section)
    const wireRadius = 12;

    // Magnetic field lines (concentric circles)
    for (let i = 1; i <= numRings; i++) {
      const radius = 25 + i * (Math.min(w, h) * 0.05);
      const alpha = 1 - (i / (numRings + 2)) * 0.6;

      ctx.strokeStyle = `rgba(59, 130, 246, ${alpha})`;
      ctx.lineWidth = Math.max(1, 2.5 - i * 0.2);
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(midX, midY, radius, 0, Math.PI * 2);
      ctx.stroke();

      // Direction arrows on circles
      const numArrows = Math.max(2, Math.floor(4 + i * 0.5));
      for (let a = 0; a < numArrows; a++) {
        const angle = (a / numArrows) * Math.PI * 2 + phaseRef.current;
        const arrowAngle = clockwise ? angle + Math.PI / 2 : angle - Math.PI / 2;
        const ax = midX + radius * Math.cos(angle);
        const ay = midY + radius * Math.sin(angle);
        const arrowSize = 6;

        ctx.fillStyle = `rgba(59, 130, 246, ${alpha})`;
        ctx.beginPath();
        ctx.moveTo(
          ax + arrowSize * Math.cos(arrowAngle),
          ay + arrowSize * Math.sin(arrowAngle)
        );
        ctx.lineTo(
          ax + arrowSize * Math.cos(arrowAngle + 2.3),
          ay + arrowSize * Math.sin(arrowAngle + 2.3)
        );
        ctx.lineTo(
          ax + arrowSize * Math.cos(arrowAngle - 2.3),
          ay + arrowSize * Math.sin(arrowAngle - 2.3)
        );
        ctx.closePath();
        ctx.fill();
      }
    }

    // Compass needles (small arrows showing field direction)
    const compassPositions = [
      { angle: 0, r: 60 },
      { angle: Math.PI / 2, r: 60 },
      { angle: Math.PI, r: 60 },
      { angle: -Math.PI / 2, r: 60 },
      { angle: Math.PI / 4, r: 100 },
      { angle: 3 * Math.PI / 4, r: 100 },
      { angle: -Math.PI / 4, r: 100 },
      { angle: -3 * Math.PI / 4, r: 100 },
    ];

    compassPositions.forEach(cp => {
      const cx = midX + cp.r * Math.cos(cp.angle);
      const cy = midY + cp.r * Math.sin(cp.angle);
      const tangentAngle = clockwise ? cp.angle + Math.PI / 2 : cp.angle - Math.PI / 2;
      const needleLen = 10;

      // Compass circle
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, needleLen + 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Red end (N)
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + needleLen * Math.cos(tangentAngle), cy + needleLen * Math.sin(tangentAngle));
      ctx.stroke();

      // Blue end (S)
      ctx.strokeStyle = '#3b82f6';
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx - needleLen * Math.cos(tangentAngle), cy - needleLen * Math.sin(tangentAngle));
      ctx.stroke();

      // Center dot
      ctx.fillStyle = '#334155';
      ctx.beginPath();
      ctx.arc(cx, cy, 2, 0, Math.PI * 2);
      ctx.fill();
    });

    // Wire cross-section
    ctx.fillStyle = '#f59e0b';
    ctx.strokeStyle = '#b45309';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(midX, midY, wireRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Current direction symbol (dot = towards you, cross = away)
    ctx.fillStyle = '#1e293b';
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 3;
    if (isUp) {
      // Dot (current towards viewer)
      ctx.beginPath();
      ctx.arc(midX, midY, 4, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Cross (current away from viewer)
      const cs = 7;
      ctx.beginPath();
      ctx.moveTo(midX - cs, midY - cs);
      ctx.lineTo(midX + cs, midY + cs);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(midX + cs, midY - cs);
      ctx.lineTo(midX - cs, midY + cs);
      ctx.stroke();
    }

    // Current direction label
    ctx.fillStyle = '#f59e0b';
    ctx.font = 'bold 11px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(`Current: ${isUp ? 'Out of page (\u2299)' : 'Into page (\u2297)'}`, midX, h - 12);

    // Labels
    ctx.fillStyle = '#3b82f6';
    ctx.font = '10px system-ui';
    ctx.textAlign = 'left';
    ctx.fillText('Magnetic field lines (B)', 8, 15);

    ctx.fillStyle = '#ef4444';
    ctx.fillText('\u25CF N (red)', 8, h - 28);
    ctx.fillStyle = '#3b82f6';
    ctx.fillText('\u25CF S (blue)', 8, h - 14);

    // Field direction label
    ctx.fillStyle = '#334155';
    ctx.font = 'bold 10px system-ui';
    ctx.textAlign = 'right';
    ctx.fillText(`Field: ${clockwise ? 'Clockwise' : 'Anti-clockwise'}`, w - 8, 15);
  }

  function drawSolenoid(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const midY = h / 2;
    const solLeft = w * 0.2;
    const solRight = w * 0.8;
    const solHeight = h * 0.3;
    const numCoils = Math.floor(4 + currentStrength * 0.4); // 4-8 coils
    const isUp = currentDirection === 'up';

    // Solenoid coils
    const coilWidth = (solRight - solLeft) / numCoils;
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 3;

    for (let i = 0; i < numCoils; i++) {
      const cx = solLeft + i * coilWidth + coilWidth / 2;

      // Draw coil arc (front half — visible)
      ctx.beginPath();
      ctx.ellipse(cx, midY, coilWidth / 2, solHeight / 2, 0, -Math.PI / 2, Math.PI / 2);
      ctx.stroke();

      // Draw coil arc (back half — dashed)
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = 'rgba(245,158,11,0.4)';
      ctx.beginPath();
      ctx.ellipse(cx, midY, coilWidth / 2, solHeight / 2, 0, Math.PI / 2, -Math.PI / 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = '#f59e0b';
    }

    // Magnetic field lines inside solenoid (uniform, horizontal)
    const numLines = Math.floor(2 + currentStrength * 0.3);
    const lineSpacing = solHeight / (numLines + 1);

    for (let i = 1; i <= numLines; i++) {
      const ly = midY - solHeight / 2 + i * lineSpacing;
      const alpha = 0.6 + (i / numLines) * 0.3;

      ctx.strokeStyle = `rgba(59, 130, 246, ${alpha})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(solLeft - 30, ly);
      ctx.lineTo(solRight + 30, ly);
      ctx.stroke();

      // Arrow direction
      const arrowDir = isUp ? 1 : -1;
      const arrowX = (solLeft + solRight) / 2;
      const arrowSize = 7;
      ctx.fillStyle = `rgba(59, 130, 246, ${alpha})`;
      ctx.beginPath();
      ctx.moveTo(arrowX + arrowSize * arrowDir, ly);
      ctx.lineTo(arrowX - arrowSize * arrowDir, ly - arrowSize * 0.6);
      ctx.lineTo(arrowX - arrowSize * arrowDir, ly + arrowSize * 0.6);
      ctx.closePath();
      ctx.fill();
    }

    // External field lines (curved, from N to S)
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.3)';
    ctx.lineWidth = 1.5;
    const nPole = isUp ? solRight : solLeft;
    const sPole = isUp ? solLeft : solRight;
    const curves = [40, 70, 100];

    curves.forEach(offset => {
      ctx.beginPath();
      ctx.moveTo(nPole + 30, midY);
      ctx.bezierCurveTo(
        nPole + 30 + offset, midY - offset * 1.5,
        sPole - 30 - offset, midY - offset * 1.5,
        sPole - 30, midY
      );
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(nPole + 30, midY);
      ctx.bezierCurveTo(
        nPole + 30 + offset, midY + offset * 1.5,
        sPole - 30 - offset, midY + offset * 1.5,
        sPole - 30, midY
      );
      ctx.stroke();
    });

    // N and S pole labels
    ctx.font = 'bold 14px system-ui';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ef4444';
    ctx.fillText('N', nPole + 40, midY + 5);
    ctx.fillStyle = '#3b82f6';
    ctx.fillText('S', sPole - 40, midY + 5);

    // Current direction arrows on wire
    ctx.fillStyle = '#b45309';
    ctx.font = '9px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(`I ${isUp ? '\u2192' : '\u2190'}`, (solLeft + solRight) / 2, midY - solHeight / 2 - 8);
    ctx.fillText(`I ${isUp ? '\u2190' : '\u2192'}`, (solLeft + solRight) / 2, midY + solHeight / 2 + 16);

    // Labels
    ctx.fillStyle = '#334155';
    ctx.font = 'bold 10px system-ui';
    ctx.textAlign = 'left';
    ctx.fillText('Uniform field inside solenoid', 8, 15);

    ctx.fillStyle = '#64748b';
    ctx.font = '10px system-ui';
    ctx.fillText('Like a bar magnet!', 8, 30);

    ctx.textAlign = 'center';
    ctx.fillStyle = '#f59e0b';
    ctx.font = 'bold 10px system-ui';
    ctx.fillText(`Current: ${isUp ? 'Upward (front)' : 'Downward (front)'}`, w / 2, h - 10);
  }

  // Animate compass rotation gently
  useEffect(() => {
    const tick = () => {
      phaseRef.current += 0.003;
      draw();
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRef.current);
  }, [draw]);

  return (
    <div ref={containerRef} style={{
      fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
      maxWidth: 640,
      margin: '0 auto',
      padding: '16px',
    }}>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: 12 }}>
        <div style={{
          fontSize: 'clamp(1.1rem, 3vw, 1.5rem)',
          fontWeight: 800,
          color: '#1e293b',
        }}>
          Magnetic Effects of Electric Current
        </div>
        <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
          {mode === 'wire'
            ? 'Circular magnetic field around a straight conductor'
            : 'Uniform magnetic field inside a solenoid'}
        </div>
      </div>

      {/* Mode toggle */}
      <div style={{
        display: 'flex',
        gap: 0,
        borderRadius: 10,
        overflow: 'hidden',
        border: '1px solid #e2e8f0',
        marginBottom: 12,
        maxWidth: 340,
        margin: '0 auto 12px',
      }}>
        {(['wire', 'solenoid'] as Mode[]).map(m => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            style={{
              flex: 1,
              padding: '10px 14px',
              background: mode === m ? '#3b82f6' : '#fff',
              color: mode === m ? '#fff' : '#334155',
              border: 'none',
              cursor: 'pointer',
              fontSize: '0.82rem',
              fontWeight: 700,
              transition: 'all 0.2s ease',
              minHeight: '44px',
            }}
            aria-label={`Switch to ${m === 'wire' ? 'straight wire' : 'solenoid'} mode`}
          >
            {m === 'wire' ? 'Straight Wire' : 'Solenoid'}
          </button>
        ))}
      </div>

      {/* Canvas */}
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={mode === 'wire'
          ? `Magnetic field around a straight current-carrying wire, current ${currentDirection}, strength ${currentStrength}`
          : `Magnetic field of a solenoid, current ${currentDirection}, strength ${currentStrength}`}
        style={{
          width: '100%',
          height: canvasSize.h,
          borderRadius: 10,
          border: '1px solid #e2e8f0',
          background: '#f8fafc',
        }}
      />

      {/* Controls */}
      <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
        {/* Current strength slider */}
        <div style={{
          padding: '10px 14px',
          background: '#fffbeb',
          borderRadius: 8,
          border: '1px solid #fde68a',
        }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#92400e', marginBottom: 4 }}>
            Current Strength (I)
          </div>
          <input
            type="range"
            min={1}
            max={10}
            step={1}
            value={currentStrength}
            onChange={e => setCurrentStrength(Number(e.target.value))}
            aria-label={`Current strength slider, value ${currentStrength}`}
            style={{ width: '100%', accentColor: '#f59e0b' }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: '#94a3b8' }}>
            <span>Low</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#1e293b' }}>{currentStrength} A</span>
            <span>High</span>
          </div>
        </div>

        {/* Current direction + Rule toggles */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <button
            type="button"
            onClick={() => setCurrentDirection(d => d === 'up' ? 'down' : 'up')}
            style={{
              padding: '10px 14px',
              background: '#f0fdf4',
              borderRadius: 8,
              border: '1px solid #bbf7d0',
              cursor: 'pointer',
              fontSize: '0.82rem',
              fontWeight: 700,
              color: '#166534',
              transition: 'all 0.2s ease',
              minHeight: '44px',
            }}
            aria-label="Toggle current direction"
          >
            Reverse Current {currentDirection === 'up' ? '\u2191' : '\u2193'}
          </button>

          <button
            type="button"
            onClick={() => setShowRule(r => !r)}
            style={{
              padding: '10px 14px',
              background: showRule ? 'rgba(99,102,241,0.15)' : '#f5f3ff',
              borderRadius: 8,
              border: `1px solid ${showRule ? 'rgba(99,102,241,0.4)' : '#ddd6fe'}`,
              cursor: 'pointer',
              fontSize: '0.82rem',
              fontWeight: 700,
              color: '#4c1d95',
              transition: 'all 0.2s ease',
              minHeight: '44px',
            }}
            aria-label="Toggle right-hand thumb rule"
          >
            {showRule ? 'Hide' : 'Show'} Rule
          </button>
        </div>
      </div>

      {/* Right-hand thumb rule explanation */}
      {showRule && (
        <div style={{
          marginTop: 12,
          padding: '14px 16px',
          background: 'linear-gradient(135deg, rgba(99,102,241,0.1), rgba(168,85,247,0.1))',
          borderRadius: 12,
          border: '1px solid rgba(99,102,241,0.2)',
        }}>
          <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#6366f1', marginBottom: 8 }}>
            {mode === 'wire' ? 'Right-Hand Thumb Rule' : 'Right-Hand Solenoid Rule'}
          </div>
          {mode === 'wire' ? (
            <div style={{ fontSize: '0.78rem', color: '#334155', lineHeight: 1.7 }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <div style={{
                  fontSize: '2.5rem',
                  lineHeight: 1,
                  flexShrink: 0,
                }}>
                  {'\uD83D\uDC4D'}
                </div>
                <div>
                  <p style={{ margin: '0 0 6px' }}>
                    Hold the conductor in your <strong>right hand</strong> with the <strong>thumb pointing in the direction of current</strong>.
                  </p>
                  <p style={{ margin: 0 }}>
                    Your <strong>fingers curl</strong> in the direction of the <strong>magnetic field lines</strong>.
                  </p>
                </div>
              </div>
              <div style={{
                marginTop: 10,
                padding: '8px 12px',
                background: 'rgba(255,255,255,0.6)',
                borderRadius: 8,
                fontSize: '0.75rem',
                color: '#4c1d95',
                fontWeight: 600,
              }}>
                Current {currentDirection === 'up' ? 'upward (out of page)' : 'downward (into page)'} {'\u2192'} Field is {currentDirection === 'up' ? 'clockwise' : 'anti-clockwise'}
              </div>
            </div>
          ) : (
            <div style={{ fontSize: '0.78rem', color: '#334155', lineHeight: 1.7 }}>
              <p style={{ margin: '0 0 6px' }}>
                Curl your <strong>right hand fingers</strong> in the direction of <strong>current</strong> flow through the coils.
              </p>
              <p style={{ margin: 0 }}>
                Your <strong>thumb</strong> points towards the <strong>North pole</strong> of the solenoid.
              </p>
              <div style={{
                marginTop: 10,
                padding: '8px 12px',
                background: 'rgba(255,255,255,0.6)',
                borderRadius: 8,
                fontSize: '0.75rem',
                color: '#4c1d95',
                fontWeight: 600,
              }}>
                The field <strong>inside</strong> is uniform and parallel. <strong>Outside</strong>, it is like a bar magnet.
              </div>
            </div>
          )}
        </div>
      )}

      {/* Info panel */}
      <div style={{
        marginTop: 12,
        padding: '12px 14px',
        background: '#f0f9ff',
        borderRadius: 8,
        border: '1px solid #bae6fd',
      }}>
        <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#0c4a6e', marginBottom: 6 }}>
          Observations
        </div>
        <ul style={{
          margin: 0,
          paddingLeft: '16px',
          fontSize: '0.78rem',
          color: '#334155',
          lineHeight: 1.8,
        }}>
          {mode === 'wire' ? (
            <>
              <li>Magnetic field lines form <strong>concentric circles</strong> around the wire</li>
              <li>Field strength <strong>decreases</strong> with distance from the wire</li>
              <li>Increasing current = <strong>more field lines</strong> (denser field)</li>
              <li>Reversing current <strong>reverses</strong> the field direction</li>
              <li>Compass needles align <strong>tangent</strong> to field lines</li>
            </>
          ) : (
            <>
              <li>Field inside solenoid is <strong>uniform</strong> (parallel, equally spaced lines)</li>
              <li>Solenoid behaves like a <strong>bar magnet</strong> with N and S poles</li>
              <li>Increasing current = <strong>stronger</strong> magnetic field</li>
              <li>Reversing current <strong>reverses</strong> N and S poles</li>
              <li>More turns = <strong>stronger</strong> field (like increasing current)</li>
            </>
          )}
        </ul>
      </div>

      {/* Footer */}
      <div style={{
        textAlign: 'center',
        marginTop: 16,
        fontSize: '0.7rem',
        color: '#94a3b8',
      }}>
        CBSE Class 10 Physics &mdash; Ch 13: Magnetic Effects of Electric Current
      </div>
    </div>
  );
}
