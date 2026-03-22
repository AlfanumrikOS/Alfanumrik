'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────────

interface Fraction {
  numerator: number;
  denominator: number;
}

interface Sparkle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
}

type Mode = 'single' | 'compare' | 'addition';

// ── Constants ──────────────────────────────────────────────────────────────────

const PIZZA_COLORS = {
  filledStart: '#F4A940',
  filledEnd: '#E8752A',
  pepperoni: '#C0392B',
  cheese: '#F7DC6F',
  empty: '#FFF5E6',
  emptyStroke: '#E8D5B7',
  crust: '#D4A056',
  crustDark: '#A67C3D',
  divider: '#C9965A',
  center: '#FCEABB',
};

const BAR_COLORS = {
  filled: '#F4A940',
  filledDark: '#E8752A',
  empty: '#FFF5E6',
  border: '#D4A056',
};

const SPARKLE_COLORS = ['#FFD700', '#FFA500', '#FF6347', '#FFE4B5', '#FFFFFF'];

const PRESETS: { label: string; fraction: Fraction }[] = [
  { label: '1/2', fraction: { numerator: 1, denominator: 2 } },
  { label: '1/3', fraction: { numerator: 1, denominator: 3 } },
  { label: '1/4', fraction: { numerator: 1, denominator: 4 } },
  { label: '2/3', fraction: { numerator: 2, denominator: 3 } },
  { label: '3/4', fraction: { numerator: 3, denominator: 4 } },
  { label: '5/8', fraction: { numerator: 5, denominator: 8 } },
];

// ── Utility functions ──────────────────────────────────────────────────────────

function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) {
    [a, b] = [b, a % b];
  }
  return a;
}

function lcm(a: number, b: number): number {
  return (a * b) / gcd(a, b);
}

function simplifyFraction(n: number, d: number): Fraction {
  const g = gcd(n, d);
  return { numerator: n / g, denominator: d / g };
}

function addFractions(f1: Fraction, f2: Fraction): Fraction {
  const commonDenom = lcm(f1.denominator, f2.denominator);
  const newNum =
    f1.numerator * (commonDenom / f1.denominator) +
    f2.numerator * (commonDenom / f2.denominator);
  return simplifyFraction(newNum, commonDenom);
}

