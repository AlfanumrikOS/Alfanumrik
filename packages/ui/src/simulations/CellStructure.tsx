'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';

/**
 * Cell Structure Simulation
 * CBSE Class 8 Ch8 — The Cell
 * CBSE Class 6 — Body Movements
 *
 * Interactive animal cell AND plant cell (toggle between them).
 * Labeled organelles with click-to-highlight and function tooltip.
 * Canvas-based for visual richness.
 */

type CellType = 'animal' | 'plant';

interface Organelle {
  id: string;
  name: string;
  description: string;
  color: string;
  borderColor: string;
  inPlantCell: boolean;
  inAnimalCell: boolean;
}

const ORGANELLES: Organelle[] = [
  {
    id: 'cell-membrane',
    name: 'Cell Membrane',
    description:
      'A thin, flexible boundary that controls what enters and leaves the cell. Like a security guard at the gate.',
    color: '#f59e0b',
    borderColor: '#d97706',
    inPlantCell: true,
    inAnimalCell: true,
  },
  {
    id: 'cell-wall',
    name: 'Cell Wall',
    description:
      'A rigid outer layer found only in plant cells. Made of cellulose, it provides shape and protection.',
    color: '#65a30d',
    borderColor: '#4d7c0f',
    inPlantCell: true,
    inAnimalCell: false,
  },
  {
    id: 'nucleus',
    name: 'Nucleus',
    description:
      'The control centre of the cell. Contains DNA (genetic material) that directs all cell activities.',
    color: '#8b5cf6',
    borderColor: '#7c3aed',
    inPlantCell: true,
    inAnimalCell: true,
  },
  {
    id: 'cytoplasm',
    name: 'Cytoplasm',
    description:
      'A jelly-like fluid that fills the cell. All organelles float in the cytoplasm. Chemical reactions happen here.',
    color: '#e0f2fe',
    borderColor: '#93c5fd',
    inPlantCell: true,
    inAnimalCell: true,
  },
  {
    id: 'mitochondria',
    name: 'Mitochondria',
    description:
      'The powerhouse of the cell! Breaks down food to release energy (ATP) through cellular respiration.',
    color: '#ef4444',
    borderColor: '#dc2626',
    inPlantCell: true,
    inAnimalCell: true,
  },
  {
    id: 'endoplasmic-reticulum',
    name: 'Endoplasmic Reticulum (ER)',
    description:
      'A network of membranes that transports materials inside the cell. Rough ER has ribosomes; Smooth ER does not.',
    color: '#f97316',
    borderColor: '#ea580c',
    inPlantCell: true,
    inAnimalCell: true,
  },
  {
    id: 'golgi-apparatus',
    name: 'Golgi Apparatus',
    description:
      'Packages and ships proteins and lipids out of the cell. Like the post office of the cell.',
    color: '#06b6d4',
    borderColor: '#0891b2',
    inPlantCell: true,
    inAnimalCell: true,
  },
  {
    id: 'chloroplast',
    name: 'Chloroplast',
    description:
      'Found only in plant cells. Contains chlorophyll for photosynthesis — converts sunlight into food (glucose).',
    color: '#22c55e',
    borderColor: '#16a34a',
    inPlantCell: true,
    inAnimalCell: false,
  },
  {
    id: 'vacuole',
    name: 'Vacuole',
    description:
      'Stores water, nutrients, and waste. Plant cells have one large central vacuole; animal cells have small ones.',
    color: '#a5b4fc',
    borderColor: '#818cf8',
    inPlantCell: true,
    inAnimalCell: true,
  },
];

