import { WEEK_DAYS, type WeekDay } from "@/features/core/models"
import type { StoreConfig } from "@/features/store/schemas/store.schema"

export type SectorStatus = "active" | "archived"
export interface SectorHours { readonly day: WeekDay; readonly closed: boolean; readonly opensAt: string; readonly closesAt: string }
export interface CoverageSlot {
  readonly start: string; readonly end: string; readonly employees: number; readonly explicitZero?: boolean
  /**
   * This slot's share of the day, as a whole percent.
   *
   * The DURABLE shape of a day, as opposed to `employees`, which is that shape
   * instantiated for one particular head-count. When someone is absent or an
   * extra pair of hands arrives, the shape holds and only the bodies change —
   * which is the whole reason it is stored rather than derived on the fly.
   *
   * Absent on every sector saved before the column existed; such a day is read
   * as "share = the share its head-counts already describe", so nothing has to
   * be migrated and nothing changes until someone edits a percentage.
   */
  readonly percent?: number
  /**
   * True once a human typed THIS percentage.
   *
   * A locked share is never redistributed. It is what makes "only the numbers
   * you have not touched may move" enforceable: without it, correcting the
   * second slot would silently undo the first correction.
   */
  readonly percentLocked?: boolean
}
export interface SectorCoverage { readonly standardDay: WeekDay | null; readonly profiles: Partial<Record<WeekDay, readonly CoverageSlot[]>> }
export interface SectorCompetency { readonly id: string; readonly name: string; readonly archived: boolean; readonly order: number }
export interface SectorShiftRules {
  readonly inheritMinimumShiftDuration: boolean; readonly minimumShiftDuration: number | null; readonly maximumDailyDuration: number; readonly timeIncrement: 15; readonly splitShiftAllowed: boolean; readonly maximumSplitDuration: number | null
  /** Default weekly caps inherited by every employee who declares none. Null = uncapped. */
  readonly maximumOpeningsPerWeek: number | null; readonly maximumClosingsPerWeek: number | null
  /**
   * Longest UNINTERRUPTED stretch, in minutes. Distinct from
   * `maximumDailyDuration`, which caps the whole day: ten hours are legal split
   * and illegal in one block. Null means the rule is not enforced.
   */
  readonly maximumContinuousDuration: number | null
  /** Shortest gap that COUNTS as a coupure rather than a pause. Null = not declared. */
  readonly minimumSplitDuration: number | null
  /** How many coupures one employee may have in one day. Null = unlimited. */
  readonly maximumSplitsPerDay: number | null
  /** How many employees must start exactly at opening, AT LEAST, on every open day. */
  readonly minimumOpeningsPerDay: number
  /** How many employees must finish exactly at closing, EXACTLY. Locking up is one job. */
  readonly requiredClosingsPerDay: number
  /** Minimum rest between two days, in minutes. Null falls back to the store rule. */
  readonly minimumRestMinutes: number | null
}

/**
 * One unbreakable presence floor: how many people must be on the floor, and
 * when.
 *
 * The hourly head-count profile a sector configures is a TARGET that bends when
 * the team shrinks. This is the part that does not bend, and the reason a
 * schedule can be REFUSED rather than merely reported as short-staffed.
 *
 * `days` empty means every open day. `from`/`to` null extend to the sector's own
 * opening/closing, so "one person throughout" is a single entry.
 */
export interface SectorPresenceRule {
  readonly id: string
  readonly days: readonly WeekDay[]
  readonly from: string | null
  readonly to: string | null
  readonly employees: number
}

/**
 * Closing fairness — a SOFT objective, ranked below coverage on purpose.
 *
 * History is read per sector and only from schedules that actually happened
 * (published or archived), never from drafts. It counts each employee's real
 * OPPORTUNITIES to close as well as their closings, so someone who was away
 * for three weeks is not rewarded with every closing on their return.
 */
export interface SectorClosingFairness {
  readonly balanceClosings: boolean
  readonly balanceSaturdayClosings: boolean
  readonly lookbackWeeks: number
}

