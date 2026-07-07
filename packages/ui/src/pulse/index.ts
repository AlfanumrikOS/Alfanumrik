// src/components/pulse/index.ts
//
// Barrel for the Student Pulse UI. Components are presentational only — they
// CONSUME the frozen contract (`@alfanumrik/lib/pulse/types`) + SWR hooks
// (`@alfanumrik/lib/pulse/use-pulse`) and never mutate or re-derive signal math.

export { default as StudentPulse } from './StudentPulse';
export { default as StudentPulseList } from './StudentPulseList';
export { default as SchoolPulsePanel } from './SchoolPulsePanel';
export { default as PulseStatusCard } from './PulseStatusCard';
export { default as PulseSignals } from './PulseSignals';
export { default as PulseMasterySummary } from './PulseMasterySummary';
export { default as PulseTimeline } from './PulseTimeline';
export type { PulseVariant } from './pulse-copy';
export type { PulseVitals } from './PulseStatusCard';
