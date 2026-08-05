/**
 * SEL Companion barrel (Phase 5 S1.5 / U5).
 * Pure re-exports — no I/O.
 */
export {
  CASEL_COMPETENCIES,
  CASEL_BEHAVIOR_RULES,
  selectCaselMoment,
} from './casel-map';

export type {
  CaselCompetency,
  CaselSignals,
  SignalPredicate,
  BilingualPrompt,
  CaselRule,
  CaselMoment,
} from './casel-map';
