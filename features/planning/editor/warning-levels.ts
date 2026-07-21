/**
 * The four validation levels of the editor. Ordered from best to worst.
 * - `green`  — everything valid.
 * - `yellow` — minor warning (e.g. contract slightly exceeded). Editing allowed.
 * - `orange` — important warning (e.g. coverage degraded). Editing allowed.
 * - `red`    — blocking (hard constraint / missing skill). Prevents publishing.
 */
export const WARNING_LEVELS = ["green", "yellow", "orange", "red"] as const
export type WarningLevel = (typeof WARNING_LEVELS)[number]

const ORDER: Record<WarningLevel, number> = { green: 0, yellow: 1, orange: 2, red: 3 }

/** The more severe of two levels. */
export function worstLevel(a: WarningLevel, b: WarningLevel): WarningLevel {
  return ORDER[a] >= ORDER[b] ? a : b
}

/** Only `red` blocks publishing; every other level still allows editing. */
export function blocks(level: WarningLevel): boolean {
  return level === "red"
}

/** Signals that determine the planning-wide level. */
export interface PlanningLevelSignals {
  readonly hardViolations: number
  readonly missingCapabilities: number
  readonly underCoveredRequirements: number
  readonly softWarnings: number
}

/**
 * Planning-wide level: hard violation or missing skill → red; degraded coverage
 * → orange; soft warnings → yellow; otherwise green.
 */
export function planningLevel(signals: PlanningLevelSignals): WarningLevel {
  if (signals.hardViolations > 0 || signals.missingCapabilities > 0) return "red"
  if (signals.underCoveredRequirements > 0) return "orange"
  if (signals.softWarnings > 0) return "yellow"
  return "green"
}

/**
 * Per-employee level: named in a hard violation → red; planned hours over
 * contract → yellow (minor); otherwise green.
 */
export function employeeLevel(
  plannedMinutes: number,
  contractMinutes: number,
  hasHardViolation: boolean
): WarningLevel {
  if (hasHardViolation) return "red"
  if (contractMinutes > 0 && plannedMinutes > contractMinutes) return "yellow"
  return "green"
}

/** Per-day coverage level: fully covered → green; partially → orange; none → red. */
export function dayCoverageLevel(rate: number): WarningLevel {
  if (rate >= 1) return "green"
  if (rate <= 0) return "red"
  return "orange"
}
