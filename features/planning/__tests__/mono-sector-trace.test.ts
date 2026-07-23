import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { WEEK_DAYS, type WeekDay } from "@/features/core/models"
import { buildHourlyProfile, createEmptySector } from "@/features/sectors"
import type { SectorDemandConfiguration } from "@/features/sectors"
import type { EmployeeRecord } from "@/features/employees/types/employee.types"
import { evaluateSetupReadiness } from "@/features/onboarding"
import { buildPlanningProblemV3 } from "@/features/core/planning-v3/problem-builder"

import {
  preparePlanningGeneration,
  resolveGenerationScope,
  runPlanningFlow,
  selectableSectors,
} from "@/features/planning/flow"
import { employee, storeConfig } from "@/features/planning/__tests__/planning-fixtures"

/**
 * TRACE — the nine stages a click on "Générer" goes through, per engine.
 *
 * The mono-sector case is the one that must never be in doubt: one active
 * sector, selected, complete. Everything else in this file exists to prove that
 * an UNSELECTED sector — however broken — cannot reach any of these stages.
 */

const OPEN: readonly WeekDay[] = ["monday", "tuesday", "wednesday", "thursday", "friday"]
const SCOPE = {
  planningId: "planning_trace",
  period: { start: "2026-07-06", end: "2026-07-12" },
  now: "2026-07-01T00:00:00.000Z",
}
const STORE = storeConfig()

function completeSector(id: string, name: string): SectorDemandConfiguration {
  const base = createEmptySector(id)
  return {
    ...base,
    name,
    status: "active",
    workEveryNonFixedRestDay: false,
    hours: WEEK_DAYS.map((day) =>
      OPEN.includes(day)
        ? { day, closed: false, opensAt: "09:00", closesAt: "17:00" }
        : { day, closed: true, opensAt: "09:00", closesAt: "17:00" }
    ),
    weeklyDistribution: Object.fromEntries(
      WEEK_DAYS.map((day) => [day, OPEN.includes(day) ? 20 : 0])
    ) as Record<WeekDay, number>,
    coverage: {
      standardDay: "monday",
      profiles: Object.fromEntries(OPEN.map((day) => [day, buildHourlyProfile("09:00", "17:00", 1)])),
    },
    shiftRules: {
      ...base.shiftRules,
      inheritMinimumShiftDuration: false,
      minimumShiftDuration: 240,
      maximumDailyDuration: 480,
      splitShiftAllowed: false,
    },
  }
}

function staff(id: string, sector: string): EmployeeRecord {
  return employee(id, {
    weeklyHours: 20,
    weeklyMinutes: 1_200,
    sectors: [sector],
    workingDays: [...OPEN],
  } as Partial<EmployeeRecord>)
}

const DRIVE = completeSector("drive", "Drive")
const ACCUEIL = completeSector("accueil", "Accueil")
const BROKEN_ACCUEIL: SectorDemandConfiguration = {
  ...ACCUEIL,
  coverage: { standardDay: null, profiles: {} },
}

/** Every stage, recorded. This is the trace the report is built from. */
interface Trace {
  readonly selectedSectorIds: readonly string[]
  readonly pickable: readonly string[]
  readonly scopeSectors: readonly string[]
  readonly scopeEmployees: readonly string[]
  readonly readiness: string
  readonly diagnostics: readonly string[]
  readonly preparation: string
  readonly engineCalled: boolean
  readonly error: string
  readonly stoppedAt: string
}

function trace(
  sectors: readonly SectorDemandConfiguration[],
  employees: readonly EmployeeRecord[],
  selectedSectorIds: readonly string[],
  engine: "v2" | "v3"
): Trace {
  const pickable = selectableSectors(sectors)
  const verdict = resolveGenerationScope({ store: STORE, sectors, employees, selectedSectorIds })

  if (verdict.kind === "refused") {
    return {
      selectedSectorIds,
      pickable: pickable.map((sector) => sector.id),
      scopeSectors: [],
      scopeEmployees: [],
      // Readiness is measured on the SELECTION, exactly as the screen does.
      readiness: readinessOf(sectors, employees, selectedSectorIds),
      diagnostics: verdict.details.map((problem) => problem.code),
      preparation: "non atteinte",
      engineCalled: false,
      error: `${verdict.code} — ${verdict.message}`,
      stoppedAt: "resolveGenerationScope",
    }
  }

  const scope = verdict.scope
  const prepared = preparePlanningGeneration({
    store: STORE,
    employees: scope.employees,
    sectors: scope.sectors,
    scope: SCOPE,
  })
  if (prepared.status !== "ready") {
    return {
      selectedSectorIds,
      pickable: pickable.map((sector) => sector.id),
      scopeSectors: scope.sectorIds,
      scopeEmployees: scope.employees.map((person) => person.id),
      readiness: readinessOf(sectors, employees, selectedSectorIds),
      diagnostics: [],
      preparation: prepared.errors.map((error) => error.code).join(", "),
      engineCalled: false,
      error: prepared.errors.map((error) => error.message).join(" | "),
      stoppedAt: "preparePlanningGeneration",
    }
  }

  const base = {
    selectedSectorIds,
    pickable: pickable.map((sector) => sector.id),
    scopeSectors: scope.sectorIds,
    scopeEmployees: scope.employees.map((person) => person.id),
    readiness: readinessOf(sectors, employees, selectedSectorIds),
    diagnostics: [] as readonly string[],
    preparation: "ok",
    engineCalled: true,
  }

  if (engine === "v2") {
    const result = runPlanningFlow({
      store: STORE,
      employees: scope.employees,
      sectors: scope.sectors,
      scope: SCOPE,
    })
    const blocking =
      result.status === "success"
        ? result.generation.issues.filter((issue) => issue.severity === "blocking")
        : []
    return {
      ...base,
      error:
        result.status !== "success"
          ? result.errors.map((error) => error.code).join(", ")
          : blocking.map((issue) => issue.code).join(", "),
      stoppedAt:
        result.status !== "success" ? "runPlanningFlow" : blocking.length > 0 ? "business-pipeline" : "aboutit",
    }
  }

  const built = buildPlanningProblemV3(prepared.generationInput)
  return {
    ...base,
    error: built.ok ? "" : built.errors.map((error) => error.code).join(", "),
    stoppedAt: built.ok ? "aboutit" : "buildPlanningProblemV3",
  }
}

