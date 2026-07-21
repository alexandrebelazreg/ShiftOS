import { createEmptySector, type SectorDemandConfiguration } from "@/features/sectors/sector-demand"
const KEY = "shiftos_first_run_setup"
export interface SectorRepository { list(): SectorDemandConfiguration[]; save(sectors: readonly SectorDemandConfiguration[]): void }
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
      // Historical Drive sectors predate this Sprint 3D flag. Preserve their
      // previous mandatory-workday behaviour with an explicit migration.
      workEveryNonFixedRestDay: typeof raw.workEveryNonFixedRestDay === "boolean" ? raw.workEveryNonFixedRestDay : true,
      shiftRules: { ...base.shiftRules, ...sector.shiftRules },
    }
  }
  const skills = Array.isArray(raw.requiredSkills) ? raw.requiredSkills.filter((value): value is string => typeof value === "string") : []
  return { ...base, name: raw.name, competencies: skills.map((name, order) => ({ id: `competency_${raw.id}_${order}`, name, order, archived: false })) }
}
export function createSectorRepository(storage: Pick<Storage, "getItem" | "setItem">): SectorRepository {
  return { list() { try { const parsed: unknown = JSON.parse(storage.getItem(KEY) ?? "[]"); return Array.isArray(parsed) ? parsed.flatMap((item) => { const sector = migrate(item); return sector ? [sector] : [] }) : [] } catch { return [] } }, save(sectors) { storage.setItem(KEY, JSON.stringify(sectors)) } }
}
export const activeCompetencyNames = (sector: SectorDemandConfiguration) => sector.competencies.filter((item) => !item.archived).sort((a, b) => a.order - b.order).map((item) => item.name)
