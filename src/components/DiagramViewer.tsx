'use client';

import { useState } from 'react';

interface TopicDiagram {
  id: string;
  image_url: string;
  caption: string | null;
  caption_hi: string | null;
  alt_text: string | null;
  diagram_type: string;
  display_order: number;
}

interface DiagramViewerProps {
  diagrams: TopicDiagram[];
  isHi?: boolean;
}

/**
 * DiagramViewer — renders topic diagrams inline with concept explanations.
 * Supports: figures, charts, flowcharts, formula images.
 * Features: lazy loading, tap-to-zoom on mobile, captions.
 */
export function DiagramViewer({ diagrams, isHi = false }: DiagramViewerProps) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (!diagrams || diagrams.length === 0) return null;

  return (
    <div className="space-y-3 my-4">
      {diagrams.map((d) => (
        <figure
          key={d.id}
          className="rounded-xl overflow-hidden"
          style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
        >
          {/* Image with lazy loading */}
          <div
            className="relative cursor-pointer"
            onClick={() => setExpanded(expanded === d.id ? null : d.id)}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={d.image_url}
              alt={d.alt_text || d.caption || 'Diagram'}
              loading="lazy"
              className="w-full object-contain transition-all"
              style={{
                maxHeight: expanded === d.id ? 'none' : 300,
                background: '#fff',
              }}
            />
            {expanded !== d.id && (
              <div
                className="absolute bottom-0 left-0 right-0 h-8 flex items-center justify-center text-[10px] font-medium"
                style={{ background: 'linear-gradient(transparent, var(--surface-1))', color: 'var(--text-3)' }}
              >
                Tap to expand
              </div>
            )}
          </div>

          {/* Caption */}
          {(d.caption || d.caption_hi) && (
            <figcaption
              className="px-3 py-2 text-xs leading-relaxed"
              style={{ color: 'var(--text-2)', borderTop: '1px solid var(--border)' }}
            >
              <span className="font-semibold" style={{ color: 'var(--text-3)' }}>
                {d.diagram_type === 'figure' ? 'Fig' : d.diagram_type === 'chart' ? 'Chart' : 'Diagram'}
                {` ${d.display_order}: `}
              </span>
              {isHi ? (d.caption_hi || d.caption) : d.caption}
            </figcaption>
          )}
        </figure>
      ))}
    </div>
  );
}

export default DiagramViewer;