export interface SectorDemandConfiguration {
  readonly id: string; readonly name: string; readonly description?: string; readonly color?: string; readonly status: SectorStatus
  /**
   * Groups the fresh-market counters into one generation scope.
   *
   * This is configuration, not a name convention: renaming « Fruits et légumes »
   * must never make it silently leave the common planning.
   */
  readonly marketZone: boolean
  /** Migration marker: version 1 defaults the optional hourly percentages to off. */
  readonly percentageOptionsVersion?: 1
  readonly hours: readonly SectorHours[]; readonly coverage: SectorCoverage
  /** Whether the optional per-slot percentage columns are shown and editable. */
  readonly hourlyPercentagesEnabled: boolean
  /** Manual daily percentages. Off means derive the split from configured demand. */
  readonly weeklyDistributionEnabled: boolean
  readonly weeklyDistribution: Record<WeekDay, number>; readonly workEveryNonFixedRestDay: boolean
  readonly shiftRules: SectorShiftRules; readonly competencies: readonly SectorCompetency[]
  /** Unbreakable floors. Empty means the sector declares none — NOT a floor of zero. */
  readonly minimumPresence: readonly SectorPresenceRule[]
  readonly closingFairness: SectorClosingFairness
}
export interface SectorValidationIssue { readonly path: string; readonly message: string }

/**
 * The rules Planiteo runs on today, stated once.
 *
 * These are not invented defaults: they are the values the business already
 * applies and that the canonical Drive and Accueil problems encode. Two of them
 * — `maximumContinuousDuration` and `maximumSplitsPerDay` — were previously
 * absent from the model, so the engines received `null` and did not enforce
 * them. Giving them a value here is a deliberate behaviour change: a ten-hour
 * day in one block stops being legal by omission.
 */
export const SECTOR_RULE_DEFAULTS = {
  maximumDailyDuration: 600,
  maximumContinuousDuration: 480,
  minimumSplitDuration: 45,
  maximumSplitDuration: 90,
  maximumSplitsPerDay: 1,
  minimumOpeningsPerDay: 1,
  requiredClosingsPerDay: 1,
  minimumRestMinutes: 720,
  lookbackWeeks: 8,
} as const

const TIME_RE = /^([01]\d|2[0-3]):(?:00|15|30|45)$/
const minutes = (value: string) => { const [hour, minute] = value.split(":").map(Number); return hour * 60 + minute }
const time = (value: number) => `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`

export function createEmptySector(id = `sector_${crypto.randomUUID()}`): SectorDemandConfiguration {
  return { id, name: "", description: "", color: "#2563eb", status: "active", marketZone: false, percentageOptionsVersion: 1,
    hours: WEEK_DAYS.map((day) => ({ day, closed: true, opensAt: "09:00", closesAt: "18:00" })),
    coverage: { standardDay: null, profiles: {} },
    hourlyPercentagesEnabled: false,
    weeklyDistributionEnabled: false,
    // The sole V3 engine currently requires every available non-rest day to be
    // worked. Defaulting a new sector to the unsupported optional-day mode made
    // a freshly created aisle look like a week where everybody was resting.
    workEveryNonFixedRestDay: true,
    weeklyDistribution: Object.fromEntries(WEEK_DAYS.map((day) => [day, 0])) as Record<WeekDay, number>,
    shiftRules: {
      inheritMinimumShiftDuration: true, minimumShiftDuration: null, timeIncrement: 15, splitShiftAllowed: false,
      maximumDailyDuration: SECTOR_RULE_DEFAULTS.maximumDailyDuration,
      maximumSplitDuration: SECTOR_RULE_DEFAULTS.maximumSplitDuration,
      maximumOpeningsPerWeek: null, maximumClosingsPerWeek: null,
      maximumContinuousDuration: SECTOR_RULE_DEFAULTS.maximumContinuousDuration,
      minimumSplitDuration: SECTOR_RULE_DEFAULTS.minimumSplitDuration,
      maximumSplitsPerDay: SECTOR_RULE_DEFAULTS.maximumSplitsPerDay,
      minimumOpeningsPerDay: SECTOR_RULE_DEFAULTS.minimumOpeningsPerDay,
      requiredClosingsPerDay: SECTOR_RULE_DEFAULTS.requiredClosingsPerDay,
      minimumRestMinutes: SECTOR_RULE_DEFAULTS.minimumRestMinutes,
    },
    competencies: [],
    // No floor by default: a brand-new sector must not silently gain a rule that
    // can REFUSE a schedule. Declaring one is a deliberate act.
    minimumPresence: [],
    closingFairness: { balanceClosings: false, balanceSaturdayClosings: false, lookbackWeeks: SECTOR_RULE_DEFAULTS.lookbackWeeks },
  }
}

