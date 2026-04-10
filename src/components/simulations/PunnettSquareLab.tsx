'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';

/* ─── Trait definitions (CBSE pea plant examples) ─── */
interface Trait {
  name: string;
  dominant: string;
  dominantSymbol: string;
  recessive: string;
  recessiveSymbol: string;
  dominantColor: string;
  recessiveColor: string;
}

const TRAITS: Trait[] = [
  {
    name: 'Plant Height',
    dominant: 'Tall',
    dominantSymbol: 'T',
    recessive: 'Dwarf',
    recessiveSymbol: 't',
    dominantColor: '#44aa66',
    recessiveColor: '#cc8844',
  },
  {
    name: 'Seed Shape',
    dominant: 'Round',
    dominantSymbol: 'R',
    recessive: 'Wrinkled',
    recessiveSymbol: 'r',
    dominantColor: '#5588cc',
    recessiveColor: '#cc6644',
  },
  {
    name: 'Flower Color',
    dominant: 'Purple',
    dominantSymbol: 'P',
    recessive: 'White',
    recessiveSymbol: 'p',
    dominantColor: '#9966cc',
    recessiveColor: '#ccccaa',
  },
  {
    name: 'Seed Color',
    dominant: 'Yellow',
    dominantSymbol: 'Y',
    recessive: 'Green',
    recessiveSymbol: 'y',
    dominantColor: '#ccaa44',
    recessiveColor: '#66aa55',
  },
];

type GenotypeOption = 'homoDominant' | 'heterozygous' | 'homoRecessive';

const GENOTYPE_OPTIONS: { label: string; value: GenotypeOption }[] = [
  { label: 'Homozygous Dominant', value: 'homoDominant' },
  { label: 'Heterozygous', value: 'heterozygous' },
  { label: 'Homozygous Recessive', value: 'homoRecessive' },
];

function getGenotype(option: GenotypeOption, trait: Trait): string {
  switch (option) {
    case 'homoDominant':
      return `${trait.dominantSymbol}${trait.dominantSymbol}`;
    case 'heterozygous':
      return `${trait.dominantSymbol}${trait.recessiveSymbol}`;
    case 'homoRecessive':
      return `${trait.recessiveSymbol}${trait.recessiveSymbol}`;
  }
}

function getGametes(genotype: string): [string, string] {
  return [genotype[0], genotype[1]];
}

function getPhenotype(genotype: string, trait: Trait): string {
  return genotype.includes(trait.dominantSymbol) ? trait.dominant : trait.recessive;
}

function getPhenotypeColor(genotype: string, trait: Trait): string {
  return genotype.includes(trait.dominantSymbol) ? trait.dominantColor : trait.recessiveColor;
}

/* ─── Dihybrid helpers ─── */
function getDihybridGametes(g1: string, g2: string): string[] {
  // g1 = e.g. "Tt", g2 = e.g. "Rr"
  const a = getGametes(g1);
  const b = getGametes(g2);
  const result: string[] = [];
  for (const x of a) {
    for (const y of b) {
      result.push(x + y);
    }
  }
  // Remove duplicates while preserving order
  return [...new Set(result)];
}

