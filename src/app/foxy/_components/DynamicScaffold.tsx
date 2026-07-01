import React from 'react';

export interface UiActionPayload {
  type: string;
  data: any;
}

export default function DynamicScaffold({ action }: { action: UiActionPayload }) {
  if (action.type === 'render_fraction_bars') {
    const { numerator, denominator } = action.data;
    if (typeof numerator !== 'number' || typeof denominator !== 'number' || denominator === 0) return null;
    return (
      <div className="my-4 p-4 rounded-xl bg-white/5 border border-[var(--border-base)] shadow-sm">
        <p className="text-sm font-medium mb-3">Fraction: {numerator}/{denominator}</p>
        <div className="flex w-full h-8 rounded-md overflow-hidden bg-[var(--surface-sunken)] border border-[var(--border-base)]">
          {Array.from({ length: denominator }).map((_, i) => (
            <div
              key={i}
              className="flex-1 border-r border-[var(--border-base)] last:border-r-0 transition-colors duration-500"
              style={{ background: i < numerator ? 'var(--teal)' : 'transparent' }}
            />
          ))}
        </div>
      </div>
    );
  }

  if (action.type === 'render_number_line') {
    const { min = 0, max = 10, highlight_points = [] } = action.data;
    const range = max - min;
    if (range <= 0 || range > 50) return null; // sanity check
    return (
      <div className="my-4 p-6 rounded-xl bg-white/5 border border-[var(--border-base)] shadow-sm overflow-x-auto">
        <p className="text-sm font-medium mb-6">Number Line</p>
        <div className="relative w-full flex items-center h-12 min-w-[300px]">
          {/* Main line */}
          <div className="absolute left-0 right-0 h-1 bg-[var(--border-base)] top-1/2 -translate-y-1/2" />
          
          {/* Ticks and numbers */}
          <div className="absolute left-0 right-0 flex justify-between">
            {Array.from({ length: range + 1 }).map((_, i) => {
              const val = min + i;
              const isHighlighted = (highlight_points as number[]).includes(val);
              return (
                <div key={val} className="relative flex flex-col items-center">
                  <div
                    className={`w-0.5 ${isHighlighted ? 'h-4' : 'h-3'}`}
                    style={{ background: isHighlighted ? 'var(--teal)' : 'var(--text-3)' }}
                  />
                  <span
                    className="absolute top-5 text-xs font-medium"
                    style={{ color: isHighlighted ? 'var(--teal)' : 'var(--text-3)' }}
                  >
                    {val}
                  </span>
                  {isHighlighted && (
                    <div className="absolute -top-3 w-2 h-2 rounded-full animate-pulse" style={{ background: 'var(--teal)' }} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  return null;
}
