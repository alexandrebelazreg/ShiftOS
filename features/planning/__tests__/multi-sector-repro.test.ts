import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { WEEK_DAYS, type WeekDay } from "@/features/core/models"
import { buildHourlyProfile, createEmptySector } from "@/features/sectors"
import type { SectorDemandConfiguration } from "@/features/sectors"
import type { EmployeeRecord } from "@/features/employees/types/employee.types"
import { evaluateSetupReadiness } from "@/features/onboarding/setup-readiness"
import { buildPlanningProblemV3 } from "@/features/core/planning-v3/problem-builder"

import { preparePlanningGeneration, runPlanningFlow } from "@/features/planning/flow"
import { employee, storeConfig } from "@/features/planning/__tests__/planning-fixtures"

/**
 * REPRODUCTION — what a third sector actually does to generation.
 *
 * Written before any fix, and kept afterwards. Each case walks the same four
 * stages a click on "Générer" walks, and records where it stops:
 *
 *   1. readiness      — is the button even enabled
 *   2. preparation    — store + sectors + employees assembled
 *   3. V2 generation  — the business pipeline
 *   4. V3 problem     — the problem builder, before any solver
 *
 * The point is to locate the failure, not to assume it. Both engines are asked
 * the same question about the same configuration.
 */

const OPEN: readonly WeekDay[] = ["monday", "tuesday", "wednesday", "thursday", "friday"]
const SCOPE = {
  planningId: "planning_repro",
  period: { start: "2026-07-06", end: "2026-07-12" },
  now: "2026-07-01T00:00:00.000Z",
}

/** A fully configured sector: hours, coverage, budget, and a settled history. */
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
const MARCHE = completeSector("marche", "Zone Marché")
const ACCUEIL = completeSector("accueil", "Accueil")

const STAFF = [
  staff("d1", "Drive"),
  staff("d2", "Drive"),
  staff("m1", "Zone Marché"),
  staff("m2", "Zone Marché"),
  staff("a1", "Accueil"),
  staff("a2", "Accueil"),
]

interface StageReport {
  readonly readiness: "ok" | string
  readonly preparation: "ok" | string
  readonly v2: "ok" | string
  readonly v3: "ok" | string
}

/** Walk the four stages for one selection and report exactly where it stops. */
function walk(
  sectors: readonly SectorDemandConfiguration[],
  employees: readonly EmployeeRecord[] = STAFF
): StageReport {
  const store = storeConfig()

  const readiness = evaluateSetupReadiness({ store, employees, sectors })
  const readinessReport = readiness.ready ? "ok" : readiness.blockers.join(" | ")

  const prepared = preparePlanningGeneration({ store, employees, sectors, scope: SCOPE })
  if (prepared.status !== "ready") {
    const message = prepared.errors.map((error) => error.code).join(", ")
    return { readiness: readinessReport, preparation: message, v2: "non atteint", v3: "non atteint" }
  }

  const v2 = runPlanningFlow({ store, employees, sectors, scope: SCOPE })
  const v2Report =
    v2.status !== "success"
      ? v2.errors.map((error) => error.code).join(", ")
      : v2.generation.status === "blocked"
        ? v2.generation.issues
            .filter((issue) => issue.severity === "blocking")
            .map((issue) => issue.code)
            .join(", ")
        : "ok"

  const built = buildPlanningProblemV3(prepared.generationInput)
  const v3Report = built.ok ? "ok" : built.errors.map((error) => error.code).join(", ")

  return { readiness: readinessReport, preparation: "ok", v2: v2Report, v3: v3Report }
}

describe("REPRO — un seul secteur complet passe partout", () => {
  it.each([
    ["Drive seul", [DRIVE], [staff("d1", "Drive"), staff("d2", "Drive")]],
    ["Zone Marché seul", [MARCHE], [staff("m1", "Zone Marché"), staff("m2", "Zone Marché")]],
    ["Accueil seul", [ACCUEIL], [staff("a1", "Accueil"), staff("a2", "Accueil")]],
  ] as const)("%s : les quatre étapes aboutissent", (_label, sectors, people) => {
    // Only that sector's staff: an employee belonging to no ACTIVE sector still
    // has a contract to honour and no demand to honour it against, which is a
    // separate defect (see below) and would mask the one under test here.
    const report = walk([...sectors], [...people])
    expect(report.readiness).toBe("ok")
    expect(report.preparation).toBe("ok")
    expect(report.v2).toBe("ok")
    expect(report.v3).toBe("ok")
  })
})

