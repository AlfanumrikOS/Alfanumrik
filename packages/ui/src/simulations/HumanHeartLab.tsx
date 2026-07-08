'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';

/* ─── Constants ─── */
const DEFAULT_BPM = 72;
const MIN_BPM = 40;
const MAX_BPM = 120;

interface BloodParticle {
  pathIndex: number; // which path segment it's on
  t: number; // progress along segment [0, 1]
  oxygenated: boolean;
}

interface ValveState {
  open: boolean;
  angle: number; // animation angle
}

export default function HumanHeartLab() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number>(0);

  const bpmRef = useRef(DEFAULT_BPM);
  const showLabelsRef = useRef(true);
  const showValvesRef = useRef(true);
  const particlesRef = useRef<BloodParticle[]>([]);
  const valvesRef = useRef<ValveState[]>([
    { open: false, angle: 0 }, // tricuspid (RA->RV)
    { open: false, angle: 0 }, // pulmonary (RV->lungs)
    { open: false, angle: 0 }, // mitral (LA->LV)
    { open: false, angle: 0 }, // aortic (LV->body)
  ]);

  const [bpm, setBpm] = useState(DEFAULT_BPM);
  const [showLabels, setShowLabels] = useState(true);
  const [showValves, setShowValves] = useState(true);

  useEffect(() => { bpmRef.current = bpm; }, [bpm]);
  useEffect(() => { showLabelsRef.current = showLabels; }, [showLabels]);
  useEffect(() => { showValvesRef.current = showValves; }, [showValves]);

  // Initialize blood particles
  useEffect(() => {
    const particles: BloodParticle[] = [];
    // Distribute particles across all 8 path segments
    for (let seg = 0; seg < 8; seg++) {
      const count = 5;
      for (let i = 0; i < count; i++) {
        particles.push({
          pathIndex: seg,
          t: i / count,
          oxygenated: seg >= 4, // segments 4-7 are oxygenated
        });
      }
    }
    particlesRef.current = particles;
  }, []);

  /*
   * Heart anatomy paths (8 segments forming the double circulation loop):
   * 0: Vena cava -> Right Atrium (deoxy)
   * 1: Right Atrium -> Right Ventricle (deoxy, through tricuspid)
   * 2: Right Ventricle -> Pulmonary Artery (deoxy, through pulmonary valve)
   * 3: Pulmonary Artery -> Lungs (deoxy -> oxy transition)
   * 4: Lungs -> Pulmonary Vein (oxy)
   * 5: Pulmonary Vein -> Left Atrium (oxy)
   * 6: Left Atrium -> Left Ventricle (oxy, through mitral)
   * 7: Left Ventricle -> Aorta -> Body -> Vena cava (oxy -> deoxy transition)
   */

  const draw = useCallback((ctx: CanvasRenderingContext2D, W: number, H: number, time: number) => {
    const dpr = window.devicePixelRatio || 1;
    const w = W / dpr;
    const h = H / dpr;

    const BPM = bpmRef.current;
    const beatPeriod = 60 / BPM; // seconds
    const beatPhase = ((time / 1000) % beatPeriod) / beatPeriod; // 0-1 within one beat

    // Heart cycle phases:
    // 0.0-0.35: atrial systole (atria contract, AV valves open)
    // 0.35-0.65: ventricular systole (ventricles contract, semilunar valves open)
    // 0.65-1.0: diastole (relaxation)

    const atrialSystole = beatPhase < 0.35;
    const ventricularSystole = beatPhase >= 0.35 && beatPhase < 0.65;

    // Valve states
    const valves = valvesRef.current;
    valves[0].open = atrialSystole;     // tricuspid
    valves[1].open = ventricularSystole; // pulmonary
    valves[2].open = atrialSystole;     // mitral
    valves[3].open = ventricularSystole; // aortic

    // Smooth valve animation
    for (const v of valves) {
      const target = v.open ? 1 : 0;
      v.angle += (target - v.angle) * 0.15;
    }

    /* ─── Background ─── */
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#1a0a1e');
    bg.addColorStop(0.5, '#180820');
    bg.addColorStop(1, '#120618');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    /* ─── Heart geometry ─── */
    const cx = w / 2;
    const cy = h * 0.44;
    const heartW = Math.min(w * 0.65, 280);
    const heartH = heartW * 1.05;

    // Pulsing scale
    let pulseScale = 1;
    if (atrialSystole) {
      const p = beatPhase / 0.35;
      pulseScale = 1 + 0.02 * Math.sin(p * Math.PI);
    } else if (ventricularSystole) {
      const p = (beatPhase - 0.35) / 0.3;
      pulseScale = 1 + 0.035 * Math.sin(p * Math.PI);
    }

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(pulseScale, pulseScale);
    ctx.translate(-cx, -cy);

    /* ─── Heart outline (simplified) ─── */
    const heartGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, heartW * 0.8);
    heartGlow.addColorStop(0, 'rgba(180, 40, 60, 0.12)');
    heartGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = heartGlow;
    ctx.fillRect(cx - heartW, cy - heartH, heartW * 2, heartH * 2);

    // Heart wall (muscular)
    ctx.strokeStyle = 'rgba(180, 60, 70, 0.7)';
    ctx.lineWidth = 4;
    ctx.fillStyle = 'rgba(130, 30, 45, 0.3)';
    ctx.beginPath();
    ctx.roundRect(cx - heartW / 2, cy - heartH / 2, heartW, heartH, 20);
    ctx.fill();
    ctx.stroke();

    /* ─── Septum (vertical divider) ─── */
    const septumX = cx;
    ctx.strokeStyle = 'rgba(160, 50, 60, 0.9)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(septumX, cy - heartH / 2 + 15);
    ctx.lineTo(septumX, cy + heartH / 2 - 15);
    ctx.stroke();

    // Horizontal divider (between atria and ventricles)
    const divY = cy - heartH * 0.05;
    ctx.strokeStyle = 'rgba(160, 50, 60, 0.6)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx - heartW / 2 + 10, divY);
    ctx.lineTo(cx + heartW / 2 - 10, divY);
    ctx.stroke();

    /* ─── Chambers ─── */
    const chamberPad = 12;
    const halfW = heartW / 2 - chamberPad;
    const upperH = heartH * 0.4;
    const lowerH = heartH * 0.45;

    // Chamber positions
    const raX = cx + chamberPad / 2;      // Right atrium is on LEFT of screen (anatomical position)
    const raY = cy - heartH / 2 + chamberPad;
    const rvX = cx + chamberPad / 2;
    const rvY = divY + 4;
    const laX = cx - halfW;               // Left atrium is on RIGHT of screen
    const laY = cy - heartH / 2 + chamberPad;
    const lvX = cx - halfW;
    const lvY = divY + 4;

    // Chamber fill colors: blue = deoxygenated (right side), red = oxygenated (left side)
    const deoxyColor = 'rgba(60, 80, 160, 0.35)';
    const oxyColor = 'rgba(180, 40, 50, 0.35)';

    // Atrial contraction animation
    const atrialSqueeze = atrialSystole ? 0.9 + 0.1 * Math.cos(beatPhase / 0.35 * Math.PI) : 1;
    const ventSqueeze = ventricularSystole ? 0.88 + 0.12 * Math.cos((beatPhase - 0.35) / 0.3 * Math.PI) : 1;

    // Right Atrium (screen left-top... wait, anatomical: right side of heart = screen left)
    // Actually, in anatomical diagrams viewed from front: right side = viewer's left
    // Let's use: RIGHT side of screen = right side of heart (for simplicity/CBSE standard)
    // Re-mapping: Right heart = RIGHT side of screen

    ctx.fillStyle = deoxyColor;
    ctx.beginPath();
    ctx.roundRect(raX, raY, halfW * atrialSqueeze, upperH, 8);
    ctx.fill();

    // Right Ventricle
    ctx.fillStyle = deoxyColor;
    ctx.beginPath();
    ctx.roundRect(rvX, rvY, halfW * ventSqueeze, lowerH, 8);
    ctx.fill();

    // Left Atrium
    ctx.fillStyle = oxyColor;
    ctx.beginPath();
    ctx.roundRect(laX, laY, halfW * atrialSqueeze, upperH, 8);
    ctx.fill();

    // Left Ventricle (thicker wall indicated by brighter border)
    ctx.fillStyle = oxyColor;
    ctx.beginPath();
    ctx.roundRect(lvX, lvY, halfW * ventSqueeze, lowerH, 8);
    ctx.fill();

    // Thicker left ventricle wall indicator
    ctx.strokeStyle = 'rgba(200, 60, 70, 0.6)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.roundRect(lvX - 2, lvY, halfW * ventSqueeze + 4, lowerH, 8);
    ctx.stroke();

    /* ─── Valves ─── */
    if (showValvesRef.current) {
      const drawValve = (x: number, y: number, openAmount: number, color: string) => {
        const size = 8;
        const leafAngle = openAmount * 0.7;

        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5;

        // Left leaflet
        ctx.beginPath();
        ctx.moveTo(x - 2, y);
        ctx.lineTo(x - 2 - size * Math.cos(leafAngle), y + size * Math.sin(leafAngle));
        ctx.stroke();

        // Right leaflet
        ctx.beginPath();
        ctx.moveTo(x + 2, y);
        ctx.lineTo(x + 2 + size * Math.cos(leafAngle), y + size * Math.sin(leafAngle));
        ctx.stroke();

        // Status dot
        ctx.fillStyle = openAmount > 0.5 ? '#66ff66' : '#ff6666';
        ctx.beginPath();
        ctx.arc(x, y - 6, 3, 0, Math.PI * 2);
        ctx.fill();
      };

      // Tricuspid (between RA and RV)
      drawValve(raX + halfW / 2, divY, valves[0].angle, '#8888ff');
      // Pulmonary (top of RV, going to lungs)
      drawValve(raX + halfW * 0.7, raY - 2, valves[1].angle, '#8888ff');
      // Mitral (between LA and LV)
      drawValve(laX + halfW / 2, divY, valves[2].angle, '#ff8888');
      // Aortic (top of LV, going to body)
      drawValve(laX + halfW * 0.3, laY - 2, valves[3].angle, '#ff8888');
    }

    /* ─── Blood vessels ─── */
    const vesselW = 14;

    // Superior/Inferior Vena Cava (into RA from right)
    ctx.strokeStyle = '#4466bb';
    ctx.lineWidth = vesselW;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(w - 10, raY + 15);
    ctx.quadraticCurveTo(w * 0.82, raY + 15, raX + halfW, raY + 20);
    ctx.stroke();
    // Inferior
    ctx.beginPath();
    ctx.moveTo(w - 10, cy + heartH * 0.5 + 20);
    ctx.quadraticCurveTo(w * 0.82, cy + heartH * 0.3, raX + halfW, rvY + lowerH - 20);
    ctx.stroke();

    // Pulmonary Artery (from RV to top-right, then to lungs)
    ctx.strokeStyle = '#5577cc';
    ctx.lineWidth = vesselW - 2;
    ctx.beginPath();
    ctx.moveTo(raX + halfW * 0.7, raY);
    ctx.quadraticCurveTo(raX + halfW * 0.7, raY - 40, w * 0.7, raY - 50);
    ctx.stroke();

    // Lungs indicators (top area)
    const lungRX = w * 0.78;
    const lungLX = w * 0.22;
    const lungY = raY - 55;

    // Right lung
    ctx.fillStyle = 'rgba(200, 150, 170, 0.15)';
    ctx.beginPath();
    ctx.ellipse(lungRX, lungY, 35, 25, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(200, 150, 170, 0.4)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Left lung
    ctx.fillStyle = 'rgba(200, 150, 170, 0.15)';
    ctx.beginPath();
    ctx.ellipse(lungLX, lungY, 35, 25, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(200, 150, 170, 0.4)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Connecting PA to lungs
    ctx.strokeStyle = '#5577cc';
    ctx.lineWidth = vesselW - 4;
    ctx.beginPath();
    ctx.moveTo(w * 0.7, raY - 50);
    ctx.quadraticCurveTo(w * 0.75, lungY, lungRX, lungY);
    ctx.stroke();

    // Pulmonary Vein (from lungs to LA)
    ctx.strokeStyle = '#cc4455';
    ctx.lineWidth = vesselW - 2;
    ctx.beginPath();
    ctx.moveTo(lungLX, lungY);
    ctx.quadraticCurveTo(w * 0.25, lungY, laX + halfW * 0.3, laY);
    ctx.stroke();

    // Lung connection artery to vein (across top)
    ctx.strokeStyle = 'rgba(150, 100, 160, 0.4)';
    ctx.lineWidth = vesselW - 6;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(lungRX, lungY);
    ctx.quadraticCurveTo(cx, lungY - 20, lungLX, lungY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Aorta (from LV, arching up and right, then down to body)
    ctx.strokeStyle = '#cc3344';
    ctx.lineWidth = vesselW;
    ctx.beginPath();
    ctx.moveTo(laX + halfW * 0.3, laY);
    ctx.quadraticCurveTo(laX - 10, laY - 40, cx * 0.5, laY - 30);
    ctx.stroke();

    // Aorta continuing down to body
    ctx.strokeStyle = '#cc3344';
    ctx.lineWidth = vesselW;
    ctx.beginPath();
    ctx.moveTo(cx * 0.5, laY - 30);
    ctx.quadraticCurveTo(10, cy, 10, cy + heartH * 0.5 + 20);
    ctx.stroke();

    // Body indicator at bottom
    ctx.fillStyle = 'rgba(160, 130, 100, 0.15)';
    ctx.beginPath();
    ctx.roundRect(8, cy + heartH * 0.5 + 15, w - 16, 30, 10);
    ctx.fill();
    ctx.strokeStyle = 'rgba(160, 130, 100, 0.3)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.font = '11px "Segoe UI", sans-serif';
    ctx.fillStyle = 'rgba(200, 180, 150, 0.7)';
    ctx.textAlign = 'center';
    ctx.fillText('Body (Systemic Circulation)', cx, cy + heartH * 0.5 + 34);

    // Connection: body back to vena cava (dashed, deoxy)
    ctx.strokeStyle = 'rgba(70, 100, 180, 0.3)';
    ctx.lineWidth = vesselW - 6;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(10, cy + heartH * 0.5 + 20);
    ctx.quadraticCurveTo(10, h - 20, w - 10, h - 20);
    ctx.lineTo(w - 10, cy + heartH * 0.5 + 20);
    ctx.stroke();
    ctx.setLineDash([]);

    /* ─── Blood particles ─── */
    const particles = particlesRef.current;
    const speed = BPM / 72; // normalize to default BPM

    // Define path segment control points for Bezier interpolation
    // Each segment: [startX, startY, cp1X, cp1Y, cp2X, cp2Y, endX, endY] or simpler [sx, sy, ex, ey]
    const paths: [number, number, number, number][] = [
      // 0: Vena cava to RA
      [w - 10, raY + 15, raX + halfW * 0.5, raY + upperH * 0.5],
      // 1: RA to RV (through tricuspid)
      [raX + halfW * 0.5, raY + upperH * 0.5, raX + halfW * 0.5, rvY + lowerH * 0.5],
      // 2: RV to Pulmonary Artery
      [raX + halfW * 0.5, rvY + lowerH * 0.3, raX + halfW * 0.7, raY - 50],
      // 3: PA to Right Lung
      [raX + halfW * 0.7, raY - 50, lungRX, lungY],
      // 4: Right Lung to Left Lung (oxygenation)
      [lungRX, lungY, lungLX, lungY],
      // 5: Pulmonary Vein to LA
      [lungLX, lungY, laX + halfW * 0.5, laY + upperH * 0.5],
      // 6: LA to LV (through mitral)
      [laX + halfW * 0.5, laY + upperH * 0.5, laX + halfW * 0.5, lvY + lowerH * 0.5],
      // 7: LV to Aorta to Body back to Vena cava
      [laX + halfW * 0.5, lvY + lowerH * 0.3, w - 10, cy + heartH * 0.5 + 20],
    ];

    for (const p of particles) {
      p.t += speed * 0.004;
      if (p.t >= 1) {
        p.t -= 1;
        p.pathIndex = (p.pathIndex + 1) % 8;
        // Update oxygenation
        if (p.pathIndex === 4) p.oxygenated = true;   // at lungs
        if (p.pathIndex === 0) p.oxygenated = false;  // returning from body
      }

      const seg = paths[p.pathIndex];
      if (!seg) continue;

      const t = p.t;
      const px = seg[0] + (seg[2] - seg[0]) * t;
      const py = seg[1] + (seg[3] - seg[1]) * t;

      // Draw particle
      const color = p.oxygenated ? 'rgba(220, 50, 50, 0.9)' : 'rgba(60, 80, 180, 0.9)';
      const glowColor = p.oxygenated ? 'rgba(220, 50, 50, 0.3)' : 'rgba(60, 80, 180, 0.3)';

      // Glow
      const glow = ctx.createRadialGradient(px, py, 0, px, py, 8);
      glow.addColorStop(0, glowColor);
      glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(px - 8, py - 8, 16, 16);

      // Core
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(px, py, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    /* ─── Labels ─── */
    if (showLabelsRef.current) {
      ctx.font = 'bold 11px "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // Chamber labels
      ctx.fillStyle = '#8899dd';
      ctx.fillText('Right', raX + halfW / 2, raY + upperH * 0.35);
      ctx.fillText('Atrium', raX + halfW / 2, raY + upperH * 0.35 + 14);

      ctx.fillStyle = '#8899dd';
      ctx.fillText('Right', rvX + halfW / 2, rvY + lowerH * 0.4);
      ctx.fillText('Ventricle', rvX + halfW / 2, rvY + lowerH * 0.4 + 14);

      ctx.fillStyle = '#dd8899';
      ctx.fillText('Left', laX + halfW / 2, laY + upperH * 0.35);
      ctx.fillText('Atrium', laX + halfW / 2, laY + upperH * 0.35 + 14);

      ctx.fillStyle = '#dd8899';
      ctx.fillText('Left', lvX + halfW / 2, lvY + lowerH * 0.4);
      ctx.fillText('Ventricle', lvX + halfW / 2, lvY + lowerH * 0.4 + 14);

      // Vessel labels
      ctx.font = '10px "Segoe UI", sans-serif';

      ctx.fillStyle = '#7799cc';
      ctx.fillText('Vena Cava', w - 45, raY + 5);

      ctx.fillStyle = '#7799cc';
      ctx.fillText('Pulmonary', raX + halfW * 0.7 + 30, raY - 30);
      ctx.fillText('Artery', raX + halfW * 0.7 + 30, raY - 18);

      ctx.fillStyle = '#cc7788';
      ctx.fillText('Pulmonary', laX + halfW * 0.3 - 30, laY - 18);
      ctx.fillText('Vein', laX + halfW * 0.3 - 30, laY - 6);

      ctx.fillStyle = '#cc5566';
      ctx.fillText('Aorta', cx * 0.4, laY - 42);

      // Septum label
      ctx.fillStyle = 'rgba(200, 100, 110, 0.7)';
      ctx.font = 'italic 10px "Segoe UI", sans-serif';
      ctx.save();
      ctx.translate(septumX + 3, cy);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText('Septum', 0, 0);
      ctx.restore();

      // Lung labels
      ctx.font = '10px "Segoe UI", sans-serif';
      ctx.fillStyle = 'rgba(220, 180, 190, 0.8)';
      ctx.fillText('Right Lung', lungRX, lungY + 3);
      ctx.fillText('Left Lung', lungLX, lungY + 3);
    }

    ctx.restore(); // undo pulse scale

    /* ─── Heartbeat indicator ─── */
    const beatX = w - 50;
    const beatY2 = h - 60;
    const beatR = 12 + (ventricularSystole ? 5 * Math.sin((beatPhase - 0.35) / 0.3 * Math.PI) : 0);

    ctx.fillStyle = `rgba(220, 50, 50, ${0.3 + (ventricularSystole ? 0.5 : 0)})`;
    ctx.beginPath();
    ctx.arc(beatX, beatY2, beatR + 6, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#dd3344';
    ctx.beginPath();
    ctx.arc(beatX, beatY2, beatR, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = 'bold 10px "Courier New", monospace';
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${BPM}`, beatX, beatY2);
    ctx.font = '8px sans-serif';
    ctx.fillText('BPM', beatX, beatY2 + 12);

    /* ─── Title ─── */
    ctx.font = 'bold 14px "Segoe UI", sans-serif';
    ctx.fillStyle = 'rgba(220, 180, 200, 0.9)';
    ctx.textAlign = 'center';
    ctx.fillText('Human Heart & Double Circulation', cx, 16);

    /* ─── Legend ─── */
    ctx.font = '10px "Segoe UI", sans-serif';
    ctx.textAlign = 'left';

    // Oxygenated
    ctx.fillStyle = '#cc3344';
    ctx.beginPath();
    ctx.arc(14, h - 26, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ddaabb';
    ctx.fillText('Oxygenated', 24, h - 23);

    // Deoxygenated
    ctx.fillStyle = '#4466bb';
    ctx.beginPath();
    ctx.arc(14, h - 12, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#aabbdd';
    ctx.fillText('Deoxygenated', 24, h - 9);

    /* ─── Phase indicator ─── */
    const phaseName = atrialSystole ? 'Atrial Systole' : ventricularSystole ? 'Ventricular Systole' : 'Diastole';
    const phaseColor = atrialSystole ? '#cc8866' : ventricularSystole ? '#cc5566' : '#66aa88';

    ctx.font = 'bold 11px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = phaseColor;
    ctx.fillText(phaseName, cx, h - 12);

  }, []);

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
      canvas.height = 460 * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = '460px';
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

  const handleReset = () => {
    setBpm(DEFAULT_BPM);
    setShowLabels(true);
    setShowValves(true);
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
        aria-label="Human heart simulation showing four chambers, blood flow, and double circulation with animated heartbeat"
        style={{
          width: '100%',
          height: 460,
          borderRadius: 16,
          display: 'block',
        }}
      />

      <div style={{ padding: '16px 4px 8px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* BPM Slider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <label style={{ minWidth: 130, color: '#cc5566', fontWeight: 700, fontSize: 14 }}>
            Heart Rate: {bpm} BPM
          </label>
          <input
            type="range" min={MIN_BPM} max={MAX_BPM} step={1} value={bpm}
            onChange={(e) => setBpm(parseInt(e.target.value))}
            aria-label={`Heart rate slider, ${bpm} beats per minute, range ${MIN_BPM} to ${MAX_BPM}`}
            style={{ flex: 1, accentColor: '#cc3344', height: 6, cursor: 'pointer' }}
          />
        </div>

        {/* Toggle buttons */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            onClick={() => setShowLabels(!showLabels)}
            aria-label={`Toggle labels, currently ${showLabels ? 'on' : 'off'}`}
            style={{
              padding: '8px 18px',
              borderRadius: 20,
              border: `2px solid ${showLabels ? '#aa88cc' : '#555'}`,
              background: showLabels ? 'rgba(170, 136, 204, 0.15)' : 'rgba(80, 80, 80, 0.1)',
              color: showLabels ? '#ccaaee' : '#888',
              fontWeight: 700,
              fontSize: 13,
              cursor: 'pointer',
              transition: 'all 0.2s',
              minHeight: 44,
              minWidth: 44,
            }}
          >
            Labels: {showLabels ? 'ON' : 'OFF'}
          </button>

          <button
            onClick={() => setShowValves(!showValves)}
            aria-label={`Toggle valve visualization, currently ${showValves ? 'on' : 'off'}`}
            style={{
              padding: '8px 18px',
              borderRadius: 20,
              border: `2px solid ${showValves ? '#88aacc' : '#555'}`,
              background: showValves ? 'rgba(136, 170, 204, 0.15)' : 'rgba(80, 80, 80, 0.1)',
              color: showValves ? '#aaccee' : '#888',
              fontWeight: 700,
              fontSize: 13,
              cursor: 'pointer',
              transition: 'all 0.2s',
              minHeight: 44,
              minWidth: 44,
            }}
          >
            Valves: {showValves ? 'ON' : 'OFF'}
          </button>

          <button
            onClick={handleReset}
            aria-label="Reset simulation to default values"
            style={{
              marginLeft: 'auto',
              padding: '8px 20px',
              borderRadius: 20,
              border: '2px solid rgba(160, 100, 120, 0.4)',
              background: 'linear-gradient(135deg, #2a1520 0%, #3a1a2a 100%)',
              color: '#ddaabb',
              fontWeight: 700,
              fontSize: 13,
              cursor: 'pointer',
              transition: 'all 0.2s',
              minHeight: 44,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'linear-gradient(135deg, #3a1a2a 0%, #5a2a3a 100%)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'linear-gradient(135deg, #2a1520 0%, #3a1a2a 100%)';
            }}
          >
            Reset
          </button>
        </div>

        {/* Discovery tip */}
        <p
          style={{
            margin: 0,
            padding: '8px 12px',
            background: 'rgba(180, 50, 70, 0.08)',
            border: '1px solid rgba(180, 50, 70, 0.2)',
            borderRadius: 10,
            color: '#cc7788',
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          <strong>Discover:</strong> Watch how blood passes through the heart twice in one
          complete cycle — once to the lungs (pulmonary) and once to the body (systemic).
          That is why it is called double circulation! Toggle valves ON to see them open and
          close with each heartbeat.
        </p>
      </div>
    </div>
  );
}
