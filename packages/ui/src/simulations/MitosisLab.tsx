'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';

/* ─── Stage definitions ─── */
interface MitosisStage {
  name: string;
  duration: string;
  description: string;
  chromosomeDescription: string;
  nuclearMembrane: string;
  keyEvent: string;
}

const STAGES: MitosisStage[] = [
  {
    name: 'Interphase',
    duration: '~18-20 hours',
    description:
      'The cell prepares for division. DNA replicates during S-phase. The cell grows and organelles duplicate. Chromatin is loose and not visible as distinct chromosomes.',
    chromosomeDescription: 'Chromatin (loosely coiled DNA) fills the nucleus. Not visible as distinct structures.',
    nuclearMembrane: 'Intact — clearly defined nuclear envelope surrounds the chromatin.',
    keyEvent: 'DNA replication (S-phase): each chromosome duplicates to form two sister chromatids joined at centromere.',
  },
  {
    name: 'Prophase',
    duration: '~1-2 hours',
    description:
      'Chromatin condenses into visible chromosomes. Each chromosome consists of two sister chromatids joined at the centromere. Centrioles move to opposite poles. Spindle fibers begin to form.',
    chromosomeDescription: 'Chromosomes condense and become visible. Each has two sister chromatids joined at the centromere.',
    nuclearMembrane: 'Begins to break down — becomes fragmented at late prophase.',
    keyEvent: 'Chromosome condensation and centriole migration to opposite poles.',
  },
  {
    name: 'Metaphase',
    duration: '~20-30 minutes',
    description:
      'Chromosomes align at the cell equator (metaphase plate). Spindle fibers from both poles attach to the centromere of each chromosome via kinetochores. This ensures equal distribution.',
    chromosomeDescription: 'Chromosomes maximally condensed, aligned at the metaphase plate (equator).',
    nuclearMembrane: 'Completely dissolved — no nuclear envelope present.',
    keyEvent: 'Chromosomes align at the metaphase plate. Spindle fibers attach to kinetochores.',
  },
  {
    name: 'Anaphase',
    duration: '~10-15 minutes',
    description:
      'Centromeres split. Sister chromatids are pulled to opposite poles by shortening spindle fibers. The cell elongates. This is the shortest phase of mitosis.',
    chromosomeDescription: 'Sister chromatids separate and move to opposite poles. Each chromatid is now an individual chromosome.',
    nuclearMembrane: 'Absent — still dissolved.',
    keyEvent: 'Centromere splits; sister chromatids pulled apart by spindle fibers (shortest phase).',
  },
  {
    name: 'Telophase',
    duration: '~30-60 minutes',
    description:
      'Chromosomes arrive at the poles and begin to decondense. Nuclear membrane reforms around each set of chromosomes. Spindle fibers disappear. Nucleoli reappear.',
    chromosomeDescription: 'Chromosomes decondense back into chromatin at each pole.',
    nuclearMembrane: 'Reforms — two new nuclear envelopes form around each set of chromosomes.',
    keyEvent: 'Nuclear envelope reforms. Chromosomes decondense. Two nuclei now exist in one cell.',
  },
  {
    name: 'Cytokinesis',
    duration: '~30-60 minutes',
    description:
      'The cytoplasm divides. In animal cells, a cleavage furrow pinches the cell. In plant cells (like onion root tip), a cell plate forms at the center. Two identical daughter cells result.',
    chromosomeDescription: 'Chromatin is now fully decondensed in each daughter nucleus.',
    nuclearMembrane: 'Fully reformed in both daughter cells.',
    keyEvent: 'Cell plate forms (plant cells) or cleavage furrow forms (animal cells). Two daughter cells produced.',
  },
];

const STAGE_COLORS = ['#6b8ebd', '#8b6fbf', '#bf6f8e', '#bf8e6f', '#6fbf8e', '#7fc47f'];

