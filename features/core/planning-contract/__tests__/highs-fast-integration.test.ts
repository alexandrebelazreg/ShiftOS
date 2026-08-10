import { existsSync } from "node:fs"
import { describe, expect, it } from "vitest"

import {
  createHighsFastAdapter,
  resolveHighsFastPython,
} from "@/features/core/planning-contract/adapters/highs-fast"
import { buildAccueilCanonicalProblem } from "@/features/core/planning-v3/__tests__/accueil-canonical"
import { buildDriveCanonicalProblem } from "@/features/core/planning-v3/__tests__/drive-canonical"
import { buildMarketZoneCanonicalProblem } from "@/features/core/planning-v3/__tests__/market-zone-canonical"
import { validatePlanningSolutionV3 } from "@/features/core/planning-v3/validator"
import type { SolvePlanningRequest } from "@/features/core/planning-contract/types/solve-request"

/**
 * The whole path, end to end: adapter → subprocess → HiGHS → validator.
 *
 * The sibling file fakes the runner and proves the adapter handles every way a
 * subprocess can fail. This one proves the thing a fake cannot: that the REAL
 * script answers in the protocol the adapter expects, spawned by the
 * interpreter the adapter picks on its own.
 *
 * That last clause is the point. The adapter is deliberately given no
 * `pythonExecutable` here, because the first wiring of this engine passed that
 * check with an explicit interpreter and still failed in the application — it
 * inherited CP-SAT's default, spawned whatever `python` was on `PATH`, and came
 * back with `No module named 'scipy'`. A test that hands the adapter the answer
 * cannot catch that, so this one does not.
 *
 * SKIPPED when the experiment's virtual environment is absent, so a clone that
 * has never installed scipy stays green:
 *
 *     python -m venv .venv-planning-highs
 *     .venv-planning-highs/Scripts/pip install -r experiments/planning-v3-highs/requirements.txt
 */

const python = resolveHighsFastPython()
const available = python !== "python" && existsSync(python)

function request(problem: ReturnType<typeof buildAccueilCanonicalProblem>): SolvePlanningRequest {
  return { problem }
}

describe("v3-highs-fast — bout en bout, vrai sous-processus", () => {
  it.skipIf(!available)("choisit un interpréteur qui porte ses propres dépendances", () => {
    // CP-SAT and HiGHS have incompatible dependency sets and live in separate
    // virtual environments. An adapter that resolves to the other engine's
    // interpreter reports a missing module in front of a manager.
    expect(python).not.toBe("python")
    expect(python).toContain("planning-highs")
  })

  it.skipIf(!available)(
    "résout Accueil sans qu'on lui indique où trouver Python",
    async () => {
      const problem = buildAccueilCanonicalProblem()
      const response = await createHighsFastAdapter({ timeoutSeconds: 60 })(request(problem))

      expect(response.metadata.engine).toBe("highs-fast")
      // Le point non négociable : pas de panne de transport. Le moteur a
      // réellement tourné.
      expect(response.outcome).not.toBe("backend-error")
      expect(response.solution).not.toBeNull()
      expect(response.solution!.assignments.length).toBeGreaterThan(0)
    },
    180_000
  )

  it.skipIf(!available)(
    "rend un planning que le validateur officiel accepte",
    async () => {
      const problem = buildDriveCanonicalProblem()
      const response = await createHighsFastAdapter({ timeoutSeconds: 60 })(request(problem))

      expect(response.outcome).not.toBe("backend-error")
      // Une réponse Python n'est jamais acceptée sur sa propre parole : le
      // contrat n'expose une solution que si le validateur TypeScript l'a
      // acceptée, donc sa présence EST le verdict du validateur.
      expect(response.solution).not.toBeNull()
      expect(response.diagnostics.blocking).toBe(false)
    },
    180_000
  )

  it.skipIf(!available)(
    "ne revendique jamais d'optimum, même en atteignant zéro",
    async () => {
      const problem = buildAccueilCanonicalProblem()
      const response = await createHighsFastAdapter({ timeoutSeconds: 60 })(request(problem))
      // Deux choix heuristiques précèdent la seule étape exacte.
      expect(response.outcome).not.toBe("optimal")
    },
    180_000
  )

  it.skipIf(!available)(
    "résout Zone marché en respectant couverture, contrats et priorités secteur",
    async () => {
      const problem = buildMarketZoneCanonicalProblem()
      const response = await createHighsFastAdapter({ timeoutSeconds: 60 })(request(problem))

      expect(response.outcome).not.toBe("backend-error")
      expect(response.solution).not.toBeNull()
      const report = validatePlanningSolutionV3(problem, response.solution!)
      expect(report.validHardConstraints).toBe(true)
      expect(report.underCoveredSlots).toBe(0)
      expect(report.metrics.totalDeficitMinutes).toBe(0)

      const employeeById = new Map(problem.employees.map((person) => [String(person.id), person]))
      const nonPrimaryBlocks = response.solution!.assignments.flatMap((assignment) => {
        const primary = employeeById.get(String(assignment.employeeId))?.allowedSectorIds?.[0]
        return (assignment.sectorAssignments ?? []).flatMap((block) =>
          block.sectorId === primary ? [] : [{ employeeId: String(assignment.employeeId), date: assignment.date, primary, block }]
        )
      })
      expect(nonPrimaryBlocks).toEqual([])
    },
    180_000
  )
})