describe("REPRO — plusieurs secteurs actifs bloquent LES DEUX moteurs", () => {
  it("Drive + Zone Marché échoue déjà, avant même Accueil", () => {
    // The decisive observation: the third sector is not what broke this. TWO
    // active sectors already do, and they do it identically in both engines.
    const report = walk([DRIVE, MARCHE])

    expect(report.readiness).toBe("ok")
    expect(report.preparation).toBe("ok")
    expect(report.v2).toBe("weekly_allocation_requires_single_sector")
    expect(report.v3).toBe("multiple_active_sectors")
  })

  it("les trois secteurs échouent de la même façon", () => {
    const report = walk([DRIVE, MARCHE, ACCUEIL])
    expect(report.v2).toBe("weekly_allocation_requires_single_sector")
    expect(report.v3).toBe("multiple_active_sectors")
  })

  it("échoue APRÈS la préparation, jamais dans le solveur", () => {
    // Both engines refuse while reading their input. No search runs, so nothing
    // here is a statement about whether the week could be staffed.
    const report = walk([DRIVE, MARCHE, ACCUEIL])
    expect(report.preparation).toBe("ok")
    expect(report.v3).not.toContain("infeasible")
  })
})

describe("le planning affiché survit à un refus", () => {
  const VIEW = readFileSync(
    join(process.cwd(), "features", "planning", "view", "PlanningView.tsx"),
    "utf8"
  )

  it("n'appelle aucun moteur quand la configuration des secteurs est fautive", () => {
    // Diagnosed once, before the engine choice: the manager gets the same
    // sentence whichever engine is selected.
    const dispatch = VIEW.slice(
      VIEW.indexOf("function handleGenerate(regeneration"),
      VIEW.indexOf("async function handleGenerateV3")
    )
    expect(dispatch).toContain("resolveGenerationScope(")
    const refusal = dispatch.slice(
      dispatch.indexOf('if (verdict.kind === "refused")'),
      dispatch.indexOf("setScopeRefusal(null)")
    )
    expect(refusal).not.toContain("setEditorState")
    expect(refusal).not.toContain("handleGenerateV2(")
    expect(refusal).not.toContain("handleGenerateV3(")
  })

  it("ne remplace pas le planning courant par une génération V2 refusée", () => {
    // The regression this whole report is about: a blocked run used to install
    // its unusable schedule over a working one, and say nothing.
    const body = VIEW.slice(
      VIEW.indexOf("function handleGenerateV2"),
      VIEW.indexOf("TEMPORARY, and deliberately so")
    )
    expect(body).toContain("blocking.length === 0")
    expect(body).toContain("setV2Blocking(blocking)")

    const install = body.slice(
      body.indexOf('if (result.status === "success" && blocking.length === 0)'),
      body.indexOf("Failed or refused")
    )
    expect(install).toContain("setEditorState")
    // The only path that installs a schedule is the one guarded by "no blocking
    // issue"; everything after it leaves the screen alone.
    const after = body.slice(body.indexOf("Failed or refused"))
    expect(after).not.toContain("setEditorState")
    expect(after).not.toContain("setRecord")
  })

  it("affiche les blocages V2 au lieu de les filtrer", () => {
    expect(VIEW).toContain("Le moteur V2 a refusé de générer")
    expect(VIEW).toContain("v2Blocking.map")
  })
})

describe("REPRO — un secteur incomplet bloque l'écran entier", () => {
  it("désactive la génération pour TOUS les secteurs, pas seulement le sien", () => {
    // The second mechanism, independent of the first: readiness is a single
    // boolean over every active sector, so one incomplete sector disables the
    // button for the complete ones too.
    const incomplete = { ...completeSector("accueil", "Accueil"), coverage: { standardDay: null, profiles: {} } }
    const report = walk([DRIVE, incomplete])

    expect(report.readiness).not.toBe("ok")
    expect(report.readiness).toContain("Accueil")
  })

  it("bloque aussi quand aucun salarié n'est affecté au secteur", () => {
    const report = walk([DRIVE, ACCUEIL], [staff("d1", "Drive"), staff("d2", "Drive")])
    expect(report.readiness).not.toBe("ok")
    expect(report.readiness).toContain("Accueil")
  })
})