// Position data for organelles (relative to cell center, as fraction of cell radius)
function getOrganelleLayout(
  cellType: CellType,
  cx: number,
  cy: number,
  cellR: number
): {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  shape: 'ellipse' | 'rect' | 'ring' | 'irregular';
}[] {
  const r = cellR;
  const layouts: {
    id: string;
    x: number;
    y: number;
    w: number;
    h: number;
    shape: 'ellipse' | 'rect' | 'ring' | 'irregular';
  }[] = [];

  if (cellType === 'plant') {
    // Cell wall (outer ring)
    layouts.push({ id: 'cell-wall', x: cx, y: cy, w: r + 8, h: r + 8, shape: 'ring' });
  }

  // Cell membrane
  layouts.push({ id: 'cell-membrane', x: cx, y: cy, w: r, h: r, shape: 'ring' });

  // Cytoplasm is the fill, not explicitly drawn as a separate shape

  // Nucleus (center-left)
  layouts.push({ id: 'nucleus', x: cx - r * 0.1, y: cy, w: r * 0.28, h: r * 0.26, shape: 'ellipse' });

  // Mitochondria (two bean shapes)
  layouts.push({ id: 'mitochondria', x: cx + r * 0.35, y: cy - r * 0.25, w: r * 0.16, h: r * 0.09, shape: 'ellipse' });

  // ER (near nucleus)
  layouts.push({ id: 'endoplasmic-reticulum', x: cx + r * 0.1, y: cy + r * 0.15, w: r * 0.22, h: r * 0.12, shape: 'irregular' });

  // Golgi (right side)
  layouts.push({ id: 'golgi-apparatus', x: cx + r * 0.4, y: cy + r * 0.2, w: r * 0.15, h: r * 0.12, shape: 'irregular' });

  // Plant-only
  if (cellType === 'plant') {
    layouts.push({ id: 'chloroplast', x: cx - r * 0.35, y: cy - r * 0.3, w: r * 0.16, h: r * 0.1, shape: 'ellipse' });
    // Large central vacuole
    layouts.push({ id: 'vacuole', x: cx - r * 0.15, y: cy + r * 0.35, w: r * 0.35, h: r * 0.25, shape: 'ellipse' });
  } else {
    // Small vacuoles for animal cell
    layouts.push({ id: 'vacuole', x: cx - r * 0.3, y: cy - r * 0.2, w: r * 0.1, h: r * 0.08, shape: 'ellipse' });
  }

  // Cytoplasm entry (for click detection — the entire cell area)
  layouts.push({ id: 'cytoplasm', x: cx, y: cy, w: r * 0.95, h: r * 0.95, shape: 'ellipse' });

  return layouts;
}

