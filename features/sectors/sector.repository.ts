import { createEmptySector, type SectorDemandConfiguration } from "@/features/sectors/sector-demand"
const KEY = "shiftos_first_run_setup"
export interface SectorRepository {
  list(): Promise<SectorDemandConfiguration[]>
  save(sectors: readonly SectorDemandConfiguration[]): Promise<void>
}
function migrate(item: unknown): SectorDemandConfiguration | null {
  if (!item || typeof item !== "object") return null
  const raw = item as Record<string, unknown>
  if (typeof raw.id !== "string" || typeof raw.name !== "string") return null
  const base = createEmptySector(raw.id)
  if (Array.isArray(raw.hours)) {
    const sector = raw as unknown as SectorDemandConfiguration
    return {
      ...base,
      ...sector,
      // Group membership is opt-in. In particular, never infer it from a name:
      // that could pull a historical Drive into a multi-sector run after a
      // rename or a migration.
      marketZone: raw.marketZone === true,
      percentageOptionsVersion: 1,
      // Historical Drive sectors predate this Sprint 3D flag. Preserve their
      // previous mandatory-workday behaviour with an explicit migration.
      workEveryNonFixedRestDay: typeof raw.workEveryNonFixedRestDay === "boolean" ? raw.workEveryNonFixedRestDay : true,
      // Version 1 introduces the percentage controls as OPTIONAL and off. An
      // older sector may carry `hourlyPercentagesEnabled: true` only because a
      // short-lived migration default injected it; without the marker that is
      // not a manager's explicit choice, so it is reset once here.
      hourlyPercentagesEnabled:
        raw.percentageOptionsVersion === 1 && typeof raw.hourlyPercentagesEnabled === "boolean"
          ? raw.hourlyPercentagesEnabled
          : false,
      weeklyDistributionEnabled:
        typeof raw.weeklyDistributionEnabled === "boolean" ? raw.weeklyDistributionEnabled : true,
      // Spread the defaults FIRST so a sector saved before the « Contraintes
      // avancées » block gains every new rule at its current business value
      // rather than `undefined`, which the builder would read as "not enforced".
      shiftRules: { ...base.shiftRules, ...sector.shiftRules },
      // Absent means the sector declared none — an empty list, never a floor of
      // zero, and never the defaults of some other sector.
      minimumPresence: Array.isArray(raw.minimumPresence) ? sector.minimumPresence : base.minimumPresence,
      closingFairness: { ...base.closingFairness, ...(raw.closingFairness as object | undefined) },
    }
  }
  const skills = Array.isArray(raw.requiredSkills) ? raw.requiredSkills.filter((value): value is string => typeof value === "string") : []
  return { ...base, name: raw.name, competencies: skills.map((name, order) => ({ id: `competency_${raw.id}_${order}`, name, order, archived: false })) }
}
export function createSectorRepository(storage: Pick<Storage, "getItem" | "setItem">): SectorRepository {
  return { async list() { try { const parsed: unknown = JSON.parse(storage.getItem(KEY) ?? "[]"); return Array.isArray(parsed) ? parsed.flatMap((item) => { const sector = migrate(item); return sector ? [sector] : [] }) : [] } catch { return [] } }, async save(sectors) { storage.setItem(KEY, JSON.stringify(sectors)) } }
}
export const activeCompetencyNames = (sector: SectorDemandConfiguration) => sector.competencies.filter((item) => !item.archived).sort((a, b) => a.order - b.order).map((item) => item.name)