export default function PunnettSquareLab() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number>(0);
  const animProgressRef = useRef(0);

  const [mode, setMode] = useState<'monohybrid' | 'dihybrid'>('monohybrid');
  const [traitIndex, setTraitIndex] = useState(0);
  const [trait2Index, setTrait2Index] = useState(1);
  const [parent1, setParent1] = useState<GenotypeOption>('heterozygous');
  const [parent2, setParent2] = useState<GenotypeOption>('heterozygous');
  const [parent1b, setParent1b] = useState<GenotypeOption>('heterozygous');
  const [parent2b, setParent2b] = useState<GenotypeOption>('heterozygous');
  const [showRatios, setShowRatios] = useState(true);

  const modeRef = useRef(mode);
  useEffect(() => { modeRef.current = mode; }, [mode]);

  const trait = TRAITS[traitIndex];
  const trait2 = TRAITS[trait2Index];

  // Monohybrid data
  const p1Genotype = getGenotype(parent1, trait);
  const p2Genotype = getGenotype(parent2, trait);
  const p1Gametes = getGametes(p1Genotype);
  const p2Gametes = getGametes(p2Genotype);

  const monoOffspring: string[][] = [];
  for (const g1 of p1Gametes) {
    const row: string[] = [];
    for (const g2 of p2Gametes) {
      // Normalize: dominant letter first
      const alleles = [g1, g2].sort((a2, b) => (a2 === a2.toUpperCase() ? -1 : 1));
      row.push(alleles.join(''));
    }
    monoOffspring.push(row);
  }

  // Dihybrid data
  const p1Geno1 = getGenotype(parent1, trait);
  const p1Geno2 = getGenotype(parent1b, trait2);
  const p2Geno1 = getGenotype(parent2, trait);
  const p2Geno2 = getGenotype(parent2b, trait2);

  const diGametes1 = getDihybridGametes(p1Geno1, p1Geno2);
  const diGametes2 = getDihybridGametes(p2Geno1, p2Geno2);

  const diOffspring: string[][] = [];
  for (const g1 of diGametes1) {
    const row: string[] = [];
    for (const g2 of diGametes2) {
      // Combine: first allele pair from each, then second
      const a1 = [g1[0], g2[0]].sort((a, b) => (a === a.toUpperCase() ? -1 : 1)).join('');
      const a2 = [g1[1], g2[1]].sort((a, b) => (a === a.toUpperCase() ? -1 : 1)).join('');
      row.push(a1 + a2);
    }
    diOffspring.push(row);
  }

  // Calculate ratios
  const calculateRatios = useCallback(() => {
    if (mode === 'monohybrid') {
      const phenoCounts: Record<string, number> = {};
      const genoCounts: Record<string, number> = {};
      for (const row of monoOffspring) {
        for (const g of row) {
          const p = getPhenotype(g, trait);
          phenoCounts[p] = (phenoCounts[p] || 0) + 1;
          genoCounts[g] = (genoCounts[g] || 0) + 1;
        }
      }
      return { phenoCounts, genoCounts, total: 4 };
    } else {
      const phenoCounts: Record<string, number> = {};
      const genoCounts: Record<string, number> = {};
      for (const row of diOffspring) {
        for (const g of row) {
          const p1Pheno = getPhenotype(g.substring(0, 2), trait);
          const p2Pheno = getPhenotype(g.substring(2, 4), trait2);
          const phenoKey = `${p1Pheno} ${p2Pheno}`;
          phenoCounts[phenoKey] = (phenoCounts[phenoKey] || 0) + 1;
          genoCounts[g] = (genoCounts[g] || 0) + 1;
        }
      }
      return { phenoCounts, genoCounts, total: 16 };
    }
  }, [mode, monoOffspring, diOffspring, trait, trait2]);

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, W: number, H: number, time: number) => {
      const dpr = window.devicePixelRatio || 1;
      const w = W / dpr;
      const h = H / dpr;

      ctx.clearRect(0, 0, w, h);

      // Background
      const bg = ctx.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, '#0d1117');
      bg.addColorStop(1, '#151d2a');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      // Animate the build-up
      animProgressRef.current = Math.min(1, animProgressRef.current + 0.02);
      const progress = animProgressRef.current;

      const isMono = modeRef.current === 'monohybrid';
      const gridSize = isMono ? 2 : 4;
      const cellSize = Math.min((w - 100) / (gridSize + 1), (h - 60) / (gridSize + 1), isMono ? 80 : 50);
      const gridW = cellSize * (gridSize + 1);
      const gridH = cellSize * (gridSize + 1);
      const startX = (w - gridW) / 2;
      const startY = 30;

      // Title
      ctx.font = 'bold 14px "Segoe UI", sans-serif';
      ctx.fillStyle = 'rgba(180, 200, 220, 0.9)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(
        isMono ? 'Monohybrid Cross — Punnett Square' : 'Dihybrid Cross — Punnett Square',
        w / 2,
        8
      );

      const gametes1 = isMono ? p1Gametes : diGametes1;
      const gametes2 = isMono ? p2Gametes : diGametes2;
      const offspring = isMono ? monoOffspring : diOffspring;

      // Draw grid
      ctx.strokeStyle = 'rgba(100, 120, 160, 0.3)';
      ctx.lineWidth = 1;

      // Header cell (top-left corner)
      ctx.fillStyle = 'rgba(60, 70, 100, 0.3)';
      ctx.fillRect(startX, startY, cellSize, cellSize);
      ctx.strokeRect(startX, startY, cellSize, cellSize);

      // Cross symbol
      ctx.font = 'bold 16px "Segoe UI", sans-serif';
      ctx.fillStyle = 'rgba(200, 200, 220, 0.5)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String.fromCharCode(0x2715), startX + cellSize / 2, startY + cellSize / 2);

      // Parent 2 gametes (top row)
      if (progress > 0.1) {
        const gAlpha = Math.min(1, (progress - 0.1) / 0.2);
        ctx.globalAlpha = gAlpha;
        for (let j = 0; j < gridSize; j++) {
          const x = startX + (j + 1) * cellSize;
          ctx.fillStyle = 'rgba(80, 120, 180, 0.15)';
          ctx.fillRect(x, startY, cellSize, cellSize);
          ctx.strokeStyle = 'rgba(100, 120, 160, 0.3)';
          ctx.strokeRect(x, startY, cellSize, cellSize);

          ctx.font = `bold ${isMono ? 16 : 12}px "Courier New", monospace`;
          ctx.fillStyle = '#7799dd';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(gametes2[j], x + cellSize / 2, startY + cellSize / 2);
        }
        ctx.globalAlpha = 1;
      }

      // Parent 1 gametes (left column)
      if (progress > 0.2) {
        const gAlpha = Math.min(1, (progress - 0.2) / 0.2);
        ctx.globalAlpha = gAlpha;
        for (let i = 0; i < gridSize; i++) {
          const y = startY + (i + 1) * cellSize;
          ctx.fillStyle = 'rgba(180, 80, 100, 0.12)';
          ctx.fillRect(startX, y, cellSize, cellSize);
          ctx.strokeStyle = 'rgba(100, 120, 160, 0.3)';
          ctx.strokeRect(startX, y, cellSize, cellSize);

          ctx.font = `bold ${isMono ? 16 : 12}px "Courier New", monospace`;
          ctx.fillStyle = '#dd7799';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(gametes1[i], startX + cellSize / 2, y + cellSize / 2);
        }
        ctx.globalAlpha = 1;
      }

      // Offspring cells
      if (progress > 0.4) {
        const cellAlpha = Math.min(1, (progress - 0.4) / 0.4);
        ctx.globalAlpha = cellAlpha;

        for (let i = 0; i < gridSize; i++) {
          for (let j = 0; j < gridSize; j++) {
            const x = startX + (j + 1) * cellSize;
            const y = startY + (i + 1) * cellSize;
            const genotype = offspring[i][j];

            // Phenotype color for background
            let bgColor: string;
            if (isMono) {
              bgColor = getPhenotypeColor(genotype, trait);
            } else {
              const p1Dom = genotype.substring(0, 2).includes(trait.dominantSymbol);
              const p2Dom = genotype.substring(2, 4).includes(trait2.dominantSymbol);
              if (p1Dom && p2Dom) bgColor = '#558866';
              else if (p1Dom) bgColor = '#556688';
              else if (p2Dom) bgColor = '#885566';
              else bgColor = '#665544';
            }

            ctx.fillStyle = bgColor + '30';
            ctx.fillRect(x, y, cellSize, cellSize);
            ctx.strokeStyle = 'rgba(100, 120, 160, 0.3)';
            ctx.strokeRect(x, y, cellSize, cellSize);

            // Genotype text
            ctx.font = `bold ${isMono ? 18 : 11}px "Courier New", monospace`;
            ctx.fillStyle = bgColor;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(genotype, x + cellSize / 2, y + cellSize / 2);
          }
        }
        ctx.globalAlpha = 1;
      }

      // Parent labels
      ctx.font = '10px "Segoe UI", sans-serif';
      ctx.fillStyle = '#dd7799';
      ctx.textAlign = 'center';
      ctx.save();
      ctx.translate(startX - 10, startY + cellSize + (gridSize * cellSize) / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(
        isMono ? `Parent 1: ${p1Genotype}` : `Parent 1: ${p1Geno1}${p1Geno2}`,
        0,
        0
      );
      ctx.restore();

      ctx.fillStyle = '#7799dd';
      ctx.textAlign = 'center';
      ctx.fillText(
        isMono ? `Parent 2: ${p2Genotype}` : `Parent 2: ${p2Geno1}${p2Geno2}`,
        startX + cellSize + (gridSize * cellSize) / 2,
        startY - 6
      );
    },
    [p1Gametes, p2Gametes, monoOffspring, diOffspring, diGametes1, diGametes2, p1Genotype, p2Genotype, p1Geno1, p1Geno2, p2Geno1, p2Geno2, trait, trait2]
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
      const canvasH = mode === 'dihybrid' ? 380 : 300;
      canvas.width = rect.width * dpr;
      canvas.height = canvasH * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${canvasH}px`;
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
  }, [draw, mode]);

  // Reset animation on any parameter change
  useEffect(() => {
    animProgressRef.current = 0;
  }, [parent1, parent2, parent1b, parent2b, traitIndex, trait2Index, mode]);

  const ratios = calculateRatios();

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
        aria-label={`Punnett square showing ${mode} cross with ${trait.name}`}
        style={{
          width: '100%',
          height: mode === 'dihybrid' ? 380 : 300,
          borderRadius: 16,
          display: 'block',
        }}
      />

      <div style={{ padding: '16px 4px 8px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Mode toggle */}
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={() => setMode('monohybrid')}
            aria-label="Switch to monohybrid cross"
            style={pillStyle(mode === 'monohybrid', '#44aa66')}
          >
            Monohybrid
          </button>
          <button
            onClick={() => setMode('dihybrid')}
            aria-label="Switch to dihybrid cross"
            style={pillStyle(mode === 'dihybrid', '#9966cc')}
          >
            Dihybrid
          </button>
        </div>

        {/* Trait selector */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <label style={{ color: 'rgba(200,200,220,0.7)', fontSize: 13, fontWeight: 600 }}>
            Trait 1:
          </label>
          <select
            value={traitIndex}
            onChange={(e) => setTraitIndex(parseInt(e.target.value))}
            aria-label="Select first trait"
            style={selectStyle()}
          >
            {TRAITS.map((t, i) => (
              <option key={i} value={i}>
                {t.name} ({t.dominantSymbol}/{t.recessiveSymbol})
              </option>
            ))}
          </select>

          {mode === 'dihybrid' && (
            <>
              <label style={{ color: 'rgba(200,200,220,0.7)', fontSize: 13, fontWeight: 600 }}>
                Trait 2:
              </label>
              <select
                value={trait2Index}
                onChange={(e) => setTrait2Index(parseInt(e.target.value))}
                aria-label="Select second trait"
                style={selectStyle()}
              >
                {TRAITS.filter((_, i) => i !== traitIndex).map((t, i) => {
                  const actualIndex = TRAITS.indexOf(t);
                  return (
                    <option key={actualIndex} value={actualIndex}>
                      {t.name} ({t.dominantSymbol}/{t.recessiveSymbol})
                    </option>
                  );
                })}
              </select>
            </>
          )}
        </div>

        {/* Parent genotypes */}
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 150 }}>
            <label style={{ color: '#dd7799', fontSize: 12, fontWeight: 700, display: 'block', marginBottom: 4 }}>
              Parent 1 ({trait.name}):
            </label>
            <select
              value={parent1}
              onChange={(e) => setParent1(e.target.value as GenotypeOption)}
              aria-label="Parent 1 genotype for trait 1"
              style={selectStyle()}
            >
              {GENOTYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label} ({getGenotype(o.value, trait)})
                </option>
              ))}
            </select>

            {mode === 'dihybrid' && (
              <>
                <label
                  style={{
                    color: '#dd7799',
                    fontSize: 12,
                    fontWeight: 700,
                    display: 'block',
                    marginTop: 8,
                    marginBottom: 4,
                  }}
                >
                  Parent 1 ({trait2.name}):
                </label>
                <select
                  value={parent1b}
                  onChange={(e) => setParent1b(e.target.value as GenotypeOption)}
                  aria-label="Parent 1 genotype for trait 2"
                  style={selectStyle()}
                >
                  {GENOTYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label} ({getGenotype(o.value, trait2)})
                    </option>
                  ))}
                </select>
              </>
            )}
          </div>

          <div style={{ flex: 1, minWidth: 150 }}>
            <label style={{ color: '#7799dd', fontSize: 12, fontWeight: 700, display: 'block', marginBottom: 4 }}>
              Parent 2 ({trait.name}):
            </label>
            <select
              value={parent2}
              onChange={(e) => setParent2(e.target.value as GenotypeOption)}
              aria-label="Parent 2 genotype for trait 1"
              style={selectStyle()}
            >
              {GENOTYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label} ({getGenotype(o.value, trait)})
                </option>
              ))}
            </select>

            {mode === 'dihybrid' && (
              <>
                <label
                  style={{
                    color: '#7799dd',
                    fontSize: 12,
                    fontWeight: 700,
                    display: 'block',
                    marginTop: 8,
                    marginBottom: 4,
                  }}
                >
                  Parent 2 ({trait2.name}):
                </label>
                <select
                  value={parent2b}
                  onChange={(e) => setParent2b(e.target.value as GenotypeOption)}
                  aria-label="Parent 2 genotype for trait 2"
                  style={selectStyle()}
                >
                  {GENOTYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label} ({getGenotype(o.value, trait2)})
                    </option>
                  ))}
                </select>
              </>
            )}
          </div>
        </div>

        {/* Ratios */}
        <button
          onClick={() => setShowRatios(!showRatios)}
          aria-label={showRatios ? 'Hide ratios' : 'Show ratios'}
          style={pillStyle(showRatios, '#cc8844')}
        >
          {showRatios ? 'Hide Ratios' : 'Show Ratios'}
        </button>

        {showRatios && (
          <div
            style={{
              display: 'flex',
              gap: 14,
              flexWrap: 'wrap',
            }}
          >
            {/* Phenotypic ratio */}
            <div
              style={{
                flex: 1,
                minWidth: 180,
                background: 'rgba(60, 80, 120, 0.1)',
                border: '1px solid rgba(60, 80, 120, 0.2)',
                borderRadius: 10,
                padding: 10,
              }}
            >
              <div style={{ color: 'rgba(200,200,220,0.8)', fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
                Phenotypic Ratio
              </div>
              {Object.entries(ratios.phenoCounts).map(([pheno, count]) => (
                <div key={pheno} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'rgba(180,190,210,0.8)', padding: '2px 0' }}>
                  <span>{pheno}</span>
                  <span style={{ fontWeight: 700, fontFamily: 'monospace' }}>{count}/{ratios.total}</span>
                </div>
              ))}
              <div style={{ marginTop: 4, fontSize: 11, color: 'rgba(200,180,100,0.8)', fontWeight: 600 }}>
                Ratio: {Object.values(ratios.phenoCounts).join(' : ')}
              </div>
            </div>

            {/* Genotypic ratio */}
            <div
              style={{
                flex: 1,
                minWidth: 180,
                background: 'rgba(80, 60, 120, 0.1)',
                border: '1px solid rgba(80, 60, 120, 0.2)',
                borderRadius: 10,
                padding: 10,
              }}
            >
              <div style={{ color: 'rgba(200,200,220,0.8)', fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
                Genotypic Ratio
              </div>
              {Object.entries(ratios.genoCounts).map(([geno, count]) => (
                <div key={geno} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'rgba(180,190,210,0.8)', padding: '2px 0' }}>
                  <span style={{ fontFamily: 'monospace' }}>{geno}</span>
                  <span style={{ fontWeight: 700, fontFamily: 'monospace' }}>{count}/{ratios.total}</span>
                </div>
              ))}
              <div style={{ marginTop: 4, fontSize: 11, color: 'rgba(200,180,100,0.8)', fontWeight: 600 }}>
                Ratio: {Object.values(ratios.genoCounts).join(' : ')}
              </div>
            </div>
          </div>
        )}

        {/* Discovery tip */}
        <p
          style={{
            margin: 0,
            padding: '8px 12px',
            background: 'rgba(68, 170, 102, 0.08)',
            border: '1px solid rgba(68, 170, 102, 0.2)',
            borderRadius: 10,
            color: 'rgba(140, 200, 160, 0.9)',
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          <strong>CBSE Tip:</strong> Try Tt x Tt (heterozygous cross) to see the classic 3:1
          phenotypic ratio that Mendel discovered. Switch to dihybrid with TtRr x TtRr to see
          the famous 9:3:3:1 ratio. These ratios are frequently asked in board exams!
        </p>
      </div>
    </div>
  );
}

/* ─── Style helpers ─── */
function pillStyle(active: boolean, color: string): React.CSSProperties {
  return {
    padding: '8px 18px',
    borderRadius: 20,
    border: `2px solid ${active ? color : 'rgba(100,100,120,0.3)'}`,
    background: active ? `${color}18` : 'transparent',
    color: active ? color : 'rgba(180,180,200,0.6)',
    fontWeight: 700,
    fontSize: 13,
    cursor: 'pointer',
    transition: 'all 0.2s',
    minHeight: 44,
    minWidth: 44,
  };
}

function selectStyle(): React.CSSProperties {
  return {
    padding: '6px 10px',
    borderRadius: 8,
    border: '1px solid rgba(100,120,160,0.3)',
    background: 'rgba(20, 25, 35, 0.8)',
    color: 'rgba(200,200,220,0.9)',
    fontSize: 13,
    cursor: 'pointer',
    minHeight: 36,
    width: '100%',
  };
}
