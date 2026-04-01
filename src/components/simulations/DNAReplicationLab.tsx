'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';

/* ─── Constants ─── */
const BASE_PAIRS: [string, string, string, string][] = [
  // [base1, base2, color1, color2]
  ['A', 'T', '#cc4466', '#4488cc'],
  ['T', 'A', '#4488cc', '#cc4466'],
  ['G', 'C', '#44aa66', '#cc8844'],
  ['C', 'G', '#cc8844', '#44aa66'],
  ['A', 'T', '#cc4466', '#4488cc'],
  ['G', 'C', '#44aa66', '#cc8844'],
  ['T', 'A', '#4488cc', '#cc4466'],
  ['C', 'G', '#cc8844', '#44aa66'],
  ['A', 'T', '#cc4466', '#4488cc'],
  ['G', 'C', '#44aa66', '#cc8844'],
  ['T', 'A', '#4488cc', '#cc4466'],
  ['A', 'T', '#cc4466', '#4488cc'],
  ['C', 'G', '#cc8844', '#44aa66'],
  ['G', 'C', '#44aa66', '#cc8844'],
  ['T', 'A', '#4488cc', '#cc4466'],
  ['A', 'T', '#cc4466', '#4488cc'],
];

const STEPS = [
  {
    name: 'Double Helix (Before Replication)',
    description:
      'The DNA double helix is intact. Two antiparallel strands are held together by hydrogen bonds between complementary base pairs: Adenine (A) pairs with Thymine (T), and Guanine (G) pairs with Cytosine (C).',
    enzyme: 'None active yet',
    detail: 'The two strands run in opposite directions (5\' to 3\' and 3\' to 5\'). This antiparallel nature is crucial for replication.',
  },
  {
    name: 'Helicase Unwinds DNA',
    description:
      'The enzyme helicase breaks hydrogen bonds between base pairs, unwinding the double helix. This creates a Y-shaped replication fork. Single-strand binding proteins (SSBs) stabilize the separated strands.',
    enzyme: 'Helicase (unwinds) + SSBs (stabilize)',
    detail: 'The point where the two strands separate is called the origin of replication. Replication is bidirectional from this point.',
  },
  {
    name: 'Primase Adds RNA Primer',
    description:
      'DNA primase synthesizes a short RNA primer on each template strand. DNA polymerase III cannot start a new chain from scratch — it needs this primer to begin adding nucleotides.',
    enzyme: 'Primase (adds RNA primer)',
    detail: 'The primer provides a free 3\' OH group that DNA polymerase III uses to start adding deoxyribonucleotides.',
  },
  {
    name: 'DNA Polymerase III — Leading Strand',
    description:
      'DNA polymerase III adds complementary nucleotides continuously on the leading strand (in the 5\' to 3\' direction, towards the replication fork). Base pairing rules: A-T and G-C.',
    enzyme: 'DNA Polymerase III (adds bases, 5\' → 3\')',
    detail: 'The leading strand is synthesized continuously because polymerase moves in the same direction as the replication fork.',
  },
  {
    name: 'Lagging Strand — Okazaki Fragments',
    description:
      'On the lagging strand, DNA polymerase III works away from the fork, creating short Okazaki fragments (1000-2000 bases in prokaryotes, 100-200 in eukaryotes). Each fragment needs its own RNA primer.',
    enzyme: 'DNA Polymerase III (discontinuous synthesis)',
    detail: 'The lagging strand is synthesized in short fragments because polymerase can only work 5\' to 3\', which is away from the fork on this strand.',
  },
  {
    name: 'DNA Ligase Joins Fragments',
    description:
      'DNA polymerase I replaces RNA primers with DNA. Then DNA ligase seals the gaps (nicks) between Okazaki fragments, creating a continuous strand. The result is two identical DNA molecules.',
    enzyme: 'DNA Polymerase I (replaces primers) + DNA Ligase (seals nicks)',
    detail: 'This demonstrates semi-conservative replication: each new DNA molecule has one old (template) strand and one newly synthesized strand.',
  },
  {
    name: 'Semi-Conservative Replication Complete',
    description:
      'Two identical DNA double helices are formed. Each contains one original (parent) strand and one new (daughter) strand — this is semi-conservative replication, proven by Meselson and Stahl (1958).',
    enzyme: 'Replication complete',
    detail: 'Meselson-Stahl experiment used N-15 heavy isotope to prove that replication is semi-conservative, not conservative or dispersive.',
  },
];