function readinessOf(
  sectors: readonly SectorDemandConfiguration[],
  employees: readonly EmployeeRecord[],
  selectedSectorIds: readonly string[]
): string {
  const scoped = selectableSectors(sectors).filter((sector) => selectedSectorIds.includes(sector.id))
  const readiness = evaluateSetupReadiness({ store: STORE, employees, sectors: scoped })
  return readiness.ready ? "ok" : readiness.blockers.join(" | ")
}

describe("TRACE — un seul secteur actif et sélectionné", () => {
  it.each(["v2", "v3"] as const)("Drive seul, moteur %s : le flux va jusqu'au bout", (engine) => {
    const report = trace([DRIVE], [staff("d1", "Drive"), staff("d2", "Drive")], ["drive"], engine)

    expect(report.selectedSectorIds).toEqual(["drive"])
    expect(report.pickable).toEqual(["drive"])
    expect(report.scopeSectors).toEqual(["drive"])
    expect(report.scopeEmployees).toEqual(["d1", "d2"])
    expect(report.readiness).toBe("ok")
    expect(report.diagnostics).toEqual([])
    expect(report.preparation).toBe("ok")
    expect(report.engineCalled).toBe(true)
    expect(report.error).toBe("")
    expect(report.stoppedAt).toBe("aboutit")
  })

  it.each(["v2", "v3"] as const)("Accueil seul, moteur %s : le flux va jusqu'au bout", (engine) => {
    const report = trace([ACCUEIL], [staff("a1", "Accueil"), staff("a2", "Accueil")], ["accueil"], engine)
    expect(report.stoppedAt).toBe("aboutit")
    expect(report.scopeSectors).toEqual(["accueil"])
  })
})

describe("TRACE — un secteur non sélectionné ne bloque plus rien", () => {
  const PEOPLE = [staff("d1", "Drive"), staff("d2", "Drive"), staff("a1", "Accueil")]

  it.each(["v2", "v3"] as const)(
    "Drive + Accueil actifs, Drive seul sélectionné, moteur %s",
    (engine) => {
      const report = trace([DRIVE, ACCUEIL], PEOPLE, ["drive"], engine)

      // Only Drive travels, and only Drive's people travel with it.
      expect(report.pickable).toEqual(["drive", "accueil"])
      expect(report.scopeSectors).toEqual(["drive"])
      expect(report.scopeEmployees).toEqual(["d1", "d2"])
      expect(report.engineCalled).toBe(true)
      expect(report.stoppedAt).toBe("aboutit")
    }
  )

  it.each(["v2", "v3"] as const)(
    "Accueil incomplet mais NON sélectionné n'empêche pas Drive, moteur %s",
    (engine) => {
      const report = trace([DRIVE, BROKEN_ACCUEIL], PEOPLE, ["drive"], engine)

      expect(report.readiness).toBe("ok")
      expect(report.diagnostics).toEqual([])
      expect(report.stoppedAt).toBe("aboutit")
      expect(report.error).toBe("")
    }
  )

  it("écarte les salariés qui n'appartiennent qu'aux secteurs non sélectionnés", () => {
    // Left in, they would have a contract to honour and no demand to honour it
    // against — which V2 reports as `contract_inexact` and which reads as
    // "Drive is broken" when nothing about Drive is.
    const report = trace([DRIVE, ACCUEIL], PEOPLE, ["drive"], "v2")
    expect(report.scopeEmployees).not.toContain("a1")
  })
})