export function buildHourlyProfile(opensAt: string, closesAt: string, employees = 1): CoverageSlot[] {
  if (!TIME_RE.test(opensAt) || !TIME_RE.test(closesAt) || minutes(closesAt) <= minutes(opensAt)) return []
  const slots: CoverageSlot[] = []
  for (let start = minutes(opensAt); start < minutes(closesAt); start += 60) slots.push({ start: time(start), end: time(Math.min(start + 60, minutes(closesAt))), employees })
  return slots
}

/** Open all seven days on identical hours, rebuilding every coverage profile. */
export function applyHoursToEveryDay(sector: SectorDemandConfiguration, opensAt: string, closesAt: string): SectorDemandConfiguration {
  const profile = buildHourlyProfile(opensAt, closesAt)
  return { ...sector,
    hours: WEEK_DAYS.map((day) => ({ day, closed: false, opensAt, closesAt })),
    coverage: { ...sector.coverage, profiles: Object.fromEntries(WEEK_DAYS.map((day) => [day, profile.map((slot) => ({ ...slot }))])) } }
}

/**
 * Split `total` across `weights` as WHOLE numbers that add up to exactly
 * `total`.
 *
 * Largest remainder, not naive rounding. Rounding each share on its own leaves
 * a total of 99 or 101 depending on the day, and a column that is supposed to
 * read 100 % would be wrong roughly half the time — which is precisely the kind
 * of arithmetic a manager stops trusting after seeing it once.
 *
 * A zero total weight yields zeros: a day nobody is wanted on has no shape to
 * describe, and inventing an equal split would put a share on hours the sector
 * never asked to staff.
 */
function largestRemainder(weights: readonly number[], total = 100): number[] {
  const sum = weights.reduce((acc, weight) => acc + Math.max(0, weight), 0)
  if (sum <= 0 || weights.length === 0) return weights.map(() => 0)

  const exact = weights.map((weight) => (Math.max(0, weight) * total) / sum)
  const floors = exact.map(Math.floor)
  let left = total - floors.reduce((acc, value) => acc + value, 0)

  // Ties broken by index so the same input always produces the same output.
  const order = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((left_, right) => right.remainder - left_.remainder || left_.index - right.index)

  const result = [...floors]
  for (const entry of order) {
    if (left <= 0) break
    result[entry.index] += 1
    left -= 1
  }
  return result
}

/**
 * Daily percentages handed to V3.
 *
 * When manual distribution is disabled, the configured coverage volume is the
 * weight: three employees over an hour count three times one employee over the
 * same hour. A profile containing only explicit zeros falls back to opening
 * duration, so contracts are still distributed over open days rather than
 * producing a zero-minute week.
 */
export function effectiveWeeklyDistribution(
  sector: SectorDemandConfiguration
): Record<WeekDay, number> {
  if (sector.weeklyDistributionEnabled !== false) {
    return { ...sector.weeklyDistribution }
  }

  const demandWeights = WEEK_DAYS.map((day) => {
    const hours = sector.hours.find((entry) => entry.day === day)
    if (!hours || hours.closed) return 0
    return (sector.coverage.profiles[day] ?? []).reduce(
      (sum, slot) =>
        sum + Math.max(0, slot.employees) * Math.max(0, minutes(slot.end) - minutes(slot.start)),
      0
    )
  })
  const fallbackWeights = WEEK_DAYS.map((day) => {
    const hours = sector.hours.find((entry) => entry.day === day)
    return !hours || hours.closed ? 0 : Math.max(0, minutes(hours.closesAt) - minutes(hours.opensAt))
  })
  const weights = demandWeights.some((weight) => weight > 0) ? demandWeights : fallbackWeights
  const percentages = largestRemainder(weights)
  return Object.fromEntries(
    WEEK_DAYS.map((day, index) => [day, percentages[index]])
  ) as Record<WeekDay, number>
}

