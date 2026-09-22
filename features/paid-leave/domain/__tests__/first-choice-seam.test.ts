import { describe, expect, it } from "vitest"

import {
  attributableWeekIds,
  campaignWeekIds,
  grantIsEntirelyFirstChoice,
} from "@/features/paid-leave/domain/campaign"
import { paidLeaveGenerationWarnings } from "@/features/paid-leave/domain/generation-report"
import type {
  PaidLeaveCampaign,
  PaidLeaveWeekId,
} from "@/features/paid-leave/models/paid-leave-campaign"
import type { EmployeeRecord } from "@/features/employees/types/employee.types"
import type { SectorDemandConfiguration } from "@/features/sectors"

/**
 * LE JOINT LE PLUS COÛTEUX DU MODULE, ET LE PLUS LENT À SE VOIR.
 *
 * « Servi sur tout son premier vœu » est écrit DEUX FOIS : en Python parce que
 * le solveur l'optimise, en TypeScript parce que la validation doit savoir
 * juger des attributions retouchées à la main, que le solveur n'a jamais vues.
 * Le doublon est nécessaire. C'est son SILENCE qui ne l'était pas.
 *
 * Si les deux lectures divergent, la validation fige une liste fausse dans
 * `fullFirstChoiceEmployeeIds`, l'équité de la campagne SUIVANTE s'en sert, et
 * l'écart n'apparaît qu'un an plus tard sous la forme « pourquoi cette personne
 * ne passe-t-elle pas devant ? ».
 *
 * Le solveur nomme donc désormais qui il a compté, et l'écran confronte cette
 * liste à sa propre lecture des MÊMES attributions, à chaque calcul, sur de
 * vraies données — ce qu'aucun jeu d'essai écrit à l'avance ne couvrirait,
 * puisque par construction on n'écrit que les cas auxquels on a pensé.
 */

const SECTOR = { id: "drive", name: "Drive", status: "active" } as SectorDemandConfiguration

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

const week = (number: number) => `2026-W${String(number).padStart(2, "0")}` as PaidLeaveWeekId

const request = (id: string, wish1: PaidLeaveWeekId[], wish2: PaidLeaveWeekId[] = []) =>
  ({ employeeId: id, wish1, wish2, wish3: [] }) as never

function campaign(patch: Partial<PaidLeaveCampaign> = {}): PaidLeaveCampaign {
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
    grants: {},
    solution: null,
    validatedSnapshot: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...patch,
  } as PaidLeaveCampaign
}

/** La solution telle que le solveur l'a rendue, avec la liste qu'il a nommée. */
function solvedAs(
  grants: Record<string, PaidLeaveWeekId[]>,
  firstChoiceEmployeeIds: string[] | undefined
) {
  return {
    generatedAt: "2026-02-01T00:00:00.000Z",
    status: "optimal" as const,
    grants,
    reinforcementAllocations: [],
    compromises: [],
    firstChoiceEmployeeIds,
  } as never
}

describe("le prédicat lui-même, qui n’avait aucun test", () => {
  const weekIds = campaignWeekIds(campaign())

  it("reconnaît un premier vœu servi en entier", () => {
    expect(
      grantIsEntirelyFirstChoice(
        request("alice", [week(28), week(29)]),
        [week(28), week(29)],
        weekIds
      )
    ).toBe(true)
  })

  it("refuse dès qu’une semaine vient d’ailleurs", () => {
    // Le compte tombe juste — deux semaines pour deux demandées — et pourtant
    // ce n'est PAS le premier vœu. Compter sans regarder d'où viennent les
    // semaines suffirait à créditer quelqu'un servi sur son repli.
    expect(
      grantIsEntirelyFirstChoice(
        request("alice", [week(28), week(29)]),
        [week(28), week(30)],
        weekIds
      )
    ).toBe(false)
  })

  it("refuse un premier vœu servi à moitié", () => {
    expect(
      grantIsEntirelyFirstChoice(request("alice", [week(28), week(29)]), [week(28)], weekIds)
    ).toBe(false)
  })

  it("refuse quand rien n’a été demandé", () => {
    // `target > 0` n'est pas une précaution de style : sans lui, une personne
    // sans vœu et sans attribution donnerait `0 === 0`, c'est-à-dire « servie
    // au premier vœu » — et elle gagnerait un crédit d'équité pour n'avoir
    // rien demandé.
    expect(grantIsEntirelyFirstChoice(request("alice", []), [], weekIds)).toBe(false)
  })

  it("mesure la cible sur le PLUS GRAND plan, pas sur le premier", () => {
    // Le vœu 2 est plus long que le vœu 1 : la personne demande donc trois
    // semaines, et son premier vœu ne peut pas les couvrir. La servir
    // entièrement au premier vœu est impossible, et c'est la bonne réponse.
    expect(
      grantIsEntirelyFirstChoice(
        request("alice", [week(28), week(29)], [week(31), week(32), week(33)]),
        [week(28), week(29)],
        weekIds
      )
    ).toBe(false)
  })

  it("ignore une semaine de fermeture, comme le solveur", () => {
    // Passé l'ensemble ATTRIBUABLE, un vœu de trois semaines dont une ferme
    // n'en demande plus que deux — et les deux accordées suffisent. Sur
    // l'ensemble de la campagne, le compte ne tomberait jamais juste et la
    // personne perdrait son crédit pour une fermeture qu'elle n'a pas choisie.
    const ferme = campaign({ closureWeekIds: [week(30)] })

    expect(
      grantIsEntirelyFirstChoice(
        request("alice", [week(28), week(29), week(30)]),
        [week(28), week(29)],
        attributableWeekIds(ferme)
      )
    ).toBe(true)
  })
})

