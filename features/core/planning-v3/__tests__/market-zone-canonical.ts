import type { PlanningProblemV3 } from "@/features/core/planning-v3/types/problem"
import { buildPlanningProblemV3 } from "@/features/core/planning-v3/problem-builder"
import { preparePlanningGeneration } from "@/features/planning/flow/planning-flow"
import {
  employee,
  sectorStoreConfig,
  smallSector,
  SMALL_SECTOR_SCOPE,
} from "@/features/planning/__tests__/planning-fixtures"

/**
 * Five real working days, the five simultaneous fresh-market counters and ten
 * shared employees. Each person works 4 h/day; each counter therefore receives
 * one opener and one closer while every 20 h contract remains exact.
 */
export function buildMarketZoneCanonicalProblem(): PlanningProblemV3 {
  const sectors = [
    ["fromage", "Fromage"],
    ["fruits", "Fruits et légumes"],
    ["poisson", "Poisson"],
    ["charcuterie", "Charcuterie"],
    ["boulangerie", "Boulangerie"],
  ].map(([id, name], index) => {
    const base = smallSector()
    return {
      ...base,
      id,
      name,
      marketZone: true,
      // Deliberately heterogeneous, like migrated real counters: a looser cap,
      // a looser rest and a stale split permission must produce the safe common
      // intersection instead of blocking the whole Zone marche generation.
      shiftRules: {
        ...base.shiftRules,
        maximumDailyDuration: index === 0 ? 540 : 480,
        minimumRestMinutes: index === 1 ? 660 : 720,
        splitShiftAllowed: index === 2,
      },
    }
  })
  const employees = sectors.flatMap((sector, index) => {
    const secondary = sectors[(index + 1) % sectors.length]
    return [1, 2].map((number) => employee(`${sector.id}-${number}`, {
      weeklyHours: 20,
      weeklyMinutes: 1_200,
      sectors: [sector.name, secondary.name],
    }))
  })
  const prepared = preparePlanningGeneration({
    // Aucune semaine publiée : ces tests ne portent pas sur l'équité.
    savedPlannings: [],
    store: sectorStoreConfig(),
    employees,
    sectors,
    scope: SMALL_SECTOR_SCOPE,
  })
  if (prepared.status === "error") {
    throw new Error(prepared.errors.map((error) => error.message).join(" | "))
  }
  const built = buildPlanningProblemV3(prepared.generationInput)
  if (!built.ok) throw new Error(built.errors.map((error) => error.message).join(" | "))
  return built.problem
}
