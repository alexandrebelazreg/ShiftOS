import { describe, expect, it } from "vitest"

import { grantsMatchSolution } from "@/features/paid-leave/domain/campaign"
import type {
  PaidLeaveCampaign,
  PaidLeaveWeekId,
} from "@/features/paid-leave/models/paid-leave-campaign"
import { paidLeaveSolveResponseSchema } from "@/features/paid-leave/solver/paid-leave-solver-contract"

/**
 * Le prix de chaque concession, et la garde qui décide de l'afficher.
 *
 * Ces nombres répondent « si vous lâchez ceci, voilà ce que vous gagnez PAR
 * RAPPORT À CETTE CAMPAGNE-LÀ ». Dès que le gérant déplace une semaine à la
 * main, la référence n'existe plus : promettre un gain sur elle serait un
 * mensonge, et le taire est la seule réponse honnête.
 *
 * La même garde sert à confronter les deux lectures du premier vœu. Une seule
 * définition, donc — c'est la leçon que ce module a payée cinq fois.
 */

const week = (number: number) => `2026-W${String(number).padStart(2, "0")}` as PaidLeaveWeekId

function campaign(
  grants: Record<string, PaidLeaveWeekId[]>,
  solved: Record<string, PaidLeaveWeekId[]> | null
): PaidLeaveCampaign {
  return {
    schemaVersion: 1,
    id: "ete",
    name: "Été 2026",
    year: 2026,
    period: { kind: "custom", startWeek: 28, endWeek: 35 },
    status: "editing",
    employeeSettings: {},
    requests: {},
    coverage: {},
    reinforcementPools: [],
    closureWeekIds: [],
    grants,
    solution: solved
      ? {
          generatedAt: "2026-02-01T00:00:00.000Z",
          status: "optimal",
          grants: solved,
          reinforcementAllocations: [],
          compromises: [],
        }
      : null,
    validatedSnapshot: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  } as PaidLeaveCampaign
}

describe("les attributions sont-elles encore celles du calcul", () => {
  it("reconnaît une campagne intacte", () => {
    expect(
      grantsMatchSolution(
        campaign({ alice: [week(28), week(29)] }, { alice: [week(28), week(29)] })
      )
    ).toBe(true)
  })

  it("ne se laisse pas tromper par l’ordre des semaines", () => {
    // Les attributions arrivent triées du solveur, mais une retouche à la main
    // peut les remettre dans un autre ordre sans rien changer. Comparer les
    // listes telles quelles ferait crier l'avertissement pour un tri.
    expect(
      grantsMatchSolution(
        campaign({ alice: [week(29), week(28)] }, { alice: [week(28), week(29)] })
      )
    ).toBe(true)
  })

  it("voit une semaine déplacée à la main", () => {
    expect(
      grantsMatchSolution(
        campaign({ alice: [week(28), week(30)] }, { alice: [week(28), week(29)] })
      )
    ).toBe(false)
  })

  it("voit une semaine retirée", () => {
    expect(
      grantsMatchSolution(campaign({ alice: [week(28)] }, { alice: [week(28), week(29)] }))
    ).toBe(false)
  })

  it("voit une personne ajoutée après coup", () => {
    // Les clés des deux côtés, pas seulement celles de la solution : une
    // attribution donnée à quelqu'un que le calcul n'avait pas servi passerait
    // sinon inaperçue.
    expect(
      grantsMatchSolution(
        campaign({ alice: [week(28)], bob: [week(30)] }, { alice: [week(28)] })
      )
    ).toBe(false)
  })

  it("répond « non » tant qu’aucun calcul n’a eu lieu", () => {
    // Pas de référence, donc rien à comparer — et surtout rien à afficher.
    expect(grantsMatchSolution(campaign({ alice: [week(28)] }, null))).toBe(false)
  })
})

describe("ce que le contrat accepte du solveur", () => {
  const base = {
    status: "optimal" as const,
    grants: {},
    reinforcementAllocations: [],
    objectiveValues: {},
    durationMs: 10,
  }

  it("lit les quatre leviers", () => {
    const parsed = paidLeaveSolveResponseSchema.parse({
      ...base,
      firstChoiceEmployeeIds: ["alice"],
      concessions: [
        { lever: "unserved_worst", firstChoiceServed: 2, employeeIds: ["alice", "chloe"] },
        { lever: "unserved_total", firstChoiceServed: 1, employeeIds: ["alice"] },
        { lever: "couples", firstChoiceServed: 1, employeeIds: ["alice"] },
        { lever: "mixed_plans", firstChoiceServed: 1, employeeIds: ["alice"] },
      ],
    })

    expect(parsed.status).toBe("optimal")
    if (parsed.status !== "optimal") return
    expect(parsed.concessions).toHaveLength(4)
    expect(parsed.concessions[0].firstChoiceServed).toBe(2)
  })

  it("rend une liste vide plutôt que rien quand le solveur n’a pas sondé", () => {
    // Un solveur qui a consommé son budget, ou une réponse enregistrée avant
    // cette fonctionnalité. L'absence de concession n'est PAS « aucune ne
    // rapporte » — c'est « on n'a pas regardé », et l'écran n'affiche rien.
    const parsed = paidLeaveSolveResponseSchema.parse(base)

    expect(parsed.status).toBe("optimal")
    if (parsed.status !== "optimal") return
    expect(parsed.concessions).toEqual([])
  })

  it("refuse un levier inconnu plutôt que de l’afficher tel quel", () => {
    const parsed = paidLeaveSolveResponseSchema.safeParse({
      ...base,
      concessions: [{ lever: "baisser_les_minimums", firstChoiceServed: 3, employeeIds: [] }],
    })

    expect(parsed.success).toBe(false)
  })
})