describe("la confrontation des deux lectures", () => {
  const warn = (patch: Partial<PaidLeaveCampaign>) => {
    const base = campaign({
      requests: { alice: request("alice", [week(28), week(29)]) },
      ...patch,
    })
    return paidLeaveGenerationWarnings({
      campaign: base,
      employees: [employee("alice")],
      sectors: [SECTOR],
      weekIds: campaignWeekIds(base),
    }).filter((warning) => warning.kind === "equity-mismatch")
  }

  it("se tait quand les deux comptent la même personne", () => {
    expect(
      warn({
        grants: { alice: [week(28), week(29)] },
        solution: solvedAs({ alice: [week(28), week(29)] }, ["alice"]),
      })
    ).toEqual([])
  })

  it("alerte quand le solveur compte quelqu’un que l’écran ne compte pas", () => {
    // W30 ne figure pas dans le vœu 1 : l'écran dit « non ». Si le solveur dit
    // « oui » sur les mêmes semaines, l'une des deux lectures est fausse — et
    // c'est la liste figée à la validation qui décidera des priorités de
    // l'année prochaine.
    const alerte = warn({
      grants: { alice: [week(28), week(30)] },
      solution: solvedAs({ alice: [week(28), week(30)] }, ["alice"]),
    })

    expect(alerte).toHaveLength(1)
    expect(alerte[0].message).toContain("alice")
  })

  it("alerte aussi dans l’autre sens", () => {
    expect(
      warn({
        grants: { alice: [week(28), week(29)] },
        solution: solvedAs({ alice: [week(28), week(29)] }, []),
      })
    ).toHaveLength(1)
  })

  it("se tait dès que les attributions ont été retouchées à la main", () => {
    // LA garde, et elle n'est pas décorative. La liste du solveur parle des
    // attributions qu'IL a rendues ; dès que le gérant en déplace une, elle
    // décrit un état qui n'existe plus. Comparer quand même ferait crier
    // l'avertissement à chaque retouche — et un avertissement qui crie à tort
    // est un avertissement qu'on apprend à ignorer.
    expect(
      warn({
        grants: { alice: [week(28), week(30)] },
        solution: solvedAs({ alice: [week(28), week(29)] }, ["alice"]),
      })
    ).toEqual([])
  })

  it("se tait sur une solution calculée avant que le solveur ne nomme personne", () => {
    // Absence de liste veut dire « rien à comparer », jamais « personne n'a eu
    // son premier vœu » — sans quoi toute campagne d'avant ce champ alerterait.
    expect(
      warn({
        grants: { alice: [week(28), week(29)] },
        solution: solvedAs({ alice: [week(28), week(29)] }, undefined),
      })
    ).toEqual([])
  })

  it("se tait sur une personne désactivée depuis le calcul", () => {
    // Le solveur l'a comptée ; elle a quitté l'équipe depuis, donc l'écran ne la
    // lit plus. Faire sonner l'alarme pour un départ apprendrait à l'ignorer —
    // et il n'y a effectivement plus rien à vérifier sur quelqu'un qui a quitté
    // la campagne.
    const partie = campaign({
      requests: { alice: request("alice", [week(28), week(29)]) },
      grants: { alice: [week(28), week(29)] },
      solution: solvedAs({ alice: [week(28), week(29)] }, ["alice"]),
    })

    const warnings = paidLeaveGenerationWarnings({
      campaign: partie,
      employees: [{ ...employee("alice"), status: "inactive" } as EmployeeRecord],
      sectors: [SECTOR],
      weekIds: campaignWeekIds(partie),
    })

    expect(warnings.filter((warning) => warning.kind === "equity-mismatch")).toEqual([])
  })

  it("se tait tant qu’aucun calcul n’a eu lieu", () => {
    expect(warn({ grants: { alice: [week(28), week(29)] } })).toEqual([])
  })
})
