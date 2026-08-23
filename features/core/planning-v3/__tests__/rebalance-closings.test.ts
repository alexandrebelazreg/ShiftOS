import { existsSync } from "node:fs"
import { describe, expect, it } from "vitest"

import { createHighsFastAdapter } from "@/features/core/planning-contract/adapters/highs-fast"
import { resolveHighsFastPython } from "@/features/core/planning-contract/adapters/python/run-python"
import type { SolvePlanningRequest } from "@/features/core/planning-contract/types/solve-request"
import { buildPlanningProblemV3 } from "@/features/core/planning-v3/problem-builder"
import { fingerprintProblem, validatePlanningSolutionV3 } from "@/features/core/planning-v3/validator"
import { rebalanceClosings } from "@/features/core/planning-v3/rebalance-closings"
import { preparePlanningGeneration } from "@/features/planning/flow/planning-flow"
import {
  employee,
  sectorStoreConfig,
  smallSector,
  SMALL_SECTOR_SCOPE,
} from "@/features/planning/__tests__/planning-fixtures"
import { referenceInput, referenceSolution } from "@/features/core/planning-v3/__tests__/reference-scenario"
import type { EmployeeId } from "@/features/core/models"
import type { EmployeeRecord } from "@/features/employees/types/employee.types"
import type { PlanningProblemV3 } from "@/features/core/planning-v3/types/problem"
import type { PlanningSolutionV3 } from "@/features/core/planning-v3/types/solution"

/**
 * Le rééquilibrage des fermetures, et surtout ce qu'il ne doit JAMAIS faire.
 *
 * Il retouche un planning que le solveur a déjà rendu légal. La propriété qui
 * compte est donc négative : **il ne peut pas produire pire que ce qu'il a
 * reçu.** Casser un repos ou un contrat pour gagner quelques pour mille
 * d'équité coûterait bien plus que l'inégalité corrigée — et personne ne
 * soupçonnerait l'étape qui s'exécute après le moteur.
 *
 * Les garanties sont vérifiées sur un cas où le rééquilibrage AGIT VRAIMENT.
 * Une première version les mesurait sur un planning où aucun échange n'était
 * possible : tout passait, et rien n'était prouvé.
 */

function referenceProblem(
  fairness: { balanceClosings: boolean; balanceSaturdayClosings: boolean } | null
): PlanningProblemV3 {
  const input = referenceInput()
  const built = buildPlanningProblemV3({
    ...input,
    business: {
      ...input.business,
      sectors: (input.business?.sectors ?? []).map((sector) => ({
        ...sector,
        closingFairness: fairness === null ? null : { ...fairness, lookbackWeeks: 8 },
      })),
    },
  })
  if (!built.ok) throw new Error(built.errors.map((error) => error.message).join(" | "))
  return built.problem
}

const weeklyMinutes = (solution: PlanningSolutionV3): Record<string, number> => {
  const totals: Record<string, number> = {}
  for (const assignment of solution.assignments) {
    const id = String(assignment.employeeId)
    totals[id] =
      (totals[id] ?? 0) +
      assignment.segments.reduce((sum, segment) => sum + (segment.endMinutes - segment.startMinutes), 0)
  }
  return totals
}

describe("rééquilibrage — ce qu'il ne fait pas", () => {
  it("ne touche à rien quand l'équité est éteinte", () => {
    const problem = referenceProblem({ balanceClosings: false, balanceSaturdayClosings: false })
    const solution = referenceSolution(fingerprintProblem(problem))
    const result = rebalanceClosings(problem, solution)
    // La MÊME solution, à l'identité de l'objet près : c'est ce qui garantit
    // qu'un magasin sans équité réglée retrouve exactement son planning d'avant.
    expect(result.solution).toBe(solution)
    expect(result.swaps).toEqual([])
  })

  it("ne touche à rien quand aucune règle d'équité n'existe", () => {
    const problem = referenceProblem(null)
    const solution = referenceSolution(fingerprintProblem(problem))
    expect(rebalanceClosings(problem, solution).solution).toBe(solution)
  })

  it("ne bâtit rien sur un planning déjà en faute", () => {
    // Une solution invalide se corrige, elle ne s'optimise pas : le gérant a
    // d'abord une violation à lire, et la retoucher masquerait sa cause.
    const problem = referenceProblem({ balanceClosings: true, balanceSaturdayClosings: false })
    const solution = referenceSolution(fingerprintProblem(problem))
    const broken: PlanningSolutionV3 = {
      ...solution,
      assignments: [
        ...solution.assignments,
        {
          employeeId: solution.assignments[0].employeeId,
          date: solution.assignments[0].date,
          segments: [{ startMinutes: 0, endMinutes: 60 }],
        },
      ],
    }
    expect(validatePlanningSolutionV3(problem, broken).validHardConstraints).toBe(false)
    expect(rebalanceClosings(problem, broken).solution).toBe(broken)
  })
})