export default function DNAReplicationLab() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number>(0);
  const stepRef = useRef(0);
  const animProgressRef = useRef(0);
  const playingRef = useRef(false);

  const [currentStep, setCurrentStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showLabels, setShowLabels] = useState(true);

  const showLabelsRef = useRef(true);

  useEffect(() => { stepRef.current = currentStep; }, [currentStep]);
  useEffect(() => { playingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { showLabelsRef.current = showLabels; }, [showLabels]);

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, W: number, H: number, time: number) => {
      const dpr = window.devicePixelRatio || 1;
      const w = W / dpr;
      const h = H / dpr;

      ctx.clearRect(0, 0, w, h);

      // Background
      const bg = ctx.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, '#0a0e18');
      bg.addColorStop(1, '#121828');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      const step = stepRef.current;
      const playing = playingRef.current;
      const labels = showLabelsRef.current;

      // Auto-advance
      if (playing) {
        animProgressRef.current += 0.004;
        if (animProgressRef.current >= 1) {
          animProgressRef.current = 0;
          const next = Math.min(step + 1, STEPS.length - 1);
          if (next !== step) {
            stepRef.current = next;
            setCurrentStep(next);
          } else {
            setIsPlaying(false);
          }
        }
      }

      const progress = animProgressRef.current;
      const cx = w / 2;
      const baseSpacing = Math.min(24, (h - 80) / BASE_PAIRS.length);
      const strandWidth = Math.min(w * 0.28, 120);
      const startY = 50;

      // Title
      ctx.font = 'bold 13px "Segoe UI", sans-serif';
      ctx.fillStyle = 'rgba(180, 200, 220, 0.9)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText('DNA Replication', cx, 8);

      ctx.font = '11px "Segoe UI", sans-serif';
      ctx.fillStyle = 'rgba(160, 180, 200, 0.6)';
      ctx.fillText(STEPS[step].name, cx, 24);

      // Calculate how far the fork has opened
      const forkOpenBases = step === 0 ? 0 :
        step === 1 ? Math.floor(progress * BASE_PAIRS.length) :
        BASE_PAIRS.length;

      // For steps 2+, all bases are unwound
      const forkIndex = step >= 2 ? BASE_PAIRS.length : forkOpenBases;

      // Leading strand progress (step 3+)
      const leadingBases = step < 3 ? 0 :
        step === 3 ? Math.floor(progress * forkIndex) :
        forkIndex;

      // Lagging strand Okazaki fragments (step 4+)
      const fragmentSize = 4;
      const laggingFragments = step < 4 ? 0 :
        step === 4 ? Math.floor(progress * Math.ceil(forkIndex / fragmentSize)) :
        Math.ceil(forkIndex / fragmentSize);

      // Ligase progress (step 5)
      const ligaseProgress = step < 5 ? 0 : step === 5 ? progress : 1;

      // Separation for step 6 (final)
      const finalSeparation = step === 6 ? Math.min(progress * 1, 1) * strandWidth * 0.5 : 0;

      for (let i = 0; i < BASE_PAIRS.length; i++) {
        const [base1, base2, color1, color2] = BASE_PAIRS[i];
        const y = startY + i * baseSpacing;

        const isUnwound = i < forkIndex;

        if (!isUnwound) {
          // Still wound — draw double helix
          const helixPhase = time * 0.001 + i * 0.4;
          const twist1 = Math.sin(helixPhase) * strandWidth * 0.25;
          const twist2 = -twist1;

          // Backbone strands
          const x1 = cx + twist1;
          const x2 = cx + twist2;

          // Hydrogen bonds
          ctx.strokeStyle = 'rgba(160, 160, 180, 0.2)';
          ctx.lineWidth = 1;
          ctx.setLineDash([2, 2]);
          ctx.beginPath();
          ctx.moveTo(x1, y);
          ctx.lineTo(x2, y);
          ctx.stroke();
          ctx.setLineDash([]);

          // Base pair dots
          const depth = Math.cos(helixPhase);
          if (depth > 0) {
            drawBase(ctx, x1, y, base1, color1, 6);
            drawBase(ctx, x2, y, base2, color2, 6);
          } else {
            drawBase(ctx, x2, y, base2, color2, 6);
            drawBase(ctx, x1, y, base1, color1, 6);
          }

          // Backbone connections
          if (i > 0 && i >= forkIndex) {
            const prevY = startY + (i - 1) * baseSpacing;
            const prevPhase = time * 0.001 + (i - 1) * 0.4;
            const prevTwist1 = Math.sin(prevPhase) * strandWidth * 0.25;
            const prevTwist2 = -prevTwist1;

            ctx.strokeStyle = 'rgba(200, 180, 100, 0.3)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(cx + prevTwist1, prevY);
            ctx.lineTo(x1, y);
            ctx.stroke();

            ctx.strokeStyle = 'rgba(100, 180, 200, 0.3)';
            ctx.beginPath();
            ctx.moveTo(cx + prevTwist2, prevY);
            ctx.lineTo(x2, y);
            ctx.stroke();
          }
        } else {
          // Unwound — draw separated strands
          const openAmount = step >= 2 ? 1 : Math.min(1, (forkIndex - i) / 3);
          const separation = strandWidth * 0.35 * openAmount;

          // Old template strands (parent)
          const oldColor1 = step === 6 ? 'rgba(200, 180, 100, 0.8)' : color1;
          const oldColor2 = step === 6 ? 'rgba(100, 180, 200, 0.8)' : color2;

          const leftX = cx - separation - finalSeparation;
          const rightX = cx + separation + finalSeparation;

          // Template strand 1 (left — leading strand template)
          drawBase(ctx, leftX, y, base1, oldColor1, 6);

          // Template strand 2 (right — lagging strand template)
          drawBase(ctx, rightX, y, base2, oldColor2, 6);

          // Backbone for template strands
          if (i > 0 && i - 1 < forkIndex) {
            ctx.strokeStyle = 'rgba(200, 180, 100, 0.25)';
            ctx.lineWidth = 2;
            const prevY = startY + (i - 1) * baseSpacing;
            const prevOpen = step >= 2 ? 1 : Math.min(1, (forkIndex - (i - 1)) / 3);
            const prevSep = strandWidth * 0.35 * prevOpen;
            ctx.beginPath();
            ctx.moveTo(cx - prevSep - finalSeparation, prevY);
            ctx.lineTo(leftX, y);
            ctx.stroke();

            ctx.strokeStyle = 'rgba(100, 180, 200, 0.25)';
            ctx.beginPath();
            ctx.moveTo(cx + prevSep + finalSeparation, prevY);
            ctx.lineTo(rightX, y);
            ctx.stroke();
          }

          // RNA Primer (step 2)
          if (step === 2 && i < 3) {
            const primerAlpha = Math.min(1, progress * 3 - i * 0.5);
            if (primerAlpha > 0) {
              ctx.fillStyle = `rgba(255, 100, 50, ${primerAlpha * 0.7})`;
              ctx.fillRect(leftX + 10, y - 3, 12, 6);
              ctx.fillRect(rightX - 22, y - 3, 12, 6);

              if (labels && i === 0) {
                ctx.font = '9px "Segoe UI", sans-serif';
                ctx.fillStyle = 'rgba(255, 100, 50, 0.8)';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.fillText('RNA Primer', leftX + 26, y);
              }
            }
          }

          // New complementary bases — Leading strand (continuous, left side)
          if (i < leadingBases) {
            const newBase = base1 === 'A' ? 'T' : base1 === 'T' ? 'A' : base1 === 'G' ? 'C' : 'G';
            const newColor = base1 === 'A' ? '#4488cc' : base1 === 'T' ? '#cc4466' : base1 === 'G' ? '#cc8844' : '#44aa66';
            const newX = leftX + baseSpacing * 0.8;

            // New base (brighter to show it's new)
            drawBase(ctx, newX, y, newBase, newColor, 5, step === 6);

            // Hydrogen bond
            ctx.strokeStyle = 'rgba(200, 200, 100, 0.3)';
            ctx.lineWidth = 1;
            ctx.setLineDash([2, 2]);
            ctx.beginPath();
            ctx.moveTo(leftX + 6, y);
            ctx.lineTo(newX - 5, y);
            ctx.stroke();
            ctx.setLineDash([]);

            // New strand backbone
            if (i > 0 && i - 1 < leadingBases) {
              ctx.strokeStyle = step === 6 ? 'rgba(100, 200, 100, 0.35)' : 'rgba(100, 200, 100, 0.2)';
              ctx.lineWidth = 2;
              const prevY2 = startY + (i - 1) * baseSpacing;
              const prevOpen2 = step >= 2 ? 1 : Math.min(1, (forkIndex - (i - 1)) / 3);
              const prevSep2 = strandWidth * 0.35 * prevOpen2;
              ctx.beginPath();
              ctx.moveTo(cx - prevSep2 - finalSeparation + baseSpacing * 0.8, prevY2);
              ctx.lineTo(newX, y);
              ctx.stroke();
            }
          }

          // Lagging strand (Okazaki fragments, right side)
          const fragIdx = Math.floor(i / fragmentSize);
          const inFragment = fragIdx < laggingFragments;

          if (inFragment && step >= 4) {
            const newBase = base2 === 'A' ? 'T' : base2 === 'T' ? 'A' : base2 === 'G' ? 'C' : 'G';
            const newColor = base2 === 'A' ? '#4488cc' : base2 === 'T' ? '#cc4466' : base2 === 'G' ? '#cc8844' : '#44aa66';
            const newX = rightX - baseSpacing * 0.8;

            drawBase(ctx, newX, y, newBase, newColor, 5, step === 6);

            // Hydrogen bond
            ctx.strokeStyle = 'rgba(200, 200, 100, 0.3)';
            ctx.lineWidth = 1;
            ctx.setLineDash([2, 2]);
            ctx.beginPath();
            ctx.moveTo(rightX - 6, y);
            ctx.lineTo(newX + 5, y);
            ctx.stroke();
            ctx.setLineDash([]);

            // Fragment backbone
            const posInFrag = i % fragmentSize;
            if (posInFrag > 0) {
              ctx.strokeStyle = step === 6 ? 'rgba(200, 100, 100, 0.35)' : 'rgba(200, 100, 100, 0.2)';
              ctx.lineWidth = 2;
              const prevY3 = startY + (i - 1) * baseSpacing;
              const prevOpen3 = step >= 2 ? 1 : Math.min(1, (forkIndex - (i - 1)) / 3);
              const prevSep3 = strandWidth * 0.35 * prevOpen3;
              ctx.beginPath();
              ctx.moveTo(cx + prevSep3 + finalSeparation - baseSpacing * 0.8, prevY3);
              ctx.lineTo(newX, y);
              ctx.stroke();
            }

            // Gap between Okazaki fragments (before ligase)
            if (posInFrag === 0 && fragIdx > 0 && ligaseProgress < fragIdx / laggingFragments) {
              // Show gap
              ctx.strokeStyle = 'rgba(255, 100, 100, 0.5)';
              ctx.lineWidth = 1;
              const gapY = y - baseSpacing * 0.5;
              ctx.beginPath();
              ctx.moveTo(newX - 4, gapY);
              ctx.lineTo(newX + 4, gapY);
              ctx.stroke();
            }
          }
        }
      }

      // Replication fork label
      if (labels && step >= 1 && step <= 5) {
        const forkY = startY + forkIndex * baseSpacing;
        ctx.font = '9px "Segoe UI", sans-serif';
        ctx.fillStyle = 'rgba(200, 200, 100, 0.7)';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText('Replication Fork', cx - strandWidth * 0.45, Math.min(forkY, startY + BASE_PAIRS.length * baseSpacing - 10));

        // Arrow
        ctx.strokeStyle = 'rgba(200, 200, 100, 0.4)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx - strandWidth * 0.43, Math.min(forkY, startY + BASE_PAIRS.length * baseSpacing - 10));
        ctx.lineTo(cx - strandWidth * 0.15, Math.min(forkY, startY + BASE_PAIRS.length * baseSpacing - 10));
        ctx.stroke();
      }

      // Helicase label (step 1-2)
      if (labels && (step === 1 || step === 2)) {
        const helicaseY = startY + forkIndex * baseSpacing;
        ctx.fillStyle = 'rgba(255, 200, 100, 0.8)';
        ctx.font = 'bold 10px "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Helicase', cx, Math.min(helicaseY + 12, startY + BASE_PAIRS.length * baseSpacing + 10));

        // Helicase icon (triangle)
        ctx.fillStyle = 'rgba(255, 200, 100, 0.5)';
        const hy = Math.min(helicaseY, startY + BASE_PAIRS.length * baseSpacing);
        ctx.beginPath();
        ctx.moveTo(cx - 6, hy - 2);
        ctx.lineTo(cx + 6, hy - 2);
        ctx.lineTo(cx, hy + 6);
        ctx.closePath();
        ctx.fill();
      }

      // DNA Polymerase III label (step 3-4)
      if (labels && (step === 3 || step === 4)) {
        ctx.font = 'bold 9px "Segoe UI", sans-serif';
        ctx.fillStyle = 'rgba(100, 220, 100, 0.8)';
        ctx.textAlign = 'left';
        const polY = startY + leadingBases * baseSpacing;
        ctx.fillText('DNA Pol III', cx - strandWidth * 0.35 + baseSpacing * 0.8 + 10, Math.min(polY, startY + BASE_PAIRS.length * baseSpacing));

        if (step === 4) {
          ctx.fillStyle = 'rgba(220, 100, 100, 0.8)';
          ctx.textAlign = 'right';
          ctx.fillText('DNA Pol III', cx + strandWidth * 0.35 - baseSpacing * 0.8 - 10, startY + (laggingFragments * fragmentSize - 1) * baseSpacing);
        }
      }

      // Okazaki fragment label (step 4-5)
      if (labels && (step === 4 || step === 5)) {
        ctx.font = '9px "Segoe UI", sans-serif';
        ctx.fillStyle = 'rgba(220, 150, 100, 0.7)';
        ctx.textAlign = 'left';
        ctx.fillText('Okazaki Fragments', cx + strandWidth * 0.4 + 8, startY + 2 * baseSpacing);
      }

      // DNA Ligase label (step 5)
      if (labels && step === 5) {
        ctx.font = 'bold 9px "Segoe UI", sans-serif';
        ctx.fillStyle = 'rgba(200, 200, 100, 0.8)';
        ctx.textAlign = 'left';
        ctx.fillText('DNA Ligase (sealing gaps)', cx + strandWidth * 0.4 + 8, startY + 4 * baseSpacing);
      }

      // Semi-conservative label (step 6)
      if (step === 6 && labels) {
        ctx.font = '10px "Segoe UI", sans-serif';
        const leftCx = cx - finalSeparation - strandWidth * 0.17;
        const rightCx = cx + finalSeparation + strandWidth * 0.17;

        ctx.fillStyle = 'rgba(200, 180, 100, 0.6)';
        ctx.textAlign = 'center';
        ctx.fillText('Old strand', leftCx - 10, startY + BASE_PAIRS.length * baseSpacing + 16);
        ctx.fillStyle = 'rgba(100, 200, 100, 0.6)';
        ctx.fillText('+ New strand', leftCx + 10, startY + BASE_PAIRS.length * baseSpacing + 28);

        ctx.fillStyle = 'rgba(100, 180, 200, 0.6)';
        ctx.textAlign = 'center';
        ctx.fillText('Old strand', rightCx + 10, startY + BASE_PAIRS.length * baseSpacing + 16);
        ctx.fillStyle = 'rgba(200, 100, 100, 0.6)';
        ctx.fillText('+ New strand', rightCx - 10, startY + BASE_PAIRS.length * baseSpacing + 28);
      }

      // Base pair legend
      const legendY = h - 18;
      ctx.font = '10px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const pairs = [
        { b: 'A', c: '#cc4466' },
        { b: 'T', c: '#4488cc' },
        { b: 'G', c: '#44aa66' },
        { b: 'C', c: '#cc8844' },
      ];
      const legendW = 200;
      const legendStart = cx - legendW / 2;

      for (let i = 0; i < pairs.length; i++) {
        const lx = legendStart + i * 50 + 25;
        ctx.fillStyle = pairs[i].c;
        ctx.beginPath();
        ctx.arc(lx - 10, legendY, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(200, 200, 220, 0.6)';
        ctx.fillText(pairs[i].b, lx + 2, legendY);
      }

      // Pairing rules
      ctx.font = '9px "Segoe UI", sans-serif';
      ctx.fillStyle = 'rgba(180, 180, 200, 0.4)';
      ctx.textAlign = 'center';
      ctx.fillText('A=T  G\u2261C', cx, legendY - 14);

      // Step indicator
      ctx.font = 'bold 10px "Courier New", monospace';
      ctx.fillStyle = 'rgba(160, 180, 200, 0.5)';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      ctx.fillText(`Step ${step + 1}/${STEPS.length}`, w - 10, 10);
    },
    [currentStep]
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
      canvas.height = 480 * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = '480px';
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

  const goToStep = (idx: number) => {
    setCurrentStep(idx);
    stepRef.current = idx;
    animProgressRef.current = 0;
  };

  const stepForward = () => {
    if (currentStep < STEPS.length - 1) {
      goToStep(currentStep + 1);
    }
  };

  const stepBack = () => {
    if (currentStep > 0) {
      goToStep(currentStep - 1);
    }
  };

  const stepData = STEPS[currentStep];

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
        aria-label={`DNA replication simulation showing ${stepData.name} with animated base pairing and enzyme activity`}
        style={{
          width: '100%',
          height: 480,
          borderRadius: 16,
          display: 'block',
        }}
      />

      <div style={{ padding: '16px 4px 8px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Playback controls */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={stepBack} aria-label="Previous step" style={ctrlBtn('#5588aa')}>
            Prev
          </button>
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            aria-label={isPlaying ? 'Pause' : 'Play'}
            style={ctrlBtn(isPlaying ? '#cc6666' : '#66aa66')}
          >
            {isPlaying ? 'Pause' : 'Play'}
          </button>
          <button onClick={stepForward} aria-label="Next step" style={ctrlBtn('#5588aa')}>
            Next
          </button>
          <button
            onClick={() => setShowLabels(!showLabels)}
            aria-label={`Labels ${showLabels ? 'on' : 'off'}`}
            style={{ ...ctrlBtn('#aa88cc'), marginLeft: 'auto' }}
          >
            Labels: {showLabels ? 'ON' : 'OFF'}
          </button>
        </div>

        {/* Step indicator */}
        <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
          {STEPS.map((s, i) => (
            <button
              key={i}
              onClick={() => goToStep(i)}
              aria-label={`Go to step ${i + 1}: ${s.name}`}
              style={{
                width: i === currentStep ? 24 : 12,
                height: 8,
                borderRadius: 4,
                border: 'none',
                background:
                  i === currentStep
                    ? '#5588cc'
                    : i < currentStep
                    ? 'rgba(85, 136, 204, 0.4)'
                    : 'rgba(100,100,120,0.3)',
                cursor: 'pointer',
                transition: 'all 0.2s',
                padding: 0,
                minHeight: 0,
                minWidth: 0,
              }}
            />
          ))}
        </div>

        {/* Step detail panel */}
        <div
          style={{
            background: 'rgba(40, 60, 100, 0.1)',
            border: '1px solid rgba(60, 100, 160, 0.2)',
            borderRadius: 12,
            padding: 14,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <h3 style={{ margin: 0, color: '#6699cc', fontSize: 14, fontWeight: 700 }}>
            Step {currentStep + 1}: {stepData.name}
          </h3>
          <p style={{ margin: 0, color: 'rgba(200,200,220,0.85)', fontSize: 13, lineHeight: 1.6 }}>
            {stepData.description}
          </p>
          <div style={{ fontSize: 12, lineHeight: 1.5 }}>
            <span style={{ color: '#66aa88', fontWeight: 700 }}>Enzyme: </span>
            <span style={{ color: 'rgba(200,200,220,0.75)' }}>{stepData.enzyme}</span>
          </div>
          <div style={{ fontSize: 12, lineHeight: 1.5 }}>
            <span style={{ color: '#cc8866', fontWeight: 700 }}>Key Detail: </span>
            <span style={{ color: 'rgba(200,200,220,0.75)' }}>{stepData.detail}</span>
          </div>
        </div>

        {/* Discovery tip */}
        <p
          style={{
            margin: 0,
            padding: '8px 12px',
            background: 'rgba(85, 136, 204, 0.08)',
            border: '1px solid rgba(85, 136, 204, 0.2)',
            borderRadius: 10,
            color: 'rgba(150, 180, 220, 0.9)',
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          <strong>CBSE Ch6 Key Point:</strong> DNA replication is semi-conservative — each new DNA
          molecule has one old strand (template) and one new strand. The leading strand is
          synthesized continuously, while the lagging strand is made in short Okazaki fragments.
          Base pairing rules: A pairs with T (2 hydrogen bonds), G pairs with C (3 hydrogen bonds).
        </p>
      </div>
    </div>
  );
}

/* ─── Draw a base (nucleotide) ─── */
function drawBase(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  base: string,
  color: string,
  radius: number,
  isNew?: boolean
) {
  // Glow for new bases
  if (isNew) {
    const glow = ctx.createRadialGradient(x, y, 0, x, y, radius * 2);
    glow.addColorStop(0, color + '40');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(x - radius * 2, y - radius * 2, radius * 4, radius * 4);
  }

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.font = `bold ${radius < 5 ? 7 : 8}px "Courier New", monospace`;
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(base, x, y);
}

/* ─── Control button style ─── */
function ctrlBtn(color: string): React.CSSProperties {
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
