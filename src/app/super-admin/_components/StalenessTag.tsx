'use client';

export function StalenessTag({ lastUpdated, thresholdMinutes = 5 }: {
  lastUpdated: Date | null;
  thresholdMinutes?: number;
}) {
  if (!lastUpdated) return null;

  const ageSeconds = Math.round((Date.now() - lastUpdated.getTime()) / 1000);
  const ageMinutes = Math.round(ageSeconds / 60);
  const isStale = ageMinutes >= thresholdMinutes;

  const label = ageSeconds < 60
    ? 'just now'
    : `${ageMinutes}m ago`;

  return (
    <span className={`text-xs ${isStale ? 'text-amber-600' : 'text-gray-400'}`}>
      {label}{isStale ? ' \u26A0' : ''}
    </span>
  );
}
