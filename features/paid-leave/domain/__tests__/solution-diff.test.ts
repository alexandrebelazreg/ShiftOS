import { describe, expect, it } from "vitest"

import { comparePaidLeaveSolution } from "@/features/paid-leave/domain/solution-diff"
import type {
  PaidLeaveCampaign,
  PaidLeaveWeekId,
} from "@/features/paid-leave/models/paid-leave-campaign"
import type { EmployeeRecord } from "@/features/employees/types/employee.types"

/**
 * Ce que le dernier calcul a changé.
 *
 * Le geste réel d'un gérant est une BOUCLE : desserrer un minimum, relancer,
 * regarder, recommencer. À chaque tour l'écran remplaçait tout sans rien dire de
 * ce qui avait bougé — et comparer vingt-six colonnes de mémoire n'est pas un
 * exercice que quelqu'un réussit.
 *
 * Deux pièges, et les tests portent surtout là-dessus : le PREMIER calcul n'a
 * rien à comparer, et la référence est ce que le gérant avait à l'écran — pas
 * la solution précédente du solveur, dont il a pu retoucher des semaines.
 */

const week = (number: number) => `2026-W${String(number).padStart(2, "0")}` as PaidLeaveWeekId

const employee = (id: string): EmployeeRecord =>
  ({
    id,
    firstName: id,
    lastName: "Test",
    status: "active",
    sectors: ["Drive"],
    weeklyHours: 35,
    createdAt: "2020-01-01T00:00:00.000Z",
  }) as EmployeeRecord

const request = (id: string, wish1: PaidLeaveWeekId[]) =>
  ({ employeeId: id, wish1, wish2: [], wish3: [] }) as never

function campaign({
  requests = {},
  before,
  after,
}: {
  requests?: Record<string, unknown>
  before: Record<string, PaidLeaveWeekId[]> | undefined
  after: Record<string, PaidLeaveWeekId[]>
}): PaidLeaveCampaign {
  return {
    schemaVersion: 1,
    id: "ete",
    name: "Été 2026",
    year: 2026,
    period: { kind: "custom", startWeek: 28, endWeek: 35 },
    status: "editing",
    employeeSettings: {},
    requests,
    coverage: {},
    reinforcementPools: [],
    closureWeekIds: [],
    grants: after,
    solution: {
      generatedAt: "2026-02-01T00:00:00.000Z",
      status: "optimal",
      grants: after,
      reinforcementAllocations: [],
      compromises: [],
      previousGrants: before,
    },
    validatedSnapshot: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  } as PaidLeaveCampaign
}

describe("ce qu’il n’y a pas à comparer", () => {
  it("se tait sur le PREMIER calcul d’une campagne", () => {
    // Annoncer que vingt personnes ont changé de semaines serait exact et
    // parfaitement inutile : elles n'en avaient aucune.
    expect(
      comparePaidLeaveSolution(
        campaign({ before: {}, after: { alice: [week(28)] } }),
        [employee("alice")]
      )
    ).toBeNull()
  })

  it("se tait aussi quand la photo d’avant est vide mais présente", () => {
    // Une campagne où chacun a une clé mais aucune semaine : c'est encore un
    // premier calcul, et le compte de clés ne doit pas le masquer.
    expect(
      comparePaidLeaveSolution(
        campaign({ before: { alice: [], bob: [] }, after: { alice: [week(28)] } }),
        [employee("alice"), employee("bob")]
      )
    ).toBeNull()
  })

  it("se tait sur une solution calculée avant ce champ", () => {
    expect(
      comparePaidLeaveSolution(
        campaign({ before: undefined, after: { alice: [week(28)] } }),
        [employee("alice")]
      )
    ).toBeNull()
  })
})

describe("ce qui a bougé", () => {
  it("ne nomme que les personnes dont les semaines diffèrent", () => {
    const diff = comparePaidLeaveSolution(
      campaign({
        before: { alice: [week(28)], bob: [week(30)] },
        after: { alice: [week(29)], bob: [week(30)] },
      }),
      [employee("alice"), employee("bob")]
    )

    expect(diff?.changed.map((change) => change.employeeId)).toEqual(["alice"])
    expect(diff?.changed[0].before).toEqual([week(28)])
    expect(diff?.changed[0].after).toEqual([week(29)])
  })

  it("ne se laisse pas tromper par l’ordre des semaines", () => {
    // Une retouche à la main peut remettre les semaines dans un autre ordre
    // sans rien changer. Nommer quelqu'un pour un tri ferait lire une liste de
    // faux changements, et on cesserait de la lire.
    const diff = comparePaidLeaveSolution(
      campaign({
        before: { alice: [week(29), week(28)] },
        after: { alice: [week(28), week(29)] },
      }),
      [employee("alice")]
    )

    expect(diff?.changed).toEqual([])
  })

  it("compte les semaines gagnées et perdues", () => {
    const diff = comparePaidLeaveSolution(
      campaign({
        before: { alice: [week(28)], bob: [week(30), week(31)] },
        after: { alice: [week(28), week(29)], bob: [week(30)] },
      }),
      [employee("alice"), employee("bob")]
    )

    expect(diff?.weeksBefore).toBe(3)
    expect(diff?.weeksAfter).toBe(3)
  })

  it("compte les premiers vœux des DEUX côtés avec la même règle", () => {
    // Jamais la liste que le solveur avait nommée pour l'ancienne campagne :
    // elle ne parlerait pas des semaines retouchées à la main depuis. Le même
    // prédicat relu sur les deux états est la seule comparaison honnête.
    const diff = comparePaidLeaveSolution(
      campaign({
        requests: {
          alice: request("alice", [week(28), week(29)]),
          bob: request("bob", [week(32), week(33)]),
        },
        before: { alice: [week(28), week(30)], bob: [week(32), week(33)] },
        after: { alice: [week(28), week(29)], bob: [week(32), week(33)] },
      }),
      [employee("alice"), employee("bob")]
    )

    expect(diff?.firstChoiceBefore).toBe(1)
    expect(diff?.firstChoiceAfter).toBe(2)
  })

  it("ignore les personnes qui ont quitté l’équipe", () => {
    const diff = comparePaidLeaveSolution(
      campaign({
        before: { alice: [week(28)], partie: [week(30)] },
        after: { alice: [week(28)] },
      }),
      [employee("alice"), { ...employee("partie"), status: "inactive" } as EmployeeRecord]
    )

    expect(diff?.changed).toEqual([])
  })
})