/**
 * IGNORÉ quand l'environnement Python de l'expérience est absent, pour qu'un
 * clone qui n'a jamais installé scipy reste vert — même règle que les verrous.
 */
const python = resolveHighsFastPython()
const engineAvailable = python !== "python" && existsSync(python)

describe("rééquilibrage — sur un planning où il agit vraiment", () => {
  it.skipIf(!engineAvailable)(
    "fait fermer moins souvent ceux qui ont déjà beaucoup fermé",
    async () => {
      // Mesuré de bout en bout, sur la sortie de l'adaptateur : c'est ce que le
      // gérant reçoit, rééquilibrage compris. Appeler `rebalanceClosings` sur
      // cette sortie ne prouverait rien — elle est DÉJÀ rééquilibrée, et le
      // second appel ne trouverait évidemment plus rien à faire.
      const sector = {
        ...smallSector(),
        closingFairness: { balanceClosings: true, balanceSaturdayClosings: false, lookbackWeeks: 8 },
      }
      const ids = ["a", "b", "c", "d", "e"]
      const heavy = ["a", "b"]
      const team: EmployeeRecord[] = ids.map((id) =>
        employee(id, {
          // Le contrat réel d'un magasin, et le cas qui était cassé : à
          // contrats ÉGAUX, les durées quotidiennes diffèrent quand même d'une
          // personne à l'autre (435 minutes contre 450 le même jour). Aucun
          // échange d'une seule journée ne compense cela — il faut un groupe de
          // jours dont les écarts s'annulent.
          weeklyHours: 36.75,
          weeklyMinutes: 2_205,
          sectors: ["Test"],
          workingDays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
          canClose: true,
          canOpen: true,
          maxClosings: 2,
        } as Partial<EmployeeRecord>)
      )

      const prepared = preparePlanningGeneration({
        store: sectorStoreConfig(),
        employees: team,
        sectors: [sector],
        scope: SMALL_SECTOR_SCOPE,
        savedPlannings: [],
      })
      expect(prepared.status).toBe("ready")
      if (prepared.status !== "ready") return
      const built = buildPlanningProblemV3(prepared.generationInput)
      expect(built.ok).toBe(true)
      if (!built.ok) return
      // Sorti de la fermeture : le rétrécissement de `built.ok` ne la traverse pas.
      const base = built.problem

      const adapter = createHighsFastAdapter({ timeoutSeconds: 90 })

      async function closingsOf(withHistory: boolean) {
        const problem: PlanningProblemV3 = withHistory
          ? {
              ...base,
              closingHistory: ids.map((id) => ({
                employeeId: id as unknown as EmployeeId,
                closings: heavy.includes(id) ? 6 : 2,
                opportunities: 15,
                saturdayClosings: 0,
                saturdayOpportunities: 15,
              })),
            }
          : { ...base, closingHistory: undefined }

        const response = await adapter({ problem } as SolvePlanningRequest)
        expect(response.solution, "aucun planning produit").not.toBeNull()
        const solution = response.solution!
        const dayByDate = new Map(problem.days.map((day) => [day.date, day]))
        const counts: Record<string, number> = Object.fromEntries(ids.map((id) => [id, 0]))
        for (const assignment of solution.assignments) {
          const day = dayByDate.get(assignment.date)
          if (!day || day.closesAtMinutes === null) continue
          const last = assignment.segments[assignment.segments.length - 1]
          if (last && last.endMinutes === day.closesAtMinutes) {
            counts[String(assignment.employeeId)] += 1
          }
        }
        return {
          counts,
          solution,
          heavy: heavy.reduce((sum, id) => sum + counts[id], 0),
          report: validatePlanningSolutionV3(problem, solution),
        }
      }

      const without = await closingsOf(false)
      const withHistory = await closingsOf(true)

      // La promesse, littéralement : à situation égale, ceux qui ont déjà
      // beaucoup fermé ferment MOINS que lorsque l'historique est ignoré.
      expect(withHistory.heavy).toBeLessThan(without.heavy)

      // Et pas « un peu moins » : les deux plus chargés doivent s'effacer
      // devant les trois autres. C'est ce que le critère de décision décide.
      // Tant qu'il regardait l'ÉCART (max moins min), deux salariés à égalité
      // au sommet le paralysaient : alléger l'un ne changeait pas le maximum,
      // donc pas l'écart, et l'échange était rejeté malgré son bienfait.
      expect(withHistory.heavy).toBeLessThanOrEqual(1)

      // Et cela sans rien casser : le planning reste légal et chaque contrat
      // est servi à la minute près.
      expect(withHistory.report.validHardConstraints).toBe(true)
      expect(weeklyMinutes(withHistory.solution)).toEqual(weeklyMinutes(without.solution))
    },
    300_000
  )
})
