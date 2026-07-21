import { WEEK_DAYS, type WeekDay } from "@/features/core/models"
import type { StoreConfig } from "@/features/store/schemas/store.schema"

export type SectorStatus = "active" | "archived"
export interface SectorHours { readonly day: WeekDay; readonly closed: boolean; readonly opensAt: string; readonly closesAt: string }
export interface CoverageSlot { readonly start: string; readonly end: string; readonly employees: number; readonly explicitZero?: boolean }
export interface SectorCoverage { readonly standardDay: WeekDay | null; readonly profiles: Partial<Record<WeekDay, readonly CoverageSlot[]>> }
export interface SectorCompetency { readonly id: string; readonly name: string; readonly archived: boolean; readonly order: number }
export interface SectorShiftRules { readonly inheritMinimumShiftDuration: boolean; readonly minimumShiftDuration: number | null; readonly maximumDailyDuration: number; readonly timeIncrement: 15; readonly splitShiftAllowed: boolean; readonly maximumSplitDuration: number | null }
export interface SectorDemandConfiguration {
  readonly id: string; readonly name: string; readonly description?: string; readonly color?: string; readonly status: SectorStatus
  readonly hours: readonly SectorHours[]; readonly coverage: SectorCoverage; readonly weeklyDistribution: Record<WeekDay, number>; readonly workEveryNonFixedRestDay: boolean
  readonly shiftRules: SectorShiftRules; readonly competencies: readonly SectorCompetency[]
}
export interface SectorValidationIssue { readonly path: string; readonly message: string }

const TIME_RE = /^([01]\d|2[0-3]):(?:00|15|30|45)$/
const minutes = (value: string) => { const [hour, minute] = value.split(":").map(Number); return hour * 60 + minute }
const time = (value: number) => `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`

export function createEmptySector(id = `sector_${crypto.randomUUID()}`): SectorDemandConfiguration {
  return { id, name: "", description: "", color: "#2563eb", status: "active",
    hours: WEEK_DAYS.map((day) => ({ day, closed: true, opensAt: "09:00", closesAt: "18:00" })),
    coverage: { standardDay: null, profiles: {} }, workEveryNonFixedRestDay: false,
    weeklyDistribution: Object.fromEntries(WEEK_DAYS.map((day) => [day, 0])) as Record<WeekDay, number>,
    shiftRules: { inheritMinimumShiftDuration: true, minimumShiftDuration: null, maximumDailyDuration: 600, timeIncrement: 15, splitShiftAllowed: false, maximumSplitDuration: 90 }, competencies: [] }
}

export function buildHourlyProfile(opensAt: string, closesAt: string, employees = 1): CoverageSlot[] {
  if (!TIME_RE.test(opensAt) || !TIME_RE.test(closesAt) || minutes(closesAt) <= minutes(opensAt)) return []
  const slots: CoverageSlot[] = []
  for (let start = minutes(opensAt); start < minutes(closesAt); start += 60) slots.push({ start: time(start), end: time(Math.min(start + 60, minutes(closesAt))), employees })
  return slots
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
    const storeDay = store?.openingHours.find((item) => item.day === day.day)
    if (!storeDay || storeDay.closed || day.opensAt < storeDay.opensAt || day.closesAt > storeDay.closesAt) issues.push({ path: `hours.${day.day}`, message: "Les horaires du secteur doivent rester dans les horaires du magasin." })
    const expected = buildHourlyProfile(day.opensAt, day.closesAt), profile = sector.coverage.profiles[day.day] ?? []
    if (profile.length !== expected.length || expected.some((slot, index) => profile[index]?.start !== slot.start || profile[index]?.end !== slot.end)) issues.push({ path: `coverage.${day.day}`, message: "La couverture doit couvrir toute la période d’ouverture du secteur." })
    if (profile.some((slot) => !Number.isInteger(slot.employees) || slot.employees < 0 || (slot.employees === 0 && !slot.explicitZero))) issues.push({ path: `coverage.${day.day}`, message: "Chaque besoin doit être un entier positif, ou zéro explicitement confirmé." })
  }
  const total = WEEK_DAYS.reduce((sum, day) => sum + (sector.weeklyDistribution[day] ?? 0), 0)
  if (total !== 100) issues.push({ path: "weeklyDistribution", message: `La répartition doit totaliser exactement 100 % (actuellement ${total} %).` })
  if (WEEK_DAYS.some((day) => !Number.isFinite(sector.weeklyDistribution[day]) || sector.weeklyDistribution[day] < 0)) issues.push({ path: "weeklyDistribution", message: "Les pourcentages ne peuvent pas être négatifs." })
  const minimum = effectiveMinimumShiftDuration(sector, store)
  if (!minimum || minimum <= 0 || minimum % 15 !== 0) issues.push({ path: "shiftRules.minimumShiftDuration", message: "La durée minimale d’un shift est obligatoire et doit respecter un pas de 15 minutes." })
  if (sector.shiftRules.maximumDailyDuration <= 0 || sector.shiftRules.maximumDailyDuration % 15 !== 0) issues.push({ path: "shiftRules.maximumDailyDuration", message: "La durée quotidienne maximale doit être positive et respecter un pas de 15 minutes." })
  if (minimum && sector.shiftRules.maximumDailyDuration < minimum) issues.push({ path: "shiftRules.maximumDailyDuration", message: "La durée quotidienne maximale doit être supérieure à la durée minimale d’un shift." })
  if (sector.shiftRules.splitShiftAllowed && (!sector.shiftRules.maximumSplitDuration || sector.shiftRules.maximumSplitDuration <= 0 || sector.shiftRules.maximumSplitDuration % 15 !== 0)) issues.push({ path: "shiftRules.maximumSplitDuration", message: "La coupure maximale doit être positive et respecter un pas de 15 minutes." })
  return issues
}

export function isSectorDemandReady(sector: SectorDemandConfiguration, store: StoreConfig | null, employees: readonly { status: string; sectors?: readonly string[] }[]) {
  return sector.status !== "active" || (validateSectorDemand(sector, store).length === 0 && employees.some((employee) => employee.status === "active" && employee.sectors?.includes(sector.name)))
}