export default function MitosisLab() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number>(0);
  const timeRef = useRef<number>(0);
  const stageRef = useRef(0);
  const playingRef = useRef(false);
  const transitionRef = useRef(0); // 0-1 transition progress between stages

  const [currentStage, setCurrentStage] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    stageRef.current = currentStage;
  }, [currentStage]);
  useEffect(() => {
    playingRef.current = isPlaying;
  }, [isPlaying]);

  const drawCell = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      cx: number,
      cy: number,
      r: number,
      stage: number,
      transition: number,
      time: number
    ) => {
      const stageColor = STAGE_COLORS[stage];

      // Cell membrane
      const drawCellOutline = (x: number, y: number, rx: number, ry: number, alpha: number) => {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = stageColor;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();

        // Cell fill
        const grad = ctx.createRadialGradient(x, y, 0, x, y, rx);
        grad.addColorStop(0, `${stageColor}18`);
        grad.addColorStop(0.7, `${stageColor}0a`);
        grad.addColorStop(1, `${stageColor}15`);
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.restore();
      };

      // Phase-specific rendering
      if (stage === 0) {
        // Interphase: round cell, intact nucleus with chromatin
        drawCellOutline(cx, cy, r, r, 1);

        // Nucleus
        const nucR = r * 0.45;
        ctx.strokeStyle = '#99aadd';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(cx, cy, nucR, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = 'rgba(100, 120, 180, 0.1)';
        ctx.fill();

        // Nucleolus
        ctx.fillStyle = 'rgba(80, 60, 140, 0.5)';
        ctx.beginPath();
        ctx.arc(cx + nucR * 0.2, cy - nucR * 0.15, nucR * 0.18, 0, Math.PI * 2);
        ctx.fill();

        // Chromatin (loose wavy lines)
        ctx.strokeStyle = 'rgba(140, 80, 200, 0.5)';
        ctx.lineWidth = 1.5;
        for (let i = 0; i < 8; i++) {
          const angle = (i / 8) * Math.PI * 2 + time * 0.0002;
          const dist = nucR * (0.15 + 0.2 * Math.sin(i * 1.3));
          const sx = cx + Math.cos(angle) * dist;
          const sy = cy + Math.sin(angle) * dist;
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          for (let t = 0; t < 3; t++) {
            ctx.quadraticCurveTo(
              sx + Math.cos(angle + t * 0.8) * 12 + Math.sin(time * 0.001 + i) * 3,
              sy + Math.sin(angle + t * 0.8) * 12 + Math.cos(time * 0.001 + i) * 3,
              sx + Math.cos(angle + (t + 1) * 0.6) * 8,
              sy + Math.sin(angle + (t + 1) * 0.6) * 8
            );
          }
          ctx.stroke();
        }

        // Centrioles (small paired cylinders near nucleus)
        ctx.fillStyle = 'rgba(200, 160, 80, 0.7)';
        ctx.fillRect(cx + nucR + 10, cy - 4, 8, 3);
        ctx.fillRect(cx + nucR + 10, cy + 1, 8, 3);
      } else if (stage === 1) {
        // Prophase: chromosomes condensing, nuclear membrane fading
        drawCellOutline(cx, cy, r, r, 1);

        // Fading nuclear membrane
        const fadeAlpha = 1 - transition * 0.6;
        const nucR = r * 0.45;
        ctx.strokeStyle = `rgba(153, 170, 221, ${fadeAlpha})`;
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.arc(cx, cy, nucR, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);

        // Condensing chromosomes (X-shapes appearing)
        const chromColors = ['#cc4466', '#4488cc', '#cc8844', '#44cc88'];
        for (let i = 0; i < 4; i++) {
          const angle = (i / 4) * Math.PI * 2 + 0.3;
          const dist = nucR * 0.4;
          const chromX = cx + Math.cos(angle) * dist;
          const chromY = cy + Math.sin(angle) * dist;
          drawChromosome(ctx, chromX, chromY, 10 + transition * 4, chromColors[i], 0.6 + transition * 0.4);
        }

        // Centrioles moving to poles
        const poleDist = r * 0.5 * (0.3 + transition * 0.7);
        ctx.fillStyle = 'rgba(200, 160, 80, 0.8)';
        // Top pole
        ctx.fillRect(cx - 4, cy - poleDist - 4, 8, 3);
        ctx.fillRect(cx - 4, cy - poleDist, 8, 3);
        // Bottom pole
        ctx.fillRect(cx - 4, cy + poleDist - 1, 8, 3);
        ctx.fillRect(cx - 4, cy + poleDist + 2, 8, 3);

        // Spindle fibers beginning to form
        if (transition > 0.5) {
          ctx.strokeStyle = `rgba(200, 200, 100, ${(transition - 0.5) * 0.6})`;
          ctx.lineWidth = 0.8;
          for (let i = 0; i < 6; i++) {
            const spread = (i - 2.5) * 8;
            ctx.beginPath();
            ctx.moveTo(cx + spread * 0.3, cy - poleDist);
            ctx.quadraticCurveTo(cx + spread, cy, cx + spread * 0.3, cy + poleDist);
            ctx.stroke();
          }
        }
      } else if (stage === 2) {
        // Metaphase: chromosomes at equator, spindle fibers attached
        drawCellOutline(cx, cy, r, r, 1);

        // Spindle fibers
        const poleDist = r * 0.7;
        ctx.strokeStyle = 'rgba(200, 200, 100, 0.4)';
        ctx.lineWidth = 0.8;
        const chromColors = ['#cc4466', '#4488cc', '#cc8844', '#44cc88'];
        for (let i = 0; i < 4; i++) {
          const chromX = cx + (i - 1.5) * 18;
          // To top pole
          ctx.beginPath();
          ctx.moveTo(cx, cy - poleDist);
          ctx.lineTo(chromX, cy);
          ctx.stroke();
          // To bottom pole
          ctx.beginPath();
          ctx.moveTo(cx, cy + poleDist);
          ctx.lineTo(chromX, cy);
          ctx.stroke();
        }

        // Centrioles at poles
        ctx.fillStyle = 'rgba(200, 160, 80, 0.9)';
        ctx.fillRect(cx - 4, cy - poleDist - 4, 8, 3);
        ctx.fillRect(cx - 4, cy - poleDist, 8, 3);
        ctx.fillRect(cx - 4, cy + poleDist - 1, 8, 3);
        ctx.fillRect(cx - 4, cy + poleDist + 2, 8, 3);

        // Chromosomes at metaphase plate (equator)
        for (let i = 0; i < 4; i++) {
          const chromX = cx + (i - 1.5) * 18;
          drawChromosome(ctx, chromX, cy, 14, chromColors[i], 1);
        }

        // Metaphase plate line
        ctx.strokeStyle = 'rgba(255, 255, 100, 0.2)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(cx - r * 0.6, cy);
        ctx.lineTo(cx + r * 0.6, cy);
        ctx.stroke();
        ctx.setLineDash([]);

        // Label
        ctx.font = '9px "Segoe UI", sans-serif';
        ctx.fillStyle = 'rgba(255, 255, 150, 0.5)';
        ctx.textAlign = 'center';
        ctx.fillText('Metaphase Plate', cx, cy + r * 0.55);
      } else if (stage === 3) {
        // Anaphase: chromatids moving to poles
        const elongation = 1 + transition * 0.15;
        drawCellOutline(cx, cy, r * 0.9, r * elongation, 1);

        const poleDist = r * (0.3 + transition * 0.45);
        const chromColors = ['#cc4466', '#4488cc', '#cc8844', '#44cc88'];

        // Spindle fibers (shortening)
        ctx.strokeStyle = 'rgba(200, 200, 100, 0.3)';
        ctx.lineWidth = 0.6;
        for (let i = 0; i < 4; i++) {
          const spread = (i - 1.5) * 14;
          ctx.beginPath();
          ctx.moveTo(cx, cy - r * 0.7 * elongation);
          ctx.lineTo(cx + spread * 0.8, cy - poleDist);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(cx, cy + r * 0.7 * elongation);
          ctx.lineTo(cx + spread * 0.8, cy + poleDist);
          ctx.stroke();
        }

        // Chromatids moving to top pole
        for (let i = 0; i < 4; i++) {
          const chromX = cx + (i - 1.5) * 14;
          drawChromatid(ctx, chromX, cy - poleDist, 10, chromColors[i], 1);
        }
        // Chromatids moving to bottom pole
        for (let i = 0; i < 4; i++) {
          const chromX = cx + (i - 1.5) * 14;
          drawChromatid(ctx, chromX, cy + poleDist, 10, chromColors[i], 1);
        }

        // Centrioles at poles
        ctx.fillStyle = 'rgba(200, 160, 80, 0.9)';
        const ep = r * 0.7 * elongation;
        ctx.fillRect(cx - 4, cy - ep - 4, 8, 3);
        ctx.fillRect(cx - 4, cy - ep, 8, 3);
        ctx.fillRect(cx - 4, cy + ep - 1, 8, 3);
        ctx.fillRect(cx - 4, cy + ep + 2, 8, 3);
      } else if (stage === 4) {
        // Telophase: two nuclei forming, chromosomes decondensing
        const elongation = 1.15;
        drawCellOutline(cx, cy, r * 0.9, r * elongation, 1);

        // Two new nuclear membranes forming
        const nucR = r * 0.3;
        const nucDist = r * 0.5;
        const memAlpha = 0.4 + transition * 0.6;

        for (const sign of [-1, 1]) {
          const ny = cy + sign * nucDist;
          ctx.strokeStyle = `rgba(153, 170, 221, ${memAlpha})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(cx, ny, nucR, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = `rgba(100, 120, 180, ${memAlpha * 0.15})`;
          ctx.fill();

          // Decondensing chromosomes (fading back to chromatin)
          const chromAlpha = 1 - transition * 0.5;
          const chromColors = ['#cc4466', '#4488cc', '#cc8844', '#44cc88'];
          for (let i = 0; i < 4; i++) {
            const angle = (i / 4) * Math.PI * 2;
            const dist2 = nucR * 0.35;
            const chromX = cx + Math.cos(angle) * dist2;
            const chromY = ny + Math.sin(angle) * dist2;
            drawChromatid(ctx, chromX, chromY, 8 - transition * 3, chromColors[i], chromAlpha);
          }

          // Nucleolus reappearing
          if (transition > 0.5) {
            ctx.fillStyle = `rgba(80, 60, 140, ${(transition - 0.5) * 0.8})`;
            ctx.beginPath();
            ctx.arc(cx + 5, ny - 3, nucR * 0.15, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      } else if (stage === 5) {
        // Cytokinesis: cell plate forming, two daughter cells
        const separation = transition * r * 0.4;

        // Cleavage furrow / cell plate
        const pinch = transition * r * 0.65;
        ctx.strokeStyle = stageColor;
        ctx.lineWidth = 3;

        // Top daughter cell
        ctx.beginPath();
        ctx.ellipse(cx, cy - r * 0.55 - separation * 0.3, r * 0.8, r * 0.7, 0, 0, Math.PI * 2);
        ctx.stroke();
        const g1 = ctx.createRadialGradient(cx, cy - r * 0.55 - separation * 0.3, 0, cx, cy - r * 0.55 - separation * 0.3, r * 0.8);
        g1.addColorStop(0, `${stageColor}12`);
        g1.addColorStop(1, `${stageColor}08`);
        ctx.fillStyle = g1;
        ctx.fill();

        // Bottom daughter cell
        ctx.beginPath();
        ctx.ellipse(cx, cy + r * 0.55 + separation * 0.3, r * 0.8, r * 0.7, 0, 0, Math.PI * 2);
        ctx.stroke();
        const g2 = ctx.createRadialGradient(cx, cy + r * 0.55 + separation * 0.3, 0, cx, cy + r * 0.55 + separation * 0.3, r * 0.8);
        g2.addColorStop(0, `${stageColor}12`);
        g2.addColorStop(1, `${stageColor}08`);
        ctx.fillStyle = g2;
        ctx.fill();

        // Cell plate forming in the middle
        if (transition < 0.8) {
          ctx.strokeStyle = 'rgba(120, 180, 100, 0.6)';
          ctx.lineWidth = 2;
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.moveTo(cx - pinch, cy);
          ctx.lineTo(cx + pinch, cy);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.font = '8px "Segoe UI", sans-serif';
          ctx.fillStyle = 'rgba(120, 180, 100, 0.7)';
          ctx.textAlign = 'center';
          ctx.fillText('Cell Plate', cx, cy + 12);
        }

        // Nuclei in each daughter cell
        const nucR = r * 0.25;
        for (const sign of [-1, 1]) {
          const ny = cy + sign * (r * 0.55 + separation * 0.3);
          ctx.strokeStyle = 'rgba(153, 170, 221, 0.8)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(cx, ny, nucR, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = 'rgba(100, 120, 180, 0.1)';
          ctx.fill();

          // Chromatin
          ctx.strokeStyle = 'rgba(140, 80, 200, 0.35)';
          ctx.lineWidth = 1;
          for (let i = 0; i < 5; i++) {
            const angle = (i / 5) * Math.PI * 2 + time * 0.0002;
            const d = nucR * 0.3;
            ctx.beginPath();
            ctx.moveTo(cx + Math.cos(angle) * d, ny + Math.sin(angle) * d);
            ctx.quadraticCurveTo(
              cx + Math.cos(angle + 0.5) * d * 1.5,
              ny + Math.sin(angle + 0.5) * d * 1.5,
              cx + Math.cos(angle + 1) * d,
              ny + Math.sin(angle + 1) * d
            );
            ctx.stroke();
          }

          // Nucleolus
          ctx.fillStyle = 'rgba(80, 60, 140, 0.4)';
          ctx.beginPath();
          ctx.arc(cx + 3, ny - 2, nucR * 0.15, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    },
    []
  );

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, W: number, H: number, time: number) => {
      const dpr = window.devicePixelRatio || 1;
      const w = W / dpr;
      const h = H / dpr;

      // Clear
      ctx.clearRect(0, 0, w, h);

      // Background
      const bg = ctx.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, '#0d1117');
      bg.addColorStop(1, '#151d2a');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      const stage = stageRef.current;
      const playing = playingRef.current;

      // Auto-advance transition
      if (playing) {
        transitionRef.current += 0.003;
        if (transitionRef.current >= 1) {
          transitionRef.current = 0;
          const next = (stage + 1) % STAGES.length;
          stageRef.current = next;
          setCurrentStage(next);
        }
      }

      // Draw main cell
      const cx = w * 0.5;
      const cy = h * 0.48;
      const cellR = Math.min(w, h) * 0.28;

      drawCell(ctx, cx, cy, cellR, stage, transitionRef.current, time);

      // Stage name
      ctx.font = 'bold 16px "Segoe UI", sans-serif';
      ctx.fillStyle = STAGE_COLORS[stage];
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(STAGES[stage].name, cx, 14);

      // Duration
      ctx.font = '11px "Segoe UI", sans-serif';
      ctx.fillStyle = 'rgba(200, 200, 220, 0.6)';
      ctx.fillText(`Duration: ${STAGES[stage].duration}`, cx, 34);

      // Stage indicator dots at top
      const dotY = h - 24;
      const dotSpacing = 28;
      const startX = cx - ((STAGES.length - 1) * dotSpacing) / 2;
      for (let i = 0; i < STAGES.length; i++) {
        const dx = startX + i * dotSpacing;
        ctx.beginPath();
        ctx.arc(dx, dotY, i === stage ? 6 : 4, 0, Math.PI * 2);
        ctx.fillStyle = i === stage ? STAGE_COLORS[i] : i < stage ? `${STAGE_COLORS[i]}88` : 'rgba(100,100,120,0.4)';
        ctx.fill();
        if (i === stage) {
          ctx.strokeStyle = `${STAGE_COLORS[i]}44`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(dx, dotY, 9, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // Stage labels below dots
      ctx.font = '8px "Segoe UI", sans-serif';
      ctx.textBaseline = 'top';
      for (let i = 0; i < STAGES.length; i++) {
        const dx = startX + i * dotSpacing;
        ctx.fillStyle = i === stage ? STAGE_COLORS[i] : 'rgba(150,150,170,0.5)';
        ctx.textAlign = 'center';
        const shortName = STAGES[i].name.length > 5 ? STAGES[i].name.substring(0, 4) + '.' : STAGES[i].name;
        ctx.fillText(shortName, dx, dotY + 10);
      }

      // Title
      ctx.font = 'bold 12px "Segoe UI", sans-serif';
      ctx.fillStyle = 'rgba(180, 200, 220, 0.7)';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText('Mitosis — Onion Root Tip', 10, h - 18);
    },
    [drawCell]
  );

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
      timeRef.current = time;
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

  const goToStage = (idx: number) => {
    setCurrentStage(idx);
    stageRef.current = idx;
    transitionRef.current = 0;
  };

  const stepForward = () => {
    const next = (currentStage + 1) % STAGES.length;
    goToStage(next);
  };

  const stepBack = () => {
    const prev = (currentStage - 1 + STAGES.length) % STAGES.length;
    goToStage(prev);
  };

  const stage = STAGES[currentStage];

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
        aria-label={`Mitosis simulation showing ${stage.name} stage of cell division with animated chromosomes and cellular structures`}
        style={{
          width: '100%',
          height: 420,
          borderRadius: 16,
          display: 'block',
        }}
      />

      <div style={{ padding: '16px 4px 8px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Playback controls */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={stepBack}
            aria-label="Previous stage"
            style={controlButtonStyle('#6b8ebd')}
          >
            Prev
          </button>

          <button
            onClick={() => setIsPlaying(!isPlaying)}
            aria-label={isPlaying ? 'Pause animation' : 'Play animation'}
            style={controlButtonStyle(isPlaying ? '#bf6f8e' : '#6fbf8e')}
          >
            {isPlaying ? 'Pause' : 'Play'}
          </button>

          <button
            onClick={stepForward}
            aria-label="Next stage"
            style={controlButtonStyle('#6b8ebd')}
          >
            Next
          </button>

          <button
            onClick={() => setShowDetails(!showDetails)}
            aria-label={showDetails ? 'Hide details' : 'Show details'}
            style={{
              ...controlButtonStyle('#8b6fbf'),
              marginLeft: 'auto',
            }}
          >
            {showDetails ? 'Hide Details' : 'Show Details'}
          </button>
        </div>

        {/* Stage selector pills */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {STAGES.map((s, i) => (
            <button
              key={s.name}
              onClick={() => goToStage(i)}
              aria-label={`Go to ${s.name} stage`}
              style={{
                padding: '6px 12px',
                borderRadius: 14,
                border: `2px solid ${i === currentStage ? STAGE_COLORS[i] : 'rgba(100,100,120,0.3)'}`,
                background: i === currentStage ? `${STAGE_COLORS[i]}22` : 'transparent',
                color: i === currentStage ? STAGE_COLORS[i] : 'rgba(180,180,200,0.6)',
                fontWeight: i === currentStage ? 700 : 500,
                fontSize: 12,
                cursor: 'pointer',
                transition: 'all 0.2s',
                minHeight: 36,
              }}
            >
              {s.name}
            </button>
          ))}
        </div>

        {/* Detail panel */}
        {showDetails && (
          <div
            style={{
              background: `${STAGE_COLORS[currentStage]}0a`,
              border: `1px solid ${STAGE_COLORS[currentStage]}33`,
              borderRadius: 12,
              padding: 14,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <h3 style={{ margin: 0, color: STAGE_COLORS[currentStage], fontSize: 15, fontWeight: 700 }}>
              {stage.name} — {stage.duration}
            </h3>
            <p style={{ margin: 0, color: 'rgba(200,200,220,0.85)', fontSize: 13, lineHeight: 1.6 }}>
              {stage.description}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <DetailRow label="Chromosomes" value={stage.chromosomeDescription} color={STAGE_COLORS[currentStage]} />
              <DetailRow label="Nuclear Membrane" value={stage.nuclearMembrane} color={STAGE_COLORS[currentStage]} />
              <DetailRow label="Key Event" value={stage.keyEvent} color={STAGE_COLORS[currentStage]} />
            </div>
          </div>
        )}

        {/* Discovery tip */}
        <p
          style={{
            margin: 0,
            padding: '8px 12px',
            background: 'rgba(107, 142, 189, 0.08)',
            border: '1px solid rgba(107, 142, 189, 0.2)',
            borderRadius: 10,
            color: 'rgba(160, 180, 220, 0.9)',
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          <strong>CBSE Practical:</strong> In onion root tip squash preparation, you stain cells with
          acetocarmine or safranin to see chromosomes. Most cells will be in interphase (longest phase).
          Click each stage to understand what happens to chromosomes, the nuclear membrane, and centrioles.
        </p>
      </div>
    </div>
  );
}

/* ─── Helper: draw a paired chromosome (X-shape) ─── */
function drawChromosome(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
  alpha: number
) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';

  // Two sister chromatids forming an X
  const half = size / 2;

  // Left chromatid
  ctx.beginPath();
  ctx.moveTo(x - half * 0.4, y - half);
  ctx.quadraticCurveTo(x - 1, y, x - half * 0.4, y + half);
  ctx.stroke();

  // Right chromatid
  ctx.beginPath();
  ctx.moveTo(x + half * 0.4, y - half);
  ctx.quadraticCurveTo(x + 1, y, x + half * 0.4, y + half);
  ctx.stroke();

  // Centromere dot
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, 2, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

/* ─── Helper: draw a single chromatid (V-shape) ─── */
function drawChromatid(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
  alpha: number
) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';

  const half = size / 2;
  ctx.beginPath();
  ctx.moveTo(x - half * 0.3, y - half);
  ctx.lineTo(x, y);
  ctx.lineTo(x + half * 0.3, y - half);
  ctx.stroke();

  // Centromere
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, 1.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

/* ─── Detail row component ─── */
function DetailRow({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ fontSize: 12, lineHeight: 1.5 }}>
      <span style={{ color, fontWeight: 700 }}>{label}: </span>
      <span style={{ color: 'rgba(200,200,220,0.75)' }}>{value}</span>
    </div>
  );
}

/* ─── Control button style ─── */
function controlButtonStyle(color: string): React.CSSProperties {
  return {
    padding: '8px 18px',
    borderRadius: 20,
    border: `2px solid ${color}`,
    background: `${color}18`,
    color,
    fontWeight: 700,
    fontSize: 13,
    cursor: 'pointer',
    transition: 'all 0.2s',
    minHeight: 44,
    minWidth: 44,
  };
}
