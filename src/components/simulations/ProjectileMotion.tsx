'use client';
import { useRef, useEffect, useState, useCallback } from 'react';

const G = 9.8;
const GROUND_HEIGHT = 50;
const CANNON_X = 60;
const CANNON_Y_OFFSET = 10;
const TRAIL_DOT_INTERVAL = 3;

interface Projectile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  time: number;
  trail: Array<{ x: number; y: number }>;
  active: boolean;
  landed: boolean;
  angle: number;
  v0: number;
  maxHeight: number;
  maxHeightX: number;
  finalRange: number;
  totalTime: number;
  color: string;
  trailFrame: number;
}

interface Target {
  x: number;
  range: number;
  hit: boolean;
}

const TRAIL_COLORS = [
  'rgba(255,120,50,0.5)',
  'rgba(100,180,255,0.4)',
  'rgba(120,220,120,0.4)',
  'rgba(220,120,220,0.4)',
  'rgba(220,220,100,0.4)',
];

function calcScale(v0: number, angle: number, canvasWidth: number, canvasHeight: number): number {
  const angleRad = (angle * Math.PI) / 180;
  const range = (v0 * v0 * Math.sin(2 * angleRad)) / G;
  const maxH = (v0 * v0 * Math.sin(angleRad) * Math.sin(angleRad)) / (2 * G);
  const usableWidth = canvasWidth - CANNON_X - 40;
  const usableHeight = canvasHeight - GROUND_HEIGHT - 40;
  const scaleX = range > 0 ? usableWidth / range : 1;
  const scaleY = maxH > 0 ? usableHeight / maxH : 1;
  return Math.min(scaleX, scaleY, 8);
}

function bestScale(v0: number, canvasWidth: number, canvasHeight: number): number {
  const angleRad = (45 * Math.PI) / 180;
  const range = (v0 * v0 * Math.sin(2 * angleRad)) / G;
  const maxH = (v0 * v0 * Math.sin(angleRad) * Math.sin(angleRad)) / (2 * G);
  const usableWidth = canvasWidth - CANNON_X - 40;
  const usableHeight = canvasHeight - GROUND_HEIGHT - 40;
  const scaleX = range > 0 ? usableWidth / range : 1;
  const scaleY = maxH > 0 ? usableHeight / maxH : 1;
  return Math.min(scaleX, scaleY, 8);
}

