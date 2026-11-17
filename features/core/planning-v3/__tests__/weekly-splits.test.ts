import { describe, expect, it } from "vitest"

import {
  buildDriveCanonicalProblem,
  driveCanonicalReferenceSolution,
} from "@/features/core/planning-v3/__tests__/drive-canonical"
import { buildPlanningProblemV3 } from "@/features/core/planning-v3/problem-builder"
import type { PlanningProblemV3 } from "@/features/core/planning-v3/types/problem"
import { fingerprintProblem, validatePlanningSolutionV3 } from "@/features/core/planning-v3/validator"
import {
  SMALL_SECTOR_SCOPE,
  smallSector,
  smallSectorEmployees,
  storeConfig,
} from "@/features/planning/__tests__/planning-fixtures"
import { preparePlanningGeneration } from "@/features/planning/flow/planning-flow"
import {
  createEmptySector,
  validateSectorDemand,
  type SectorDemandConfiguration,
} from "@/features/sectors/sector-demand"

/**
 * La limite de coupures par SEMAINE, du rayon enregistré au validateur.
 *
 * Demandée le 17/11/2026 : un salarié du Drive avait trois journées coupées
 * dans la semaine, chacune conforme à la seule limite qui existait — celle du
 * jour. Elle est DURE : le moteur la tient (voir `test_weekly_splits.py`), et
 * le validateur refuse un planning qui la dépasse — c'est lui qui protège ce
 * qui touche au planning après le moteur, l'échange des fermetures compris.
 */

function throughTheApplication(sector: SectorDemandConfiguration): PlanningProblemV3 {
  const prepared = preparePlanningGeneration({
    savedPlannings: [],
    absences: [],
    paidLeaveCampaigns: [],
    store: storeConfig(),
    employees: smallSectorEmployees(),
    sectors: [sector],
    scope: SMALL_SECTOR_SCOPE,
  })
  if (prepared.status === "error") throw new Error(prepared.errors.map((error) => error.message).join(" | "))
  const built = buildPlanningProblemV3(prepared.generationInput)
  if (!built.ok) throw new Error(built.errors.map((error) => error.message).join(" | "))
  return built.problem
}

function withSplits(sector: SectorDemandConfiguration, maximumSplitsPerWeek: number | null): SectorDemandConfiguration {
  return {
    ...sector,
    shiftRules: { ...sector.shiftRules, splitShiftAllowed: true, maximumSplitsPerWeek },
  }
}

describe("la limite de coupures par semaine — du rayon au problème", () => {
  it("arrive au moteur quand le rayon en déclare une", () => {
    const problem = throughTheApplication(withSplits(smallSector(), 1))
    expect(problem.rules.maximumSplitsPerWeek).toBe(1)
  })

  it("ne pose RIEN sans limite : le problème garde son identité", () => {
    // Un rayon enregistré avant le réglage ne doit pas changer d'empreinte, ni
    // donc de planning — c'est la production qu'on protège.
    const without = throughTheApplication(withSplits(smallSector(), null))
    expect("maximumSplitsPerWeek" in without.rules).toBe(false)
    const legacy = smallSector()
    expect(fingerprintProblem(throughTheApplication(legacy))).toBe(
      fingerprintProblem(throughTheApplication({ ...legacy, shiftRules: { ...legacy.shiftRules, maximumSplitsPerWeek: null } }))
    )
  })

  it("ne dit rien quand le rayon interdit les coupures", () => {
    const sector = withSplits(smallSector(), 2)
    const problem = throughTheApplication({
      ...sector,
      shiftRules: { ...sector.shiftRules, splitShiftAllowed: false },
    })
    expect("maximumSplitsPerWeek" in problem.rules).toBe(false)
  })

  it("vaut vide sur un rayon neuf", () => {
    expect(createEmptySector().shiftRules.maximumSplitsPerWeek).toBeNull()
  })

  it("refuse zéro ou une valeur non entière", () => {
    for (const value of [0, 1.5]) {
      const issues = validateSectorDemand(withSplits(createEmptySector(), value), null)
      expect(issues.map((issue) => issue.path)).toContain("shiftRules.maximumSplitsPerWeek")
    }
    expect(
      validateSectorDemand(withSplits(createEmptySector(), 2), null).map((issue) => issue.path)
    ).not.toContain("shiftRules.maximumSplitsPerWeek")
  })
})

describe("la limite de coupures par semaine — le validateur", () => {
  const base = buildDriveCanonicalProblem()
  const solution = driveCanonicalReferenceSolution(base)
  const splits = solution.assignments.filter((assignment) => assignment.segments.length > 1).length

  it("laisse passer un planning sous la limite", () => {
    // Précondition : le planning de référence coupe bien quelque part.
    expect(splits).toBeGreaterThan(0)
    const report = validatePlanningSolutionV3(
      { ...base, rules: { ...base.rules, maximumSplitsPerWeek: splits } },
      solution
    )
    expect(report.violations.filter((violation) => violation.message.includes("par semaine"))).toEqual([])
  })

  it("refuse un planning au-delà, en le disant", () => {
    const report = validatePlanningSolutionV3(
      { ...base, rules: { ...base.rules, maximumSplitsPerWeek: splits - 1 } },
      solution
    )
    const weekly = report.violations.filter((violation) => violation.message.includes("par semaine"))
    expect(weekly).toHaveLength(1)
    expect(weekly[0].severity).toBe("blocking")
    expect(report.validHardConstraints).toBe(false)
  })
})