function compareFractions(f1: Fraction, f2: Fraction): '<' | '>' | '=' {
  const v1 = f1.numerator / f1.denominator;
  const v2 = f2.numerator / f2.denominator;
  if (Math.abs(v1 - v2) < 0.0001) return '=';
  return v1 < v2 ? '<' : '>';
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function FractionVisualizer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [fraction1, setFraction1] = useState<Fraction>({ numerator: 1, denominator: 4 });
  const [fraction2, setFraction2] = useState<Fraction>({ numerator: 2, denominator: 3 });
  const [mode, setMode] = useState<Mode>('single');

  // Animation state refs (avoid re-renders on each frame)
  const animProgress1 = useRef(0);
  const animTarget1 = useRef(0);
  const animProgress2 = useRef(0);
  const animTarget2 = useRef(0);
  const sparklesRef = useRef<Sparkle[]>([]);
  const rafRef = useRef<number>(0);
  const prevFraction1 = useRef<Fraction>({ numerator: 0, denominator: 4 });
  const prevFraction2 = useRef<Fraction>({ numerator: 0, denominator: 3 });

  // ── Sparkle helpers ────────────────────────────────────────────────────────

  const spawnSparkles = useCallback(
    (cx: number, cy: number, radius: number, sliceIndex: number, denominator: number) => {
      const angleStart = -Math.PI / 2 + (sliceIndex * 2 * Math.PI) / denominator;
      const angleMid = angleStart + Math.PI / denominator;
      const r = radius * 0.6;
      const sx = cx + Math.cos(angleMid) * r;
      const sy = cy + Math.sin(angleMid) * r;

      for (let i = 0; i < 6; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 0.5 + Math.random() * 1.5;
        sparklesRef.current.push({
          x: sx,
          y: sy,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 1,
          maxLife: 30 + Math.random() * 20,
          size: 2 + Math.random() * 3,
          color: SPARKLE_COLORS[Math.floor(Math.random() * SPARKLE_COLORS.length)],
        });
      }
    },
    []
  );

  const updateSparkles = useCallback(() => {
    sparklesRef.current = sparklesRef.current.filter((s) => {
      s.x += s.vx;
      s.y += s.vy;
      s.vy += 0.03;
      s.life -= 1 / s.maxLife;
      return s.life > 0;
    });
  }, []);

  // ── Drawing helpers ────────────────────────────────────────────────────────

  const drawPizza = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      cx: number,
      cy: number,
      radius: number,
      fraction: Fraction,
      fillProgress: number
    ) => {
      const { numerator, denominator } = fraction;
      const sliceAngle = (2 * Math.PI) / denominator;

      // Shadow
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(cx, cy + 6, radius + 2, radius * 0.25 + 2, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.fill();
      ctx.restore();

      // Draw each slice
      for (let i = 0; i < denominator; i++) {
        const startAngle = -Math.PI / 2 + i * sliceAngle;
        const endAngle = startAngle + sliceAngle;

        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, radius, startAngle, endAngle);
        ctx.closePath();

        // Determine fill based on animation progress
        const sliceThreshold = i + 1;
        const isFilled = sliceThreshold <= fillProgress * denominator;
        const isPartial =
          !isFilled && sliceThreshold - 1 < fillProgress * denominator;

        if (isFilled || (isPartial && i < numerator)) {
          const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
          grad.addColorStop(0, PIZZA_COLORS.cheese);
          grad.addColorStop(0.3, PIZZA_COLORS.filledStart);
          grad.addColorStop(1, PIZZA_COLORS.filledEnd);
          ctx.fillStyle = grad;
          ctx.fill();

          // Pepperoni dots
          const midAngle = (startAngle + endAngle) / 2;
          const pepR = radius * 0.55;
          const px = cx + Math.cos(midAngle) * pepR;
          const py = cy + Math.sin(midAngle) * pepR;
          ctx.beginPath();
          ctx.arc(px, py, radius * 0.07, 0, Math.PI * 2);
          ctx.fillStyle = PIZZA_COLORS.pepperoni;
          ctx.fill();

          // Small pepperoni
          const pepR2 = radius * 0.35;
          const px2 = cx + Math.cos(midAngle + 0.3) * pepR2;
          const py2 = cy + Math.sin(midAngle + 0.3) * pepR2;
          ctx.beginPath();
          ctx.arc(px2, py2, radius * 0.045, 0, Math.PI * 2);
          ctx.fillStyle = PIZZA_COLORS.pepperoni;
          ctx.fill();
        } else {
          ctx.fillStyle = PIZZA_COLORS.empty;
          ctx.fill();
        }

        // Slice border
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, radius, startAngle, endAngle);
        ctx.closePath();
        ctx.strokeStyle = PIZZA_COLORS.divider;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // Crust ring
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.strokeStyle = PIZZA_COLORS.crust;
      ctx.lineWidth = 6;
      ctx.stroke();
      ctx.strokeStyle = PIZZA_COLORS.crustDark;
      ctx.lineWidth = 2;
      ctx.stroke();

      // Center dot
      ctx.beginPath();
      ctx.arc(cx, cy, 4, 0, Math.PI * 2);
      ctx.fillStyle = PIZZA_COLORS.center;
      ctx.fill();
    },
    []
  );

  const drawBar = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      x: number,
      y: number,
      width: number,
      height: number,
      fraction: Fraction,
      fillProgress: number
    ) => {
      const { numerator, denominator } = fraction;
      const partWidth = width / denominator;

      // Shadow
      ctx.fillStyle = 'rgba(0,0,0,0.08)';
      roundRect(ctx, x + 2, y + 3, width, height, 8);
      ctx.fill();

      for (let i = 0; i < denominator; i++) {
        const px = x + i * partWidth;
        const isFilled = i + 1 <= fillProgress * denominator;
        const isTarget = i < numerator;

        ctx.beginPath();
        roundRect(ctx, px + 1, y, partWidth - 2, height, i === 0 ? 8 : i === denominator - 1 ? 8 : 2);

        if (isFilled && isTarget) {
          const grad = ctx.createLinearGradient(px, y, px, y + height);
          grad.addColorStop(0, BAR_COLORS.filled);
          grad.addColorStop(1, BAR_COLORS.filledDark);
          ctx.fillStyle = grad;
        } else {
          ctx.fillStyle = BAR_COLORS.empty;
        }
        ctx.fill();
        ctx.strokeStyle = BAR_COLORS.border;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // Outer border
      ctx.beginPath();
      roundRect(ctx, x, y, width, height, 8);
      ctx.strokeStyle = BAR_COLORS.border;
      ctx.lineWidth = 2;
      ctx.stroke();
    },
    []
  );

  const drawSparkles = useCallback((ctx: CanvasRenderingContext2D) => {
    for (const s of sparklesRef.current) {
      ctx.save();
      ctx.globalAlpha = s.life;
      ctx.fillStyle = s.color;

      // Star shape
      ctx.beginPath();
      const spikes = 4;
      for (let j = 0; j < spikes * 2; j++) {
        const r = j % 2 === 0 ? s.size : s.size * 0.4;
        const angle = (j * Math.PI) / spikes - Math.PI / 2;
        const sx = s.x + Math.cos(angle) * r;
        const sy = s.y + Math.sin(angle) * r;
        if (j === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }, []);

  const drawFractionText = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      cx: number,
      cy: number,
      fraction: Fraction,
      showExtras: boolean
    ) => {
      const { numerator, denominator } = fraction;

      // Fraction display
      ctx.fillStyle = '#5D4037';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // Numerator
      ctx.font = 'bold 28px "Comic Sans MS", "Segoe UI", sans-serif';
      ctx.fillText(`${numerator}`, cx, cy - 16);

      // Line
      ctx.beginPath();
      ctx.moveTo(cx - 22, cy);
      ctx.lineTo(cx + 22, cy);
      ctx.strokeStyle = '#5D4037';
      ctx.lineWidth = 3;
      ctx.stroke();

      // Denominator
      ctx.fillText(`${denominator}`, cx, cy + 18);

      if (showExtras) {
        // Decimal
        const decimal = denominator === 0 ? 0 : numerator / denominator;
        ctx.font = '16px "Segoe UI", sans-serif';
        ctx.fillStyle = '#8D6E63';
        ctx.fillText(`= ${decimal.toFixed(2)}`, cx, cy + 44);

        // Percentage
        ctx.fillText(`= ${(decimal * 100).toFixed(1)}%`, cx, cy + 64);
      }
    },
    []
  );

  // ── Main render loop ───────────────────────────────────────────────────────

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width;
    const h = 400;

    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.height = `${h}px`;
    ctx.scale(dpr, dpr);

    // Clear
    ctx.clearRect(0, 0, w, h);

    // Background gradient
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#FFFDF7');
    bg.addColorStop(1, '#FFF8EE');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    // Animate progress toward target
    const animSpeed = 0.04;
    animTarget1.current = fraction1.numerator / Math.max(fraction1.denominator, 1);
    animTarget2.current = fraction2.numerator / Math.max(fraction2.denominator, 1);

    const diff1 = animTarget1.current - animProgress1.current;
    if (Math.abs(diff1) > 0.005) {
      animProgress1.current += diff1 * animSpeed * 3;
    } else {
      animProgress1.current = animTarget1.current;
    }

    const diff2 = animTarget2.current - animProgress2.current;
    if (Math.abs(diff2) > 0.005) {
      animProgress2.current += diff2 * animSpeed * 3;
    } else {
      animProgress2.current = animTarget2.current;
    }

    // Spawn sparkles when fraction changes
    if (
      prevFraction1.current.numerator !== fraction1.numerator ||
      prevFraction1.current.denominator !== fraction1.denominator
    ) {
      const pizzaCx = mode === 'single' ? w / 2 : w / 4;
      const pizzaCy = 130;
      const pizzaR = mode === 'single' ? Math.min(110, w / 4) : Math.min(85, w / 6);
      for (let i = 0; i < fraction1.numerator; i++) {
        spawnSparkles(pizzaCx, pizzaCy, pizzaR, i, fraction1.denominator);
      }
      prevFraction1.current = { ...fraction1 };
    }

    if (
      (mode === 'compare' || mode === 'addition') &&
      (prevFraction2.current.numerator !== fraction2.numerator ||
        prevFraction2.current.denominator !== fraction2.denominator)
    ) {
      const pizzaCx = (3 * w) / 4;
      const pizzaCy = 130;
      const pizzaR = Math.min(85, w / 6);
      for (let i = 0; i < fraction2.numerator; i++) {
        spawnSparkles(pizzaCx, pizzaCy, pizzaR, i, fraction2.denominator);
      }
      prevFraction2.current = { ...fraction2 };
    }

    updateSparkles();

    // ── Draw based on mode ──────────────────────────────────────────────────

    if (mode === 'single') {
      const pizzaCx = w / 2;
      const pizzaCy = 130;
      const pizzaR = Math.min(110, w / 4);

      drawPizza(ctx, pizzaCx, pizzaCy, pizzaR, fraction1, animProgress1.current);

      // Bar model
      const barW = Math.min(300, w - 60);
      const barX = (w - barW) / 2;
      drawBar(ctx, barX, 270, barW, 30, fraction1, animProgress1.current);

      // Fraction text
      drawFractionText(ctx, w / 2, 335, fraction1, true);
    } else if (mode === 'compare') {
      const pizzaR = Math.min(85, w / 6);

      // Left pizza
      drawPizza(ctx, w / 4, 120, pizzaR, fraction1, animProgress1.current);
      // Right pizza
      drawPizza(ctx, (3 * w) / 4, 120, pizzaR, fraction2, animProgress2.current);

      // Comparison symbol
      const cmp = compareFractions(fraction1, fraction2);
      ctx.font = 'bold 48px "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = cmp === '=' ? '#27AE60' : '#E74C3C';
      ctx.fillText(cmp, w / 2, 120);

      // Bars
      const barW = Math.min(180, w / 2 - 40);
      drawBar(ctx, w / 4 - barW / 2, 240, barW, 24, fraction1, animProgress1.current);
      drawBar(ctx, (3 * w) / 4 - barW / 2, 240, barW, 24, fraction2, animProgress2.current);

      // Fraction texts
      drawFractionText(ctx, w / 4, 310, fraction1, false);
      drawFractionText(ctx, (3 * w) / 4, 310, fraction2, false);

      // Decimal values
      const d1 = fraction1.numerator / Math.max(fraction1.denominator, 1);
      const d2 = fraction2.numerator / Math.max(fraction2.denominator, 1);
      ctx.font = '14px "Segoe UI", sans-serif';
      ctx.fillStyle = '#8D6E63';
      ctx.fillText(`(${d1.toFixed(2)})`, w / 4, 350);
      ctx.fillText(`(${d2.toFixed(2)})`, (3 * w) / 4, 350);
    } else if (mode === 'addition') {
      const result = addFractions(fraction1, fraction2);
      const pizzaR = Math.min(65, w / 8);
      const spacing = w / 5;

      // Pizza 1
      drawPizza(ctx, spacing, 100, pizzaR, fraction1, animProgress1.current);
      // Plus sign
      ctx.font = 'bold 36px "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#5D4037';
      ctx.fillText('+', spacing * 2, 100);
      // Pizza 2
      drawPizza(ctx, spacing * 3, 100, pizzaR, fraction2, animProgress2.current);
      // Equals sign
      ctx.fillText('=', spacing * 4 - spacing / 2, 100);

      // Result fraction text
      drawFractionText(ctx, spacing * 4 + 10, 90, result, false);

      // Bars
      const barW = Math.min(140, w / 4 - 20);
      drawBar(ctx, spacing - barW / 2, 190, barW, 20, fraction1, animProgress1.current);
      drawBar(ctx, spacing * 3 - barW / 2, 190, barW, 20, fraction2, animProgress2.current);

      // Result bar (use unsimplified for visual)
      const commonDenom = lcm(fraction1.denominator, fraction2.denominator);
      const resultNum =
        fraction1.numerator * (commonDenom / fraction1.denominator) +
        fraction2.numerator * (commonDenom / fraction2.denominator);
      const resultBarFrac: Fraction = { numerator: Math.min(resultNum, commonDenom), denominator: commonDenom };
      drawBar(ctx, spacing * 3 + spacing / 2, 190, barW, 20, resultBarFrac, 1);

      // Labels
      ctx.font = 'bold 20px "Comic Sans MS", "Segoe UI", sans-serif';
      ctx.fillStyle = '#5D4037';
      ctx.textAlign = 'center';
      drawFractionText(ctx, spacing, 250, fraction1, false);
      ctx.font = 'bold 20px "Segoe UI", sans-serif';
      ctx.fillText('+', spacing * 2, 260);
      drawFractionText(ctx, spacing * 3, 250, fraction2, false);
      ctx.font = 'bold 20px "Segoe UI", sans-serif';
      ctx.fillText('=', spacing * 4 - spacing / 2, 260);
      drawFractionText(ctx, spacing * 4 + 10, 250, result, false);

      // Show decimal result
      const decResult = result.numerator / Math.max(result.denominator, 1);
      ctx.font = '16px "Segoe UI", sans-serif';
      ctx.fillStyle = '#27AE60';
      ctx.textAlign = 'center';
      ctx.fillText(
        `Result: ${result.numerator}/${result.denominator} = ${decResult.toFixed(2)} = ${(decResult * 100).toFixed(1)}%`,
        w / 2,
        330
      );

      if (resultNum > commonDenom) {
        ctx.font = '14px "Segoe UI", sans-serif';
        ctx.fillStyle = '#E74C3C';
        ctx.fillText(
          `That's more than 1 whole pizza! (${resultNum}/${commonDenom} before simplifying)`,
          w / 2,
          360
        );
      }
    }

    // Draw sparkles on top
    drawSparkles(ctx);

    // Continue animation if needed
    const needsAnim =
      Math.abs(animProgress1.current - animTarget1.current) > 0.005 ||
      Math.abs(animProgress2.current - animTarget2.current) > 0.005 ||
      sparklesRef.current.length > 0;

    if (needsAnim) {
      rafRef.current = requestAnimationFrame(render);
    }
  }, [
    fraction1,
    fraction2,
    mode,
    drawPizza,
    drawBar,
    drawFractionText,
    drawSparkles,
    spawnSparkles,
    updateSparkles,
  ]);

  // ── Effects ────────────────────────────────────────────────────────────────

  useEffect(() => {
    rafRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafRef.current);
  }, [render]);

  // Resize handler
  useEffect(() => {
    const handleResize = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(render);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [render]);

  // ── Input handlers ─────────────────────────────────────────────────────────

  const updateFraction1 = useCallback((field: 'numerator' | 'denominator', value: number) => {
    setFraction1((prev) => {
      const next = { ...prev, [field]: value };
      if (field === 'denominator') {
        next.denominator = clamp(value, 1, 12);
        next.numerator = clamp(prev.numerator, 0, next.denominator);
      } else {
        next.numerator = clamp(value, 0, prev.denominator);
      }
      return next;
    });
    // Kick animation
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(render);
  }, [render]);

  const updateFraction2 = useCallback((field: 'numerator' | 'denominator', value: number) => {
    setFraction2((prev) => {
      const next = { ...prev, [field]: value };
      if (field === 'denominator') {
        next.denominator = clamp(value, 1, 12);
        next.numerator = clamp(prev.numerator, 0, next.denominator);
      } else {
        next.numerator = clamp(value, 0, prev.denominator);
      }
      return next;
    });
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(render);
  }, [render]);

  const applyPreset = useCallback(
    (fraction: Fraction, target: 1 | 2) => {
      if (target === 1) {
        setFraction1(fraction);
      } else {
        setFraction2(fraction);
      }
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(render);
    },
    [render]
  );

  // ── Styles ─────────────────────────────────────────────────────────────────

  const containerStyle: React.CSSProperties = {
    width: '100%',
    maxWidth: 800,
    margin: '0 auto',
    fontFamily: '"Segoe UI", "Comic Sans MS", sans-serif',
    background: 'linear-gradient(135deg, #FFFDF7 0%, #FFF3E0 100%)',
    borderRadius: 16,
    boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
    overflow: 'hidden',
  };

  const headerStyle: React.CSSProperties = {
    textAlign: 'center',
    padding: '16px 16px 8px',
    background: 'linear-gradient(90deg, #F4A940, #E8752A)',
    color: 'white',
  };

  const controlsStyle: React.CSSProperties = {
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  };

  const rowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
    justifyContent: 'center',
  };

  const labelStyle: React.CSSProperties = {
    fontWeight: 600,
    color: '#5D4037',
    fontSize: 14,
    minWidth: 90,
  };

  const inputStyle: React.CSSProperties = {
    width: 56,
    padding: '6px 8px',
    borderRadius: 8,
    border: '2px solid #E8D5B7',
    fontSize: 16,
    textAlign: 'center',
    outline: 'none',
    fontWeight: 600,
    color: '#5D4037',
    background: '#FFFDF7',
  };

  const sliderStyle: React.CSSProperties = {
    width: 120,
    accentColor: '#F4A940',
  };

  const btnBase: React.CSSProperties = {
    padding: '8px 16px',
    borderRadius: 10,
    border: 'none',
    cursor: 'pointer',
    fontWeight: 700,
    fontSize: 14,
    transition: 'all 0.15s ease',
  };

  const presetBtnStyle: React.CSSProperties = {
    ...btnBase,
    background: '#FFF5E6',
    color: '#A67C3D',
    border: '2px solid #E8D5B7',
  };

  const modeBtnStyle = (active: boolean): React.CSSProperties => ({
    ...btnBase,
    background: active
      ? 'linear-gradient(135deg, #F4A940, #E8752A)'
      : '#FFF5E6',
    color: active ? 'white' : '#A67C3D',
    border: active ? '2px solid #E8752A' : '2px solid #E8D5B7',
    boxShadow: active ? '0 2px 8px rgba(232,117,42,0.3)' : 'none',
  });

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <h2 style={{ margin: 0, fontSize: 22 }}>
          Pizza Fraction Visualizer
        </h2>
        <p style={{ margin: '4px 0 0', fontSize: 13, opacity: 0.9 }}>
          Learn fractions with pizza slices!
        </p>
      </div>

      {/* Canvas */}
      <canvas
        ref={canvasRef}
        style={{ width: '100%', display: 'block', cursor: 'default' }}
      />

      {/* Controls */}
      <div style={controlsStyle}>
        {/* Mode selector */}
        <div style={rowStyle}>
          <button
            style={modeBtnStyle(mode === 'single')}
            onClick={() => setMode('single')}
          >
            Single
          </button>
          <button
            style={modeBtnStyle(mode === 'compare')}
            onClick={() => setMode('compare')}
          >
            Compare
          </button>
          <button
            style={modeBtnStyle(mode === 'addition')}
            onClick={() => setMode('addition')}
          >
            Add
          </button>
        </div>

        {/* Fraction 1 controls */}
        <div
          style={{
            background: '#FFFDF7',
            borderRadius: 12,
            padding: '12px 16px',
            border: '1px solid #E8D5B7',
          }}
        >
          <div style={rowStyle}>
            <span style={labelStyle}>
              {mode !== 'single' ? 'Fraction 1:' : 'Fraction:'}
            </span>
            <span style={{ color: '#8D6E63', fontSize: 13 }}>Numerator</span>
            <input
              type="number"
              min={0}
              max={fraction1.denominator}
              value={fraction1.numerator}
              onChange={(e) =>
                updateFraction1('numerator', parseInt(e.target.value) || 0)
              }
              style={inputStyle}
            />
            <input
              type="range"
              min={0}
              max={fraction1.denominator}
              value={fraction1.numerator}
              onChange={(e) =>
                updateFraction1('numerator', parseInt(e.target.value))
              }
              style={sliderStyle}
            />
          </div>
          <div style={{ ...rowStyle, marginTop: 8 }}>
            <span style={labelStyle} />
            <span style={{ color: '#8D6E63', fontSize: 13 }}>Denominator</span>
            <input
              type="number"
              min={1}
              max={12}
              value={fraction1.denominator}
              onChange={(e) =>
                updateFraction1('denominator', parseInt(e.target.value) || 1)
              }
              style={inputStyle}
            />
            <input
              type="range"
              min={1}
              max={12}
              value={fraction1.denominator}
              onChange={(e) =>
                updateFraction1('denominator', parseInt(e.target.value))
              }
              style={sliderStyle}
            />
          </div>
          <div style={{ ...rowStyle, marginTop: 8 }}>
            <span style={{ ...labelStyle, minWidth: 'auto' }}>Quick:</span>
            {PRESETS.map((p) => (
              <button
                key={`p1-${p.label}`}
                style={presetBtnStyle}
                onClick={() => applyPreset(p.fraction, 1)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Fraction 2 controls (compare/addition mode) */}
        {mode !== 'single' && (
          <div
            style={{
              background: '#FFFDF7',
              borderRadius: 12,
              padding: '12px 16px',
              border: '1px solid #E8D5B7',
            }}
          >
            <div style={rowStyle}>
              <span style={labelStyle}>Fraction 2:</span>
              <span style={{ color: '#8D6E63', fontSize: 13 }}>Numerator</span>
              <input
                type="number"
                min={0}
                max={fraction2.denominator}
                value={fraction2.numerator}
                onChange={(e) =>
                  updateFraction2('numerator', parseInt(e.target.value) || 0)
                }
                style={inputStyle}
              />
              <input
                type="range"
                min={0}
                max={fraction2.denominator}
                value={fraction2.numerator}
                onChange={(e) =>
                  updateFraction2('numerator', parseInt(e.target.value))
                }
                style={sliderStyle}
              />
            </div>
            <div style={{ ...rowStyle, marginTop: 8 }}>
              <span style={labelStyle} />
              <span style={{ color: '#8D6E63', fontSize: 13 }}>
                Denominator
              </span>
              <input
                type="number"
                min={1}
                max={12}
                value={fraction2.denominator}
                onChange={(e) =>
                  updateFraction2('denominator', parseInt(e.target.value) || 1)
                }
                style={inputStyle}
              />
              <input
                type="range"
                min={1}
                max={12}
                value={fraction2.denominator}
                onChange={(e) =>
                  updateFraction2('denominator', parseInt(e.target.value))
                }
                style={sliderStyle}
              />
            </div>
            <div style={{ ...rowStyle, marginTop: 8 }}>
              <span style={{ ...labelStyle, minWidth: 'auto' }}>Quick:</span>
              {PRESETS.map((p) => (
                <button
                  key={`p2-${p.label}`}
                  style={presetBtnStyle}
                  onClick={() => applyPreset(p.fraction, 2)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Canvas helper ──────────────────────────────────────────────────────────────

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