/**
 * The percentages a day's slots currently describe.
 *
 * Stored shares win when the day has them; otherwise they are derived from the
 * head-counts, so a sector saved before this column existed reads exactly as it
 * always did and needs no migration.
 */
export function coveragePercentages(slots: readonly CoverageSlot[]): number[] {
  return slots.every((slot) => typeof slot.percent === "number")
    ? slots.map((slot) => slot.percent!)
    : largestRemainder(slots.map((slot) => slot.employees))
}

/**
 * Set one slot's share and rebalance the day back to 100 %.
 *
 * Two rules, and the second is what makes the first usable:
 *
 * - the day always totals 100 %;
 * - only shares NOBODY has touched may move. A locked share is the manager's
 *   decision, and a rebalance that quietly revised it would make correcting a
 *   second slot undo the first.
 *
 * When every other share is already locked there is nothing left to absorb the
 * change, so the new value is CLAMPED to what the locked ones leave free rather
 * than silently pushing the day past 100 %.
 */
export function withCoveragePercent(
  slots: readonly CoverageSlot[],
  start: string,
  percent: number
): CoverageSlot[] {
  const current = coveragePercentages(slots)
  const index = slots.findIndex((slot) => slot.start === start)
  if (index === -1) return [...slots]

  const lockedElsewhere = slots.reduce(
    (sum, slot, position) => (position !== index && slot.percentLocked ? sum + current[position] : sum),
    0
  )
  const target = Math.max(0, Math.min(Math.round(percent), 100 - lockedElsewhere))

  const freeIndexes = slots
    .map((slot, position) => ({ slot, position }))
    .filter(({ slot, position }) => position !== index && !slot.percentLocked)
    .map(({ position }) => position)

  // What the untouched slots must share out between them.
  const remaining = 100 - lockedElsewhere - target
  const shares = largestRemainder(
    freeIndexes.map((position) => current[position]),
    Math.max(0, remaining)
  )

  return slots.map((slot, position) => {
    if (position === index) return { ...slot, percent: target, percentLocked: true }
    if (slot.percentLocked) return { ...slot, percent: current[position] }
    return { ...slot, percent: shares[freeIndexes.indexOf(position)] ?? 0 }
  })
}

/** Forget every manual share on a day, so the head-counts describe it again. */
export function releaseCoveragePercentages(slots: readonly CoverageSlot[]): CoverageSlot[] {
  return slots.map((slot) => {
    const released = { ...slot }
    delete (released as { percent?: number }).percent
    delete (released as { percentLocked?: boolean }).percentLocked
    return released
  })
}

export function copyCoverageProfile(sector: SectorDemandConfiguration, source: WeekDay, target: WeekDay): SectorDemandConfiguration {
  return { ...sector, coverage: { ...sector.coverage, profiles: { ...sector.coverage.profiles, [target]: (sector.coverage.profiles[source] ?? []).map((slot) => ({ ...slot })) } } }
}

export function effectiveMinimumShiftDuration(sector: SectorDemandConfiguration, store: StoreConfig | null): number | null {
  return sector.shiftRules.inheritMinimumShiftDuration ? store?.minShiftDuration ?? null : sector.shiftRules.minimumShiftDuration
}