export default function CellStructure() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number>(0);

  const [cellType, setCellType] = useState<CellType>('animal');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const cellRRef = useRef(140);

  const selectedOrganelle = selectedId
    ? ORGANELLES.find((o) => o.id === selectedId) || null
    : null;

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;

    const resizeCanvas = () => {
      const rect = container.getBoundingClientRect();
      const h = Math.min(rect.width * 0.85, 520);
      canvas.width = rect.width * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cellRRef.current = Math.min(rect.width, h) * 0.32;
    };

    resizeCanvas();
    const resizeObserver = new ResizeObserver(resizeCanvas);
    resizeObserver.observe(container);

    // Click handler
    const onClick = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      const cx = w / 2;
      const cy = h / 2;
      const cellR = cellRRef.current;

      const layout = getOrganelleLayout(cellType, cx, cy, cellR);

      // Check organelles in reverse order (front to back), skip cytoplasm first
      let found = false;
      for (let i = layout.length - 2; i >= 0; i--) {
        const o = layout[i];
        if (o.shape === 'ring') {
          // Ring: check if click is near the ring border
          const dist = Math.sqrt((x - o.x) ** 2 + (y - o.y) ** 2);
          if (Math.abs(dist - o.w) < 12) {
            setSelectedId(o.id);
            found = true;
            break;
          }
        } else {
          // Ellipse / rect: check bounding box
          const dx = (x - o.x) / o.w;
          const dy = (y - o.y) / o.h;
          if (dx * dx + dy * dy <= 1) {
            setSelectedId(o.id);
            found = true;
            break;
          }
        }
      }

      // If clicking inside cell but no specific organelle, show cytoplasm
      if (!found) {
        const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
        if (dist < cellR) {
          setSelectedId('cytoplasm');
        } else {
          setSelectedId(null);
        }
      }
    };

    canvas.addEventListener('pointerdown', onClick);

    const draw = (timestamp: number) => {
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      const cx = w / 2;
      const cy = h / 2;
      const cellR = cellRRef.current;

      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, w, h);

      const layout = getOrganelleLayout(cellType, cx, cy, cellR);
      const pulse = Math.sin(timestamp * 0.003) * 0.5 + 0.5;

      // Draw cell body (cytoplasm fill)
      if (cellType === 'plant') {
        // Plant cell is more rectangular with rounded corners
        const rectW = cellR * 2 + 16;
        const rectH = cellR * 1.6 + 16;
        const cornerR = 20;

        // Cell wall
        ctx.beginPath();
        ctx.roundRect(cx - rectW / 2, cy - rectH / 2, rectW, rectH, cornerR);
        ctx.fillStyle = selectedId === 'cell-wall' ? '#84cc16' : '#4d7c0f';
        ctx.fill();
        ctx.strokeStyle = '#65a30d';
        ctx.lineWidth = selectedId === 'cell-wall' ? 4 : 3;
        ctx.stroke();

        // Cell membrane (just inside wall)
        ctx.beginPath();
        ctx.roundRect(
          cx - rectW / 2 + 8,
          cy - rectH / 2 + 8,
          rectW - 16,
          rectH - 16,
          cornerR - 4
        );
        ctx.fillStyle = selectedId === 'cytoplasm' ? '#dbeafe' : '#e0f2fe';
        ctx.fill();
        ctx.strokeStyle = selectedId === 'cell-membrane' ? '#f59e0b' : '#f59e0baa';
        ctx.lineWidth = selectedId === 'cell-membrane' ? 3 : 2;
        ctx.stroke();
      } else {
        // Animal cell is irregular/circular
        ctx.beginPath();
        ctx.ellipse(cx, cy, cellR, cellR * 0.85, 0, 0, Math.PI * 2);
        ctx.fillStyle = selectedId === 'cytoplasm' ? '#dbeafe' : '#e0f2fe';
        ctx.fill();
        ctx.strokeStyle = selectedId === 'cell-membrane' ? '#f59e0b' : '#f59e0baa';
        ctx.lineWidth = selectedId === 'cell-membrane' ? 4 : 2.5;
        ctx.stroke();
      }

      // Draw organelles
      for (const item of layout) {
        const org = ORGANELLES.find((o) => o.id === item.id);
        if (!org) continue;
        if (item.shape === 'ring') continue; // already drawn as cell boundary
        if (item.id === 'cytoplasm') continue;

        const isSelected = selectedId === item.id;
        const alpha = isSelected ? 1 : 0.85;

        ctx.save();

        if (item.id === 'nucleus') {
          // Nucleus with nuclear membrane
          ctx.beginPath();
          ctx.ellipse(item.x, item.y, item.w, item.h, 0, 0, Math.PI * 2);
          const nucleusGrad = ctx.createRadialGradient(
            item.x - item.w * 0.2,
            item.y - item.h * 0.2,
            item.w * 0.1,
            item.x,
            item.y,
            item.w
          );
          nucleusGrad.addColorStop(0, isSelected ? '#c4b5fd' : '#a78bfa');
          nucleusGrad.addColorStop(1, isSelected ? '#8b5cf6' : '#7c3aed');
          ctx.fillStyle = nucleusGrad;
          ctx.fill();
          ctx.strokeStyle = org.borderColor;
          ctx.lineWidth = isSelected ? 3 : 2;
          ctx.stroke();

          // Nucleolus
          ctx.beginPath();
          ctx.arc(item.x, item.y, item.w * 0.35, 0, Math.PI * 2);
          ctx.fillStyle = '#6d28d9';
          ctx.fill();
        } else if (item.id === 'mitochondria') {
          // Bean shape
          ctx.beginPath();
          ctx.ellipse(item.x, item.y, item.w, item.h, 0.3, 0, Math.PI * 2);
          ctx.fillStyle = isSelected ? '#fca5a5' : org.color;
          ctx.fill();
          ctx.strokeStyle = org.borderColor;
          ctx.lineWidth = isSelected ? 2.5 : 1.5;
          ctx.stroke();

          // Inner folds (cristae)
          ctx.strokeStyle = `${org.borderColor}88`;
          ctx.lineWidth = 1;
          for (let i = -1; i <= 1; i++) {
            ctx.beginPath();
            ctx.moveTo(item.x + i * item.w * 0.3, item.y - item.h * 0.6);
            ctx.lineTo(item.x + i * item.w * 0.3, item.y + item.h * 0.6);
            ctx.stroke();
          }

          // Second mitochondria
          ctx.beginPath();
          ctx.ellipse(item.x - cellR * 0.45, item.y + cellR * 0.35, item.w * 0.8, item.h * 0.7, -0.5, 0, Math.PI * 2);
          ctx.fillStyle = isSelected ? '#fca5a5' : org.color;
          ctx.fill();
          ctx.strokeStyle = org.borderColor;
          ctx.lineWidth = isSelected ? 2.5 : 1.5;
          ctx.stroke();
        } else if (item.id === 'endoplasmic-reticulum') {
          // Wavy membrane network
          ctx.strokeStyle = isSelected ? '#fb923c' : org.color;
          ctx.lineWidth = isSelected ? 3 : 2;
          for (let i = 0; i < 4; i++) {
            ctx.beginPath();
            const startY = item.y - item.h + i * (item.h * 0.6);
            ctx.moveTo(item.x - item.w, startY);
            ctx.bezierCurveTo(
              item.x - item.w * 0.3,
              startY - 6,
              item.x + item.w * 0.3,
              startY + 6,
              item.x + item.w,
              startY
            );
            ctx.stroke();
          }
          // Small dots for ribosomes (rough ER)
          ctx.fillStyle = '#92400e';
          for (let i = 0; i < 6; i++) {
            const rx = item.x - item.w + Math.random() * item.w * 2;
            const ry = item.y - item.h * 0.5 + Math.random() * item.h;
            ctx.beginPath();
            ctx.arc(rx, ry, 2, 0, Math.PI * 2);
            ctx.fill();
          }
        } else if (item.id === 'golgi-apparatus') {
          // Stacked curved membranes
          ctx.strokeStyle = isSelected ? '#22d3ee' : org.color;
          ctx.lineWidth = isSelected ? 3 : 2.5;
          for (let i = 0; i < 4; i++) {
            ctx.beginPath();
            const offsetY = item.y - item.h + i * (item.h * 0.65);
            ctx.arc(item.x, offsetY + 10, item.w, 0.3, Math.PI - 0.3);
            ctx.stroke();
          }
          // Vesicles
          ctx.fillStyle = `${org.color}88`;
          ctx.beginPath();
          ctx.arc(item.x + item.w + 6, item.y - 4, 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.arc(item.x + item.w + 2, item.y + 8, 3, 0, Math.PI * 2);
          ctx.fill();
        } else if (item.id === 'chloroplast') {
          // Green oval with internal thylakoid stacks
          ctx.beginPath();
          ctx.ellipse(item.x, item.y, item.w, item.h, 0.2, 0, Math.PI * 2);
          ctx.fillStyle = isSelected ? '#86efac' : org.color;
          ctx.fill();
          ctx.strokeStyle = org.borderColor;
          ctx.lineWidth = isSelected ? 2.5 : 1.5;
          ctx.stroke();

          // Grana (thylakoid stacks)
          ctx.fillStyle = '#15803d';
          for (let i = -1; i <= 1; i++) {
            ctx.fillRect(item.x + i * item.w * 0.35 - 4, item.y - 4, 8, 8);
          }

          // Second chloroplast
          ctx.beginPath();
          ctx.ellipse(item.x + cellR * 0.3, item.y + cellR * 0.45, item.w * 0.7, item.h * 0.8, -0.3, 0, Math.PI * 2);
          ctx.fillStyle = isSelected ? '#86efac' : org.color;
          ctx.fill();
          ctx.strokeStyle = org.borderColor;
          ctx.lineWidth = isSelected ? 2.5 : 1.5;
          ctx.stroke();
        } else if (item.id === 'vacuole') {
          ctx.beginPath();
          ctx.ellipse(item.x, item.y, item.w, item.h, 0, 0, Math.PI * 2);
          ctx.fillStyle = isSelected ? '#c7d2fe' : `${org.color}aa`;
          ctx.fill();
          ctx.strokeStyle = org.borderColor;
          ctx.lineWidth = isSelected ? 2.5 : 1.5;
          ctx.setLineDash([4, 3]);
          ctx.stroke();
          ctx.setLineDash([]);

          if (cellType === 'plant') {
            ctx.fillStyle = 'rgba(129, 140, 248, 0.3)';
            ctx.font = '10px system-ui';
            ctx.textAlign = 'center';
            ctx.fillText('H₂O', item.x, item.y + 3);
          }
        }

        ctx.restore();

        // Selection highlight ring
        if (isSelected) {
          ctx.save();
          ctx.strokeStyle = `rgba(251, 191, 36, ${0.4 + pulse * 0.4})`;
          ctx.lineWidth = 2;
          ctx.setLineDash([5, 3]);
          if (item.shape === 'ellipse') {
            ctx.beginPath();
            ctx.ellipse(item.x, item.y, item.w + 6, item.h + 6, 0, 0, Math.PI * 2);
            ctx.stroke();
          }
          ctx.setLineDash([]);
          ctx.restore();
        }
      }

      // -- Draw labels with lines --
      const labelFontSize = Math.max(9, Math.min(12, cellR * 0.08));
      ctx.font = `bold ${labelFontSize}px system-ui`;
      ctx.textBaseline = 'middle';

      const labelPositions: { id: string; labelX: number; labelY: number; anchorX: number; anchorY: number; align: CanvasTextAlign }[] = [];

      // Position labels outside the cell
      const visibleOrganelles = ORGANELLES.filter(
        (o) => (cellType === 'animal' ? o.inAnimalCell : o.inPlantCell)
      );

      const leftLabels = visibleOrganelles.filter((_, i) => i % 2 === 0);
      const rightLabels = visibleOrganelles.filter((_, i) => i % 2 === 1);

      const labelStartY = cy - cellR * 0.8;
      const labelSpacing = Math.min(30, (cellR * 1.6) / Math.max(leftLabels.length, rightLabels.length));

      leftLabels.forEach((org, i) => {
        const layoutItem = layout.find((l) => l.id === org.id);
        if (!layoutItem) return;
        const lx = Math.max(8, cx - cellR - 70);
        const ly = labelStartY + i * labelSpacing;
        labelPositions.push({
          id: org.id,
          labelX: lx,
          labelY: ly,
          anchorX: layoutItem.x,
          anchorY: layoutItem.y,
          align: 'right',
        });
      });

      rightLabels.forEach((org, i) => {
        const layoutItem = layout.find((l) => l.id === org.id);
        if (!layoutItem) return;
        const lx = Math.min(w - 8, cx + cellR + 70);
        const ly = labelStartY + i * labelSpacing;
        labelPositions.push({
          id: org.id,
          labelX: lx,
          labelY: ly,
          anchorX: layoutItem.x,
          anchorY: layoutItem.y,
          align: 'left',
        });
      });

      for (const lp of labelPositions) {
        const org = ORGANELLES.find((o) => o.id === lp.id);
        if (!org) continue;
        const isSelected = selectedId === lp.id;

        // Leader line
        ctx.beginPath();
        ctx.moveTo(lp.labelX + (lp.align === 'right' ? 4 : -4), lp.labelY);
        ctx.lineTo(lp.anchorX, lp.anchorY);
        ctx.strokeStyle = isSelected ? '#fbbf24' : 'rgba(148, 163, 184, 0.3)';
        ctx.lineWidth = isSelected ? 1.5 : 0.8;
        ctx.stroke();

        // Label text
        ctx.textAlign = lp.align;
        ctx.fillStyle = isSelected ? '#fbbf24' : '#cbd5e1';
        ctx.font = `${isSelected ? 'bold' : 'normal'} ${labelFontSize}px system-ui`;
        ctx.fillText(org.name, lp.labelX, lp.labelY);

        // Color dot
        ctx.beginPath();
        ctx.arc(
          lp.labelX + (lp.align === 'right' ? -6 : 6) + (lp.align === 'right' ? -ctx.measureText(org.name).width : ctx.measureText(org.name).width),
          lp.labelY,
          3,
          0,
          Math.PI * 2
        );
        ctx.fillStyle = org.color;
        ctx.fill();
      }

      // Title on canvas
      ctx.fillStyle = '#e2e8f0';
      ctx.font = 'bold 15px system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(
        cellType === 'animal' ? 'Animal Cell' : 'Plant Cell',
        cx,
        10
      );

      // Instruction
      ctx.fillStyle = 'rgba(148,163,184,0.5)';
      ctx.font = '11px system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText('Click on any organelle to learn about it', cx, h - 8);

      animRef.current = requestAnimationFrame(draw);
    };

    animRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(animRef.current);
      canvas.removeEventListener('pointerdown', onClick);
      resizeObserver.disconnect();
    };
  }, [cellType, selectedId]);

  return (
    <div
      ref={containerRef}
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
        padding: '16px',
        fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
        color: '#e2e8f0',
      }}
    >
      {/* Title */}
      <div style={{ textAlign: 'center', marginBottom: '12px' }}>
        <h1
          style={{
            fontSize: 'clamp(1.3rem, 3.5vw, 2rem)',
            fontWeight: 800,
            margin: 0,
            background: 'linear-gradient(90deg, #8b5cf6, #22c55e)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}
        >
          Cell Structure Explorer
        </h1>
        <p
          style={{
            margin: '4px 0 0',
            fontSize: 'clamp(0.8rem, 2vw, 0.95rem)',
            color: '#94a3b8',
          }}
        >
          Click on organelles to learn their functions
        </p>
      </div>

      {/* Canvas */}
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          borderRadius: '16px',
          border: '1px solid rgba(255,255,255,0.1)',
          background: '#0f172a',
          display: 'block',
          touchAction: 'none',
          cursor: 'pointer',
        }}
      />

      {/* Controls & Info */}
      <div
        style={{
          maxWidth: '600px',
          margin: '16px auto 0',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
        {/* Cell type toggle */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            gap: '8px',
          }}
        >
          {(
            [
              { key: 'animal', label: 'Animal Cell' },
              { key: 'plant', label: 'Plant Cell' },
            ] as { key: CellType; label: string }[]
          ).map((m) => (
            <button
              key={m.key}
              onClick={() => {
                setCellType(m.key);
                setSelectedId(null);
              }}
              type="button"
              style={{
                padding: '10px 24px',
                borderRadius: '10px',
                border: `2px solid ${
                  cellType === m.key ? '#8b5cf6' : 'rgba(255,255,255,0.15)'
                }`,
                background:
                  cellType === m.key
                    ? 'rgba(139,92,246,0.15)'
                    : 'rgba(255,255,255,0.05)',
                color: cellType === m.key ? '#c4b5fd' : '#94a3b8',
                fontWeight: 600,
                fontSize: '0.9rem',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                minHeight: '44px',
              }}
            >
              {m.label}
            </button>
          ))}
        </div>

        {/* Organelle info tooltip */}
        {selectedOrganelle && (
          <div
            style={{
              background: 'rgba(255,255,255,0.08)',
              borderRadius: '14px',
              padding: '14px 16px',
              border: `2px solid ${selectedOrganelle.color}44`,
              animation: 'fadeIn 0.2s ease',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                marginBottom: '8px',
              }}
            >
              <div
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: '50%',
                  background: selectedOrganelle.color,
                  flexShrink: 0,
                }}
              />
              <strong
                style={{
                  fontSize: 'clamp(0.95rem, 2.2vw, 1.1rem)',
                  color: selectedOrganelle.color,
                }}
              >
                {selectedOrganelle.name}
              </strong>
              {!selectedOrganelle.inAnimalCell && (
                <span
                  style={{
                    background: '#22c55e22',
                    color: '#22c55e',
                    fontSize: '0.7rem',
                    padding: '2px 8px',
                    borderRadius: '6px',
                    fontWeight: 600,
                  }}
                >
                  Plant Only
                </span>
              )}
            </div>
            <p
              style={{
                margin: 0,
                fontSize: 'clamp(0.8rem, 1.8vw, 0.9rem)',
                lineHeight: 1.6,
                color: '#cbd5e1',
              }}
            >
              {selectedOrganelle.description}
            </p>
          </div>
        )}

        {/* Default hint */}
        {!selectedOrganelle && (
          <div
            style={{
              background: 'rgba(255,255,255,0.05)',
              borderRadius: '14px',
              padding: '14px 16px',
              border: '2px dashed rgba(255,255,255,0.15)',
              textAlign: 'center',
              color: '#64748b',
            }}
          >
            <div style={{ fontSize: '1.5rem', marginBottom: '4px' }}>
              {cellType === 'plant' ? '🌱' : '🔬'}
            </div>
            <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>
              Tap on any part of the cell
            </div>
            <div style={{ fontSize: '0.8rem', marginTop: '2px' }}>
              to learn what each organelle does!
            </div>
          </div>
        )}

        {/* Comparison note */}
        <div
          style={{
            background: 'rgba(255,255,255,0.04)',
            borderRadius: '12px',
            padding: '12px 14px',
            border: '1px solid rgba(255,255,255,0.06)',
            fontSize: 'clamp(0.75rem, 1.6vw, 0.82rem)',
            lineHeight: 1.5,
            color: '#94a3b8',
          }}
        >
          <strong style={{ color: '#c4b5fd' }}>Key Difference:</strong> Plant
          cells have a rigid <strong>cell wall</strong>,{' '}
          <strong>chloroplasts</strong> for photosynthesis, and a{' '}
          <strong>large central vacuole</strong>. Animal cells have only a
          flexible cell membrane and smaller vacuoles.
        </div>
      </div>

      {/* Footer */}
      <div
        style={{
          textAlign: 'center',
          marginTop: '16px',
          fontSize: '0.75rem',
          color: '#475569',
        }}
      >
        CBSE Class 6-8 Science — The Cell
      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