describe("TRACE — refus honnêtes", () => {
  it("Accueil incomplet ET sélectionné : diagnostic précis, aucun moteur", () => {
    const report = trace([DRIVE, BROKEN_ACCUEIL], [staff("a1", "Accueil")], ["accueil"], "v2")

    expect(report.engineCalled).toBe(false)
    expect(report.stoppedAt).toBe("resolveGenerationScope")
    expect(report.diagnostics).toContain("missing_demand")
    expect(report.error).toContain("sector-configuration")
  })

  it.each(["v2", "v3"] as const)("deux secteurs sélectionnés : aucun moteur, moteur %s", (engine) => {
    const report = trace([DRIVE, ACCUEIL], [staff("d1", "Drive"), staff("a1", "Accueil")], ["drive", "accueil"], engine)

    expect(report.engineCalled).toBe(false)
    expect(report.error).toContain("multiple-sectors")
    expect(report.error).toContain("n’est pas encore disponible")
    // No longer asks anyone to change their configuration.
    expect(report.error).not.toContain("actif")
  })

  it("aucun secteur sélectionné : aucun moteur, jamais « tous »", () => {
    const report = trace([DRIVE, ACCUEIL], [staff("d1", "Drive")], [], "v2")

    expect(report.engineCalled).toBe(false)
    expect(report.error).toContain("no-selection")
    expect(report.error).toContain("Sélectionnez au moins un secteur")
    expect(report.scopeSectors).toEqual([])
  })

  it("revenir à un seul secteur après une sélection multiple redevient générable", () => {
    const people = [staff("d1", "Drive"), staff("d2", "Drive"), staff("a1", "Accueil")]
    expect(trace([DRIVE, ACCUEIL], people, ["drive", "accueil"], "v2").engineCalled).toBe(false)
    expect(trace([DRIVE, ACCUEIL], people, ["drive"], "v2").stoppedAt).toBe("aboutit")
  })

  it("aucune erreur de sélection ou de configuration ne devient une infaisabilité", () => {
    for (const selected of [[], ["drive", "accueil"], ["accueil"]]) {
      const report = trace([DRIVE, BROKEN_ACCUEIL], [staff("a1", "Accueil")], selected, "v3")
      expect(report.error).not.toContain("infeasible")
    }
  })
})

describe("la sélection est une source de vérité unique", () => {
  const VIEW = readFileSync(
    join(process.cwd(), "features", "planning", "view", "PlanningView.tsx"),
    "utf8"
  )
  const BOARD = readFileSync(
    join(process.cwd(), "features", "planning", "board", "ui", "PlanningBoard.tsx"),
    "utf8"
  )

  it("une sélection vide transitoire n'écrase pas la sélection initiale", () => {
    // `null` means "not initialised yet"; `[]` means "the manager chose none".
    // Collapsing the two would re-widen the selection on every render while the
    // sector repository is still loading.
    expect(VIEW).toContain("useState<readonly string[] | null>(null)")
    expect(VIEW).toContain("selectedSectorIds ?? pickableSectors.map((sector) => sector.id)")
  })

  it("le tableau ne détient aucune sélection de secteurs concurrente", () => {
    // One state, one owner. Two would let the grid show Drive while the engine
    // received Drive plus everything else.
    expect(BOARD).toContain("readonly sectorIds: readonly string[]")
    expect(BOARD).not.toContain("sectorIds: input.sectors.map")
    expect(BOARD).toContain('Omit<PlanningBoardSelection, "sectorIds">')
  })

  it("le multiselect ne renvoie [] que sur une action explicite", () => {
    expect(VIEW).toContain("setSelectedSectorIds(selectAll ? pickableSectors.map((sector) => sector.id) : [])")
  })

  it("la génération ne relit jamais tous les secteurs actifs", () => {
    const dispatch = VIEW.slice(
      VIEW.indexOf("function handleGenerate(regeneration"),
      VIEW.indexOf("async function handleGenerateV3")
    )
    expect(dispatch).toContain("selectedSectorIds: selection")
    // Both engines receive the resolved scope, never `setup.sectors`.
    for (const path of ["handleGenerateV2", "handleGenerateV3"]) {
      const body = VIEW.slice(VIEW.indexOf(`function ${path}(`), VIEW.indexOf(`function ${path}(`) + 1400)
      expect(body).toContain("generationScope.sectors")
      expect(body).toContain("generationScope.employees")
      expect(body).not.toContain("sectors: setup.sectors")
    }
  })

  it("le bouton Générer n'est plus désactivé par les autres secteurs", () => {
    // `setup.ready` folds every active sector into one boolean; it killed the
    // button for a perfectly configured selection.
    expect(VIEW).toContain("disabled={!initialStore || setup.isLoading || isLoading || busyGenerating}")
    expect(VIEW).toContain("selectionReadiness")
  })

  it("V2 n'est bloqué par aucune condition ajoutée pour V3", () => {
    const body = VIEW.slice(
      VIEW.indexOf("function handleGenerateV2("),
      VIEW.indexOf("TEMPORARY, and deliberately so")
    )
    expect(body).not.toContain("setup.ready")
    expect(body).not.toContain("v3")
  })
})