export default function ProjectileMotion() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animFrameRef = useRef<number>(0);
  const projectilesRef = useRef<Projectile[]>([]);
  const activeIndexRef = useRef<number>(-1);
  const scaleRef = useRef<number>(3);
  const targetRef = useRef<Target>({ x: 0, range: 0, hit: false });
  const challengeActiveRef = useRef<boolean>(false);

  const [angle, setAngle] = useState(45);
  const [velocity, setVelocity] = useState(30);
  const [compareMode, setCompareMode] = useState(false);
  const [liveStats, setLiveStats] = useState({
    height: 0,
    distance: 0,
    time: 0,
    currentV: 0,
    vx: 0,
    vy: 0,
  });
  const [landedStats, setLandedStats] = useState<{
    range: number;
    maxHeight: number;
    totalTime: number;
  } | null>(null);
  const [challengeMsg, setChallengeMsg] = useState('');
  const [isFlying, setIsFlying] = useState(false);

  const toCanvasX = useCallback(
    (physX: number, canvasW: number) => CANNON_X + physX * scaleRef.current,
    []
  );

  const toCanvasY = useCallback(
    (physY: number, canvasH: number) => canvasH - GROUND_HEIGHT - physY * scaleRef.current,
    []
  );

  const drawArrow = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      fromX: number,
      fromY: number,
      toX: number,
      toY: number,
      color: string,
      label: string
    ) => {
      const headLen = 8;
      const dx = toX - fromX;
      const dy = toY - fromY;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len < 2) return;
      const ang = Math.atan2(dy, dx);

      ctx.save();
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(fromX, fromY);
      ctx.lineTo(toX, toY);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(toX, toY);
      ctx.lineTo(
        toX - headLen * Math.cos(ang - Math.PI / 6),
        toY - headLen * Math.sin(ang - Math.PI / 6)
      );
      ctx.lineTo(
        toX - headLen * Math.cos(ang + Math.PI / 6),
        toY - headLen * Math.sin(ang + Math.PI / 6)
      );
      ctx.closePath();
      ctx.fill();

      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.fillText(label, toX + 4, toY - 4);
      ctx.restore();
    },
    []
  );

  const launch = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const w = canvas.width;
    const h = canvas.height;

    if (!compareMode) {
      projectilesRef.current = [];
    }

    const scale = calcScale(velocity, angle, w, h);
    const globalScale = bestScale(velocity, w, h);
    scaleRef.current = compareMode
      ? Math.min(globalScale, ...projectilesRef.current.map((p) => calcScale(p.v0, p.angle, w, h)), scale)
      : scale;

    const angleRad = (angle * Math.PI) / 180;
    const colorIdx = projectilesRef.current.length % TRAIL_COLORS.length;

    const proj: Projectile = {
      x: 0,
      y: 0,
      vx: velocity * Math.cos(angleRad),
      vy: velocity * Math.sin(angleRad),
      time: 0,
      trail: [],
      active: true,
      landed: false,
      angle,
      v0: velocity,
      maxHeight: 0,
      maxHeightX: 0,
      finalRange: 0,
      totalTime: 0,
      color: TRAIL_COLORS[colorIdx],
      trailFrame: 0,
    };

    projectilesRef.current.push(proj);
    activeIndexRef.current = projectilesRef.current.length - 1;
    setLandedStats(null);
    setIsFlying(true);
  }, [angle, velocity, compareMode]);

  const startChallenge = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const minRange = 20;
    const maxRange = (velocity * velocity) / G;
    const targetRange = minRange + Math.random() * (maxRange - minRange) * 0.8;
    const scale = bestScale(velocity, canvas.width, canvas.height);
    scaleRef.current = scale;
    targetRef.current = {
      x: CANNON_X + targetRange * scale,
      range: targetRange,
      hit: false,
    };
    challengeActiveRef.current = true;
    projectilesRef.current = [];
    activeIndexRef.current = -1;
    setLandedStats(null);
    setChallengeMsg(`Hit the target at ${targetRange.toFixed(1)} m! Find the right angle.`);
  }, [velocity]);

  // Animation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resizeCanvas = () => {
      const container = containerRef.current;
      if (!container) return;
      const dpr = window.devicePixelRatio || 1;
      const rect = container.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = 400 * dpr;
      canvas.style.width = rect.width + 'px';
      canvas.style.height = '400px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    const dt = 1 / 60;

    const draw = () => {
      const w = canvas.width / (window.devicePixelRatio || 1);
      const h = canvas.height / (window.devicePixelRatio || 1);
      const scale = scaleRef.current;

      // Sky gradient
      const skyGrad = ctx.createLinearGradient(0, 0, 0, h - GROUND_HEIGHT);
      skyGrad.addColorStop(0, '#87CEEB');
      skyGrad.addColorStop(0.6, '#B0E0FF');
      skyGrad.addColorStop(1, '#D4EFFF');
      ctx.fillStyle = skyGrad;
      ctx.fillRect(0, 0, w, h - GROUND_HEIGHT);

      // Ground
      const groundGrad = ctx.createLinearGradient(0, h - GROUND_HEIGHT, 0, h);
      groundGrad.addColorStop(0, '#4CAF50');
      groundGrad.addColorStop(0.3, '#43A047');
      groundGrad.addColorStop(1, '#2E7D32');
      ctx.fillStyle = groundGrad;
      ctx.fillRect(0, h - GROUND_HEIGHT, w, GROUND_HEIGHT);

      // Grass blades
      ctx.strokeStyle = '#66BB6A';
      ctx.lineWidth = 1;
      for (let gx = 0; gx < w; gx += 12) {
        ctx.beginPath();
        ctx.moveTo(gx, h - GROUND_HEIGHT);
        ctx.lineTo(gx - 2, h - GROUND_HEIGHT - 6);
        ctx.stroke();
      }

      // Grid lines
      ctx.save();
      ctx.strokeStyle = 'rgba(0,0,0,0.08)';
      ctx.lineWidth = 0.5;
      ctx.font = '9px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(0,0,0,0.3)';

      const gridSpacingM = scale > 4 ? 5 : scale > 2 ? 10 : scale > 1 ? 20 : 50;

      for (let m = gridSpacingM; ; m += gridSpacingM) {
        const px = CANNON_X + m * scale;
        if (px > w - 10) break;
        ctx.beginPath();
        ctx.moveTo(px, 0);
        ctx.lineTo(px, h - GROUND_HEIGHT);
        ctx.stroke();
        ctx.fillText(`${m}m`, px + 2, h - GROUND_HEIGHT - 4);
      }

      for (let m = gridSpacingM; ; m += gridSpacingM) {
        const py = h - GROUND_HEIGHT - m * scale;
        if (py < 10) break;
        ctx.beginPath();
        ctx.moveTo(CANNON_X, py);
        ctx.lineTo(w, py);
        ctx.stroke();
        ctx.fillText(`${m}m`, CANNON_X + 4, py - 2);
      }
      ctx.restore();

      // Target
      if (challengeActiveRef.current) {
        const t = targetRef.current;
        const tx = t.x;
        const ty = h - GROUND_HEIGHT;
        ctx.save();
        ctx.fillStyle = t.hit ? '#4CAF50' : '#E53935';
        ctx.beginPath();
        ctx.arc(tx, ty - 8, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(tx, ty - 8, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = t.hit ? '#4CAF50' : '#E53935';
        ctx.beginPath();
        ctx.arc(tx, ty - 8, 2, 0, Math.PI * 2);
        ctx.fill();

        // Flag pole
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(tx, ty - 25);
        ctx.stroke();
        ctx.restore();
      }

      // Cannon
      const cannonBaseX = CANNON_X;
      const cannonBaseY = h - GROUND_HEIGHT - CANNON_Y_OFFSET;
      const angleRad = (angle * Math.PI) / 180;
      const barrelLen = 30;

      // Cannon wheels
      ctx.fillStyle = '#5D4037';
      ctx.beginPath();
      ctx.arc(cannonBaseX - 8, cannonBaseY + 6, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cannonBaseX + 8, cannonBaseY + 6, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#795548';
      ctx.beginPath();
      ctx.arc(cannonBaseX - 8, cannonBaseY + 6, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cannonBaseX + 8, cannonBaseY + 6, 3, 0, Math.PI * 2);
      ctx.fill();

      // Cannon body
      ctx.fillStyle = '#546E7A';
      ctx.beginPath();
      ctx.ellipse(cannonBaseX, cannonBaseY, 14, 10, 0, 0, Math.PI * 2);
      ctx.fill();

      // Cannon barrel (rotates with angle)
      ctx.save();
      ctx.translate(cannonBaseX, cannonBaseY);
      ctx.rotate(-angleRad);
      ctx.fillStyle = '#37474F';
      ctx.beginPath();
      ctx.roundRect(-4, -5, barrelLen, 10, 3);
      ctx.fill();
      // Barrel opening
      ctx.fillStyle = '#263238';
      ctx.beginPath();
      ctx.arc(barrelLen - 2, 0, 6, -Math.PI / 2, Math.PI / 2);
      ctx.fill();
      ctx.restore();

      // Angle arc indicator
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(cannonBaseX, cannonBaseY, 22, -angleRad, 0);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 10px system-ui, sans-serif';
      ctx.fillText(`${angle}\u00B0`, cannonBaseX + 24, cannonBaseY - 4);
      ctx.restore();

      // Draw all projectiles
      const projs = projectilesRef.current;
      const activeIdx = activeIndexRef.current;

      for (let i = 0; i < projs.length; i++) {
        const p = projs[i];
        const isActive = i === activeIdx && p.active;
        const trailColor = isActive ? 'rgba(255,120,50,0.6)' : p.color;

        // Trail dots
        ctx.save();
        for (let j = 0; j < p.trail.length; j++) {
          const t = p.trail[j];
          const cx = CANNON_X + t.x * scale;
          const cy = h - GROUND_HEIGHT - t.y * scale;
          const alpha = isActive
            ? 0.3 + 0.7 * (j / p.trail.length)
            : 0.15 + 0.25 * (j / p.trail.length);
          const radius = isActive ? 2.5 : 1.5;
          ctx.fillStyle = trailColor.replace(/[\d.]+\)$/, `${alpha})`);
          ctx.beginPath();
          ctx.arc(cx, cy, radius, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();

        // Max height dashed line (for landed or active)
        if (p.maxHeight > 0) {
          const mhY = h - GROUND_HEIGHT - p.maxHeight * scale;
          ctx.save();
          ctx.strokeStyle = isActive ? 'rgba(255,80,80,0.5)' : 'rgba(150,150,150,0.3)';
          ctx.lineWidth = 1;
          ctx.setLineDash([5, 5]);
          ctx.beginPath();
          ctx.moveTo(CANNON_X, mhY);
          ctx.lineTo(CANNON_X + (p.landed ? p.finalRange : p.x) * scale + 20, mhY);
          ctx.stroke();
          ctx.setLineDash([]);
          if (isActive || p.landed) {
            ctx.fillStyle = isActive ? 'rgba(255,80,80,0.8)' : 'rgba(150,150,150,0.5)';
            ctx.font = '10px system-ui, sans-serif';
            ctx.fillText(
              `H=${p.maxHeight.toFixed(1)}m`,
              CANNON_X + p.maxHeightX * scale + 5,
              mhY - 4
            );
          }
          ctx.restore();
        }

        // Projectile ball
        if (!p.landed || isActive) {
          const bx = CANNON_X + p.x * scale;
          const by = h - GROUND_HEIGHT - p.y * scale;

          if (isActive && p.active) {
            // Motion blur tail
            const tailLen = 5;
            for (let t = 1; t <= tailLen; t++) {
              const frac = t / tailLen;
              const tx = bx - p.vx * scale * dt * t * 0.5;
              const ty = by + p.vy * scale * dt * t * 0.5;
              ctx.fillStyle = `rgba(255,140,50,${0.3 * (1 - frac)})`;
              ctx.beginPath();
              ctx.arc(tx, ty, 6 * (1 - frac * 0.5), 0, Math.PI * 2);
              ctx.fill();
            }

            // Velocity component arrows
            const arrowScale = 1.5;
            const cvx = p.vx;
            const cvy = p.vy;

            // Vx arrow (horizontal, red)
            drawArrow(
              ctx,
              bx,
              by,
              bx + cvx * arrowScale,
              by,
              '#E53935',
              `Vx=${cvx.toFixed(1)}`
            );

            // Vy arrow (vertical, blue)
            drawArrow(
              ctx,
              bx,
              by,
              bx,
              by - cvy * arrowScale,
              '#1E88E5',
              `Vy=${cvy.toFixed(1)}`
            );
          }

          // Ball glow
          ctx.save();
          ctx.shadowColor = '#FF6D00';
          ctx.shadowBlur = isActive ? 12 : 4;
          ctx.fillStyle = isActive ? '#FF8C00' : 'rgba(255,140,0,0.5)';
          ctx.beginPath();
          ctx.arc(bx, by, isActive ? 6 : 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;

          // Inner highlight
          ctx.fillStyle = 'rgba(255,220,150,0.7)';
          ctx.beginPath();
          ctx.arc(bx - 1.5, by - 1.5, isActive ? 2.5 : 1.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }

        // Landing label for old trajectories in compare mode
        if (p.landed && i !== activeIdx) {
          const lx = CANNON_X + p.finalRange * scale;
          const ly = h - GROUND_HEIGHT;
          ctx.save();
          ctx.fillStyle = p.color.replace(/[\d.]+\)$/, '0.7)');
          ctx.font = '9px system-ui, sans-serif';
          ctx.fillText(`${p.angle}\u00B0 \u2192 ${p.finalRange.toFixed(1)}m`, lx - 15, ly - 10);
          ctx.restore();
        }
      }

      // Update active projectile physics
      if (activeIdx >= 0 && projs[activeIdx] && projs[activeIdx].active) {
        const p = projs[activeIdx];
        p.time += dt;
        p.x = p.vx * p.time;
        const vyNow = p.v0 * Math.sin((p.angle * Math.PI) / 180) - G * p.time;
        p.vy = vyNow;
        p.y = p.v0 * Math.sin((p.angle * Math.PI) / 180) * p.time - 0.5 * G * p.time * p.time;

        if (p.y > p.maxHeight) {
          p.maxHeight = p.y;
          p.maxHeightX = p.x;
        }

        p.trailFrame++;
        if (p.trailFrame % TRAIL_DOT_INTERVAL === 0) {
          p.trail.push({ x: p.x, y: Math.max(p.y, 0) });
        }

        const currentV = Math.sqrt(p.vx * p.vx + p.vy * p.vy);

        setLiveStats({
          height: Math.max(p.y, 0),
          distance: p.x,
          time: p.time,
          currentV,
          vx: p.vx,
          vy: p.vy,
        });

        if (p.y <= 0 && p.time > 0.05) {
          p.y = 0;
          p.active = false;
          p.landed = true;
          p.finalRange = p.x;
          p.totalTime = p.time;
          p.trail.push({ x: p.x, y: 0 });

          setLandedStats({
            range: p.finalRange,
            maxHeight: p.maxHeight,
            totalTime: p.totalTime,
          });
          setIsFlying(false);

          // Challenge check
          if (challengeActiveRef.current) {
            const diff = Math.abs(p.finalRange - targetRef.current.range);
            if (diff < targetRef.current.range * 0.05) {
              targetRef.current.hit = true;
              setChallengeMsg('Bullseye! You nailed it!');
            } else if (diff < targetRef.current.range * 0.15) {
              setChallengeMsg(`Close! Off by ${diff.toFixed(1)}m. Try again!`);
            } else {
              const hint = p.finalRange < targetRef.current.range ? 'Try a bigger angle or more speed!' : 'Try a smaller angle!';
              setChallengeMsg(`Missed by ${diff.toFixed(1)}m. ${hint}`);
            }
          }
        }
      }

      animFrameRef.current = requestAnimationFrame(draw);
    };

    animFrameRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      window.removeEventListener('resize', resizeCanvas);
    };
  }, [angle, drawArrow]);

  // Formulas
  const angleRad = (angle * Math.PI) / 180;
  const theoreticalRange = (velocity * velocity * Math.sin(2 * angleRad)) / G;
  const theoreticalMaxH = (velocity * velocity * Math.sin(angleRad) * Math.sin(angleRad)) / (2 * G);
  const theoreticalTime = (2 * velocity * Math.sin(angleRad)) / G;

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        fontFamily: "'Sora', 'Plus Jakarta Sans', system-ui, sans-serif",
        color: '#1a1a1a',
        userSelect: 'none',
      }}
    >
      {/* Canvas */}
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="Projectile motion simulation showing trajectory, height, and range of a launched object"
        style={{
          width: '100%',
          height: '400px',
          borderRadius: '12px 12px 0 0',
          display: 'block',
          cursor: 'crosshair',
        }}
      />

      {/* Controls panel */}
      <div
        style={{
          background: 'linear-gradient(180deg, #f8f9ff 0%, #fff 100%)',
          padding: '16px 20px',
          borderRadius: '0 0 12px 12px',
          border: '1px solid rgba(99,102,241,0.12)',
          borderTop: 'none',
        }}
      >
        {/* Sliders row */}
        <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', marginBottom: '14px' }}>
          <div style={{ flex: '1 1 180px' }}>
            <label
              style={{
                fontSize: '12px',
                fontWeight: 600,
                color: '#444',
                display: 'flex',
                justifyContent: 'space-between',
                marginBottom: '6px',
              }}
            >
              <span>Launch Angle</span>
              <span style={{ color: '#6366F1', fontWeight: 700 }}>{angle}&deg;</span>
            </label>
            <input
              type="range"
              min={5}
              max={85}
              value={angle}
              onChange={(e) => setAngle(Number(e.target.value))}
              disabled={isFlying}
              aria-label={`Launch angle slider, ${angle} degrees, range 5 to 85`}
              style={{ width: '100%' }}
            />
          </div>
          <div style={{ flex: '1 1 180px' }}>
            <label
              style={{
                fontSize: '12px',
                fontWeight: 600,
                color: '#444',
                display: 'flex',
                justifyContent: 'space-between',
                marginBottom: '6px',
              }}
            >
              <span>Initial Velocity</span>
              <span style={{ color: '#6366F1', fontWeight: 700 }}>{velocity} m/s</span>
            </label>
            <input
              type="range"
              min={10}
              max={50}
              value={velocity}
              onChange={(e) => setVelocity(Number(e.target.value))}
              disabled={isFlying}
              aria-label={`Initial velocity slider, ${velocity} metres per second, range 10 to 50`}
              style={{ width: '100%' }}
            />
          </div>
        </div>

        {/* Buttons row */}
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '14px' }}>
          <button
            onClick={launch}
            disabled={isFlying}
            aria-label="Launch projectile"
            style={{
              background: isFlying
                ? '#ccc'
                : 'linear-gradient(135deg, #FF6D00, #FF9100)',
              color: '#fff',
              border: 'none',
              padding: '10px 28px',
              borderRadius: '10px',
              fontWeight: 700,
              fontSize: '14px',
              cursor: isFlying ? 'not-allowed' : 'pointer',
              boxShadow: isFlying ? 'none' : '0 3px 12px rgba(255,109,0,0.3)',
              transition: 'all 0.2s',
            }}
          >
            {isFlying ? 'Flying...' : 'Launch!'}
          </button>

          <button
            onClick={() => {
              setCompareMode(!compareMode);
              if (compareMode) {
                projectilesRef.current = [];
                activeIndexRef.current = -1;
                setLandedStats(null);
              }
            }}
            disabled={isFlying}
            aria-label={compareMode ? 'Turn off compare mode' : 'Enable compare mode to overlay trajectories'}
            style={{
              background: compareMode ? '#6366F1' : '#fff',
              color: compareMode ? '#fff' : '#6366F1',
              border: `2px solid #6366F1`,
              padding: '8px 16px',
              borderRadius: '10px',
              fontWeight: 600,
              fontSize: '12px',
              cursor: isFlying ? 'not-allowed' : 'pointer',
            }}
          >
            {compareMode ? 'Compare: ON' : 'Compare Mode'}
          </button>

          <button
            onClick={startChallenge}
            disabled={isFlying}
            aria-label="Start target challenge"
            style={{
              background: challengeActiveRef.current ? '#E53935' : '#fff',
              color: challengeActiveRef.current ? '#fff' : '#E53935',
              border: '2px solid #E53935',
              padding: '8px 16px',
              borderRadius: '10px',
              fontWeight: 600,
              fontSize: '12px',
              cursor: isFlying ? 'not-allowed' : 'pointer',
            }}
          >
            Challenge!
          </button>

          <button
            onClick={() => {
              projectilesRef.current = [];
              activeIndexRef.current = -1;
              setLandedStats(null);
              setChallengeMsg('');
              challengeActiveRef.current = false;
              setLiveStats({ height: 0, distance: 0, time: 0, currentV: 0, vx: 0, vy: 0 });
            }}
            disabled={isFlying}
            aria-label="Reset simulation"
            style={{
              background: '#fff',
              color: '#888',
              border: '1px solid #ddd',
              padding: '8px 16px',
              borderRadius: '10px',
              fontWeight: 600,
              fontSize: '12px',
              cursor: isFlying ? 'not-allowed' : 'pointer',
            }}
          >
            Reset
          </button>
        </div>

        {/* Challenge message */}
        {challengeMsg && (
          <div
            style={{
              background: targetRef.current.hit
                ? 'rgba(76,175,80,0.1)'
                : 'rgba(229,57,53,0.08)',
              color: targetRef.current.hit ? '#2E7D32' : '#C62828',
              padding: '8px 14px',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: 600,
              marginBottom: '12px',
            }}
          >
            {challengeMsg}
          </div>
        )}

        {/* Live stats */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
            gap: '8px',
            marginBottom: '12px',
          }}
        >
          {[
            { label: 'Height', value: `${liveStats.height.toFixed(1)} m`, color: '#1E88E5' },
            { label: 'Distance', value: `${liveStats.distance.toFixed(1)} m`, color: '#43A047' },
            { label: 'Time', value: `${liveStats.time.toFixed(2)} s`, color: '#F4511E' },
            {
              label: 'Speed',
              value: `${liveStats.currentV.toFixed(1)} m/s`,
              color: '#8E24AA',
            },
          ].map((stat) => (
            <div
              key={stat.label}
              style={{
                background: '#fff',
                border: '1px solid rgba(0,0,0,0.06)',
                borderRadius: '8px',
                padding: '8px 10px',
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: '10px', color: '#888', marginBottom: '2px' }}>
                {stat.label}
              </div>
              <div style={{ fontSize: '15px', fontWeight: 700, color: stat.color }}>
                {stat.value}
              </div>
            </div>
          ))}
        </div>

        {/* Landed stats */}
        {landedStats && (
          <div
            style={{
              background: 'rgba(99,102,241,0.06)',
              borderRadius: '10px',
              padding: '12px 16px',
              marginBottom: '12px',
            }}
          >
            <div
              style={{
                fontSize: '12px',
                fontWeight: 700,
                color: '#6366F1',
                marginBottom: '8px',
              }}
            >
              Projectile Landed!
            </div>
            <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', fontSize: '12px' }}>
              <span>
                <strong>Range:</strong> {landedStats.range.toFixed(2)} m
              </span>
              <span>
                <strong>Max Height:</strong> {landedStats.maxHeight.toFixed(2)} m
              </span>
              <span>
                <strong>Total Time:</strong> {landedStats.totalTime.toFixed(2)} s
              </span>
            </div>
          </div>
        )}

        {/* Formulas */}
        <div
          style={{
            background: '#fafafa',
            borderRadius: '8px',
            padding: '10px 14px',
            border: '1px solid rgba(0,0,0,0.05)',
          }}
        >
          <div
            style={{
              fontSize: '11px',
              fontWeight: 700,
              color: '#555',
              marginBottom: '6px',
            }}
          >
            Theory (CBSE Class 11)
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '4px',
              fontSize: '11px',
              color: '#666',
              fontFamily: 'monospace',
            }}
          >
            <div>
              R = v&sup2;sin(2&theta;)/g ={' '}
              <strong style={{ color: '#43A047' }}>{theoreticalRange.toFixed(2)} m</strong>
            </div>
            <div>
              H = v&sup2;sin&sup2;(&theta;)/2g ={' '}
              <strong style={{ color: '#1E88E5' }}>{theoreticalMaxH.toFixed(2)} m</strong>
            </div>
            <div>
              T = 2v sin(&theta;)/g ={' '}
              <strong style={{ color: '#F4511E' }}>{theoreticalTime.toFixed(2)} s</strong>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
