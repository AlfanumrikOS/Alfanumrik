'use client';

import { useRef, useEffect } from 'react';

/* ═══════════════════════════════════════════════════════════════
   VoiceWaveform — Smooth audio visualizer for Foxy voice output
   Uses AnalyserNode frequency data for real-time bars.
   Falls back to a gentle idle animation when no analyser.
   ═══════════════════════════════════════════════════════════════ */

interface VoiceWaveformProps {
  analyserNode: AnalyserNode | null;
  isActive: boolean;
  color?: string;
  barCount?: number;
  className?: string;
}

export function VoiceWaveform({
  analyserNode,
  isActive,
  color = '#E8581C',
  barCount = 24,
  className = '',
}: VoiceWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const phaseRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // HiDPI support
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    const barWidth = Math.max(2, (w / barCount) * 0.6);
    const gap = (w - barWidth * barCount) / (barCount - 1);

    let dataArray: Uint8Array<ArrayBuffer> | null = null;
    if (analyserNode) {
      dataArray = new Uint8Array(analyserNode.frequencyBinCount) as Uint8Array<ArrayBuffer>;
    }

    function draw() {
      if (!ctx) return;
      ctx.clearRect(0, 0, w, h);

      if (analyserNode && dataArray && isActive) {
        // Real audio data
        analyserNode.getByteFrequencyData(dataArray);
        const step = Math.floor(dataArray.length / barCount);

        for (let i = 0; i < barCount; i++) {
          const val = dataArray[i * step] / 255;
          const barH = Math.max(3, val * h * 0.85);
          const x = i * (barWidth + gap);
          const y = (h - barH) / 2;

          ctx.fillStyle = color;
          ctx.globalAlpha = 0.4 + val * 0.6;
          ctx.beginPath();
          ctx.roundRect(x, y, barWidth, barH, barWidth / 2);
          ctx.fill();
        }
      } else if (isActive) {
        // Idle breathing animation when speaking but no analyser (Web Speech API fallback)
        phaseRef.current += 0.04;
        for (let i = 0; i < barCount; i++) {
          const wave = Math.sin(phaseRef.current + i * 0.4) * 0.3 + 0.4;
          const barH = Math.max(3, wave * h * 0.7);
          const x = i * (barWidth + gap);
          const y = (h - barH) / 2;

          ctx.fillStyle = color;
          ctx.globalAlpha = 0.3 + wave * 0.5;
          ctx.beginPath();
          ctx.roundRect(x, y, barWidth, barH, barWidth / 2);
          ctx.fill();
        }
      } else {
        // Flat line when idle
        for (let i = 0; i < barCount; i++) {
          const x = i * (barWidth + gap);
          const y = (h - 3) / 2;
          ctx.fillStyle = color;
          ctx.globalAlpha = 0.15;
          ctx.beginPath();
          ctx.roundRect(x, y, barWidth, 3, 1.5);
          ctx.fill();
        }
      }

      ctx.globalAlpha = 1;
      animRef.current = requestAnimationFrame(draw);
    }

    draw();
    return () => cancelAnimationFrame(animRef.current);
  }, [analyserNode, isActive, color, barCount]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: '100%', height: '100%' }}
    />
  );
}