export function validateSectorDemand(sector: SectorDemandConfiguration, store: StoreConfig | null): SectorValidationIssue[] {
  const issues: SectorValidationIssue[] = []
  if (!sector.name.trim()) issues.push({ path: "name", message: "Le nom du secteur est obligatoire." })
  for (const day of sector.hours) {
    if (day.closed) continue
    if (!TIME_RE.test(day.opensAt) || !TIME_RE.test(day.closesAt)) { issues.push({ path: `hours.${day.day}`, message: "Les horaires doivent respecter des pas de 15 minutes." }); continue }
    if (minutes(day.closesAt) <= minutes(day.opensAt)) issues.push({ path: `hours.${day.day}`, message: "L’heure de fin doit être après l’heure de début." })
    // Le secteur n'est PAS tenu de rester dans les horaires du magasin : un
    // Drive ouvre avant la surface de vente et un Accueil ferme après elle. La
    // contrainte inverse était écrite ici et refusait des configurations
    // parfaitement réelles.
    const expected = buildHourlyProfile(day.opensAt, day.closesAt), profile = sector.coverage.profiles[day.day] ?? []
    if (profile.length !== expected.length || expected.some((slot, index) => profile[index]?.start !== slot.start || profile[index]?.end !== slot.end)) issues.push({ path: `coverage.${day.day}`, message: "La couverture doit couvrir toute la période d’ouverture du secteur." })
    if (profile.some((slot) => !Number.isInteger(slot.employees) || slot.employees < 0 || (slot.employees === 0 && !slot.explicitZero))) issues.push({ path: `coverage.${day.day}`, message: "Chaque besoin doit être un entier positif, ou zéro explicitement confirmé." })
  }
  if (sector.weeklyDistributionEnabled !== false) {
    const total = WEEK_DAYS.reduce((sum, day) => sum + (sector.weeklyDistribution[day] ?? 0), 0)
    if (total !== 100) issues.push({ path: "weeklyDistribution", message: `La répartition doit totaliser exactement 100 % (actuellement ${total} %).` })
    if (WEEK_DAYS.some((day) => !Number.isFinite(sector.weeklyDistribution[day]) || sector.weeklyDistribution[day] < 0)) issues.push({ path: "weeklyDistribution", message: "Les pourcentages ne peuvent pas être négatifs." })
  }
  if (!sector.workEveryNonFixedRestDay) {
    issues.push({
      path: "workEveryNonFixedRestDay",
      message:
        "Le moteur V3 actuel ne prend pas encore en charge les jours de travail facultatifs. Activez « Planifier un shift chaque jour ouvert hors repos fixe ».",
    })
  }
  const minimum = effectiveMinimumShiftDuration(sector, store)
  if (!minimum || minimum <= 0 || minimum % 15 !== 0) issues.push({ path: "shiftRules.minimumShiftDuration", message: "La durée minimale d’un shift est obligatoire et doit respecter un pas de 15 minutes." })
  if (sector.shiftRules.maximumDailyDuration <= 0 || sector.shiftRules.maximumDailyDuration % 15 !== 0) issues.push({ path: "shiftRules.maximumDailyDuration", message: "La durée quotidienne maximale doit être positive et respecter un pas de 15 minutes." })
  if (minimum && sector.shiftRules.maximumDailyDuration < minimum) issues.push({ path: "shiftRules.maximumDailyDuration", message: "La durée quotidienne maximale doit être supérieure à la durée minimale d’un shift." })
  for (const [path, cap] of [["maximumOpeningsPerWeek", sector.shiftRules.maximumOpeningsPerWeek], ["maximumClosingsPerWeek", sector.shiftRules.maximumClosingsPerWeek]] as const) {
    if (cap !== null && cap !== undefined && (!Number.isInteger(cap) || cap < 0)) issues.push({ path: `shiftRules.${path}`, message: "Le plafond hebdomadaire doit être un entier positif ou nul, ou vide pour aucune limite." })
  }
  if (sector.shiftRules.splitShiftAllowed && (!sector.shiftRules.maximumSplitDuration || sector.shiftRules.maximumSplitDuration <= 0 || sector.shiftRules.maximumSplitDuration % 15 !== 0)) issues.push({ path: "shiftRules.maximumSplitDuration", message: "La coupure maximale doit être positive et respecter un pas de 15 minutes." })
  issues.push(...validateAdvancedSectorRules(sector, store))
  return issues
}

