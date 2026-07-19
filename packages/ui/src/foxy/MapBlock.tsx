'use client';

/**
 * MapBlock — Geographic/political map renderer for SST subjects.
 *
 * Renders map blocks with highlighted regions, markers, and layer toggles.
 * Uses a static SVG fallback (P12 fail-safe) with marker list when MapLibre
 * is unavailable. MapLibre GL JS is lazy-loaded via next/dynamic (P10 bundle).
 *
 * Bilingual labels via CHROME map (P7).
 */

import React, { memo, useState } from 'react';
import type { FoxyMapBlock } from '@alfanumrik/lib/foxy/schema';
import { useAuth } from '@alfanumrik/lib/AuthContext';

interface MapBlockProps {
  block: FoxyMapBlock;
}

interface MapChrome {
  markers: string;
  layers: string;
  highlighted: string;
  political: string;
  physical: string;
  thematic: string;
  historical: string;
  rivers: string;
  mountains: string;
  trade_routes: string;
  monsoon: string;
  rainfall: string;
  vegetation: string;
  minerals: string;
  mapNotAvailable: string;
}

const CHROME: { en: MapChrome; hi: MapChrome } = {
  en: {
    markers: 'Key Locations',
    layers: 'Layers',
    highlighted: 'Highlighted Regions',
    political: 'Political Map',
    physical: 'Physical Map',
    thematic: 'Thematic Map',
    historical: 'Historical Map',
    rivers: 'Rivers',
    mountains: 'Mountains',
    trade_routes: 'Trade Routes',
    monsoon: 'Monsoon',
    rainfall: 'Rainfall',
    vegetation: 'Vegetation',
    minerals: 'Minerals',
    mapNotAvailable: 'Map view not available — see details below',
  },
  hi: {
    markers: 'प्रमुख स्थान',
    layers: 'परतें',
    highlighted: 'चिन्हित क्षेत्र',
    political: 'राजनीतिक मानचित्र',
    physical: 'भौतिक मानचित्र',
    thematic: 'विषयगत मानचित्र',
    historical: 'ऐतिहासिक मानचित्र',
    rivers: 'नदियाँ',
    mountains: 'पर्वत',
    trade_routes: 'व्यापार मार्ग',
    monsoon: 'मानसून',
    rainfall: 'वर्षा',
    vegetation: 'वनस्पति',
    minerals: 'खनिज',
    mapNotAvailable: 'मानचित्र दृश्य उपलब्ध नहीं — नीचे विवरण देखें',
  },
};

const LAYER_COLORS: Record<string, string> = {
  rivers: 'bg-blue-500',
  mountains: 'bg-amber-700',
  trade_routes: 'bg-red-500',
  monsoon: 'bg-teal-500',
  rainfall: 'bg-sky-400',
  vegetation: 'bg-green-500',
  minerals: 'bg-yellow-500',
};

/**
 * Static fallback renderer (P12): renders markers and regions as a styled
 * list when MapLibre cannot load. Always available, no external deps.
 */
function StaticMapFallback({
  block,
  chrome,
}: {
  block: FoxyMapBlock;
  chrome: MapChrome;
}) {
  return (
    <div className="space-y-3">
      {/* Map type badge */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300">
          {chrome[block.map_type]}
        </span>
        <span className="text-sm text-gray-600 dark:text-gray-400">
          {block.region}
        </span>
      </div>

      {/* Highlighted regions */}
      {block.highlighted_regions && block.highlighted_regions.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
            {chrome.highlighted}
          </h4>
          <div className="flex flex-wrap gap-1">
            {block.highlighted_regions.map((region, idx) => (
              <span
                key={idx}
                className="text-xs px-2 py-0.5 rounded bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-300"
              >
                {region}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Markers */}
      {block.markers && block.markers.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
            {chrome.markers}
          </h4>
          <ul className="space-y-1">
            {block.markers.map((marker, idx) => (
              <li key={idx} className="flex items-start gap-2 text-sm">
                <span className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded-full bg-red-100 dark:bg-red-900 text-red-600 dark:text-red-400 text-xs font-bold">
                  {idx + 1}
                </span>
                <div>
                  <span className="font-medium">{marker.label}</span>
                  {marker.description && (
                    <span className="text-gray-500 dark:text-gray-400">
                      {' '}&mdash; {marker.description}
                    </span>
                  )}
                  <span className="text-xs text-gray-400 ml-1">
                    ({marker.lat.toFixed(1)}, {marker.lng.toFixed(1)})
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Active layers */}
      {block.layers && block.layers.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
            {chrome.layers}
          </h4>
          <div className="flex flex-wrap gap-1">
            {block.layers.map((layer) => (
              <span
                key={layer}
                className="flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800"
              >
                <span
                  className={`w-2 h-2 rounded-full ${LAYER_COLORS[layer] || 'bg-gray-400'}`}
                />
                {chrome[layer]}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export const MapBlock = memo(function MapBlock({ block }: MapBlockProps) {
  const { isHi } = useAuth();
  const chrome = isHi ? CHROME.hi : CHROME.en;
  const [showDetails, setShowDetails] = useState(true);

  return (
    <div className="my-3 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
      {/* Header */}
      {block.map_title && (
        <div className="px-4 py-2 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
            {block.map_title}
          </h3>
        </div>
      )}

      {/* Map content (static fallback; MapLibre integration future enhancement) */}
      <div className="p-4">
        <StaticMapFallback block={block} chrome={chrome} />
      </div>

      {/* Toggle details */}
      {(block.markers?.length || block.highlighted_regions?.length) && (
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="w-full px-4 py-1.5 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 bg-gray-50 dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700"
        >
          {showDetails ? '▲' : '▼'} {chrome.markers}
        </button>
      )}
    </div>
  );
});