/** Durations, coupures, boundaries, rest and floors — the « Contraintes avancées » block. */
function validateAdvancedSectorRules(sector: SectorDemandConfiguration, store: StoreConfig | null): SectorValidationIssue[] {
  const issues: SectorValidationIssue[] = []
  const rules = sector.shiftRules
  const minimum = effectiveMinimumShiftDuration(sector, store)
  const step = (path: string, value: number | null, label: string) => {
    if (value === null) return
    if (value <= 0 || value % 15 !== 0) issues.push({ path: `shiftRules.${path}`, message: `${label} doit être positive et respecter un pas de 15 minutes.` })
  }

  step("maximumContinuousDuration", rules.maximumContinuousDuration, "La durée continue maximale")
  step("minimumRestMinutes", rules.minimumRestMinutes, "Le repos minimum entre deux journées")
  if (rules.maximumContinuousDuration !== null && rules.maximumContinuousDuration > rules.maximumDailyDuration) {
    issues.push({ path: "shiftRules.maximumContinuousDuration", message: "La durée continue maximale ne peut pas dépasser la durée quotidienne maximale." })
  }
  if (rules.maximumContinuousDuration !== null && minimum && rules.maximumContinuousDuration < minimum) {
    issues.push({ path: "shiftRules.maximumContinuousDuration", message: "La durée continue maximale doit être au moins égale à la durée minimale d’un shift." })
  }

  if (rules.splitShiftAllowed) {
    step("minimumSplitDuration", rules.minimumSplitDuration, "La coupure minimale")
    if (rules.minimumSplitDuration !== null && rules.maximumSplitDuration !== null && rules.minimumSplitDuration > rules.maximumSplitDuration) {
      issues.push({ path: "shiftRules.minimumSplitDuration", message: "La coupure minimale ne peut pas dépasser la coupure maximale." })
    }
    if (rules.maximumSplitsPerDay !== null && (!Number.isInteger(rules.maximumSplitsPerDay) || rules.maximumSplitsPerDay < 1)) {
      issues.push({ path: "shiftRules.maximumSplitsPerDay", message: "Le nombre maximal de coupures par jour doit être un entier d’au moins 1, ou vide pour aucune limite." })
    }
  }

  for (const [path, value, label] of [
    ["minimumOpeningsPerDay", rules.minimumOpeningsPerDay, "Le nombre minimum d’ouvertures par jour"],
    ["requiredClosingsPerDay", rules.requiredClosingsPerDay, "Le nombre minimum de fermeurs par jour"],
  ] as const) {
    if (!Number.isInteger(value) || value < 0) issues.push({ path: `shiftRules.${path}`, message: `${label} doit être un entier positif ou nul.` })
  }

  for (const rule of sector.minimumPresence) {
    const path = `minimumPresence.${rule.id}`
    if (!Number.isInteger(rule.employees) || rule.employees < 1) {
      issues.push({ path, message: "Un minimum renforcé doit exiger au moins une personne." })
    }
    // Null bounds mean "l'ouverture" / "la fermeture" and are always valid; a
    // stated bound must be a real time on the canonical step.
    for (const [bound, label] of [[rule.from, "de début"], [rule.to, "de fin"]] as const) {
      if (bound !== null && !TIME_RE.test(bound)) issues.push({ path, message: `L’heure ${label} doit respecter un pas de 15 minutes.` })
    }
    if (rule.from !== null && rule.to !== null && TIME_RE.test(rule.from) && TIME_RE.test(rule.to) && minutes(rule.to) <= minutes(rule.from)) {
      issues.push({ path, message: "L’heure de fin doit être après l’heure de début." })
    }
  }

  const { lookbackWeeks } = sector.closingFairness
  if (!Number.isInteger(lookbackWeeks) || lookbackWeeks < 1) {
    issues.push({ path: "closingFairness.lookbackWeeks", message: "L’historique doit couvrir au moins une semaine." })
  }

  return issues
}

export function isSectorDemandReady(sector: SectorDemandConfiguration, store: StoreConfig | null, employees: readonly { status: string; sectors?: readonly string[] }[]) {
  return sector.status !== "active" || (validateSectorDemand(sector, store).length === 0 && employees.some((employee) => employee.status === "active" && employee.sectors?.includes(sector.name)))
}
