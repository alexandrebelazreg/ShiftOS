import { describe, expect, it } from "vitest"

import { calculatePaidLeaveCoverage } from "@/features/paid-leave/coverage/paid-leave-coverage"
import {
  activeForbiddenWeeks,
  attributableWeekIds,
  campaignWeekIds,
  orphanedWishes,
  paidLeaveTargets,
} from "@/features/paid-leave/domain/campaign"
import { paidLeaveGenerationWarnings } from "@/features/paid-leave/domain/generation-report"
import type {
  PaidLeaveCampaign,
  PaidLeaveWeekId,
} from "@/features/paid-leave/models/paid-leave-campaign"
import { buildPaidLeaveSolveRequest } from "@/features/paid-leave/solver/paid-leave-solver-contract"
import type { EmployeeRecord } from "@/features/employees/types/employee.types"
import type { SectorDemandConfiguration } from "@/features/sectors"

/**
 * LES SEMAINES INTERDITES — l'exact opposé d'une fermeture.
 *
 * La fermeture met TOUT LE MONDE EN CONGÉ : elle décompte du solde, et le
 * magasin n'a personne à couvrir. L'interdiction met tout le monde AU TRAVAIL :
 * elle ne décompte rien, et la couverture s'y calcule comme partout ailleurs.
 * Fin décembre, les soldes, la rentrée.
 *
 * Leur SEUL point commun est de n'être pas attribuables. Tout le reste les
 * oppose, et ces tests portent d'abord sur ce qui les sépare — parce que deux
 * réglages qui se ressemblent à l'écran finissent par être confondus dans le
 * code.
 *
 * La distinction la plus facile à manquer est le SOLDE : une fermeture le
 * consomme, une interdiction le laisse intact. S'y tromper ferait perdre à
 * chacun autant de semaines de congé que le gérant en a fermées aux fêtes.
 */

const SECTOR = { id: "drive", name: "Drive", status: "active" } as SectorDemandConfiguration

const employee = (id: string, hours = 35): EmployeeRecord =>
  ({
    id,
    firstName: id,
    lastName: "Test",
    status: "active",
    sectors: ["Drive"],
    weeklyHours: hours,
    createdAt: "2020-01-01T00:00:00.000Z",
  }) as EmployeeRecord

const week = (number: number) => `2026-W${String(number).padStart(2, "0")}` as PaidLeaveWeekId

const request = (id: string, wish1: PaidLeaveWeekId[]) =>
  ({ employeeId: id, wish1, wish2: [], wish3: [] }) as never

const settings = (id: string, entitlementWeeks: number | null) =>
  ({
    employeeId: id,
    priority: false,
    linkedEmployeeId: null,
    entryDate: "2020-01-01",
    firstChoiceHistory: 0,
    entitlementWeeks,
  }) as never

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
    forbiddenWeekIds: [],
    grants: {},
    solution: null,
    validatedSnapshot: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...patch,
  } as PaidLeaveCampaign
}

describe("ce qu’une interdiction partage avec une fermeture", () => {
  const interdite = campaign({ forbiddenWeekIds: [week(31)] })

  it("sort la semaine de ce qui est attribuable", () => {
    expect(attributableWeekIds(interdite).has(week(31))).toBe(false)
    expect(attributableWeekIds(interdite).has(week(30))).toBe(true)
  })

  it("la laisse DANS la campagne : un vœu qui y tombe n’est pas orphelin", () => {
    // Un vœu hors période désigne une semaine que la campagne ne couvre pas ;
    // celui-ci désigne une semaine bien réelle, que le gérant a fermée aux
    // congés. Les confondre enverrait vérifier des dates qui sont justes.
    expect(campaignWeekIds(interdite).has(week(31))).toBe(true)
    expect(orphanedWishes(request("alice", [week(31)]), campaignWeekIds(interdite))).toEqual([])
  })

  it("ignore une interdiction tombée hors de la période", () => {
    expect([...activeForbiddenWeeks(campaign({ forbiddenWeekIds: [week(31), week(50)] }))])
      .toEqual([week(31)])
  })
})

describe("ce qui les oppose, et qu’il ne faut pas confondre", () => {
  const trois = [week(29), week(30), week(31)] as PaidLeaveWeekId[]

  it("NE DÉCOMPTE RIEN DU SOLDE, là où une fermeture le consomme", () => {
    // LA distinction, et le test doit la rendre VISIBLE. Trois semaines de
    // solde exactement, trois demandées, et une semaine neutralisée en S35 —
    // que ni l'une ni l'autre des personnes ne demande.
    //
    // Fermée, elle prend une semaine du solde : il n'en reste que deux à
    // arbitrer. Interdite, elle n'en prend aucune : les trois restent servables.
    // Avec un solde large, les deux cas donneraient le même chiffre et le test
    // ne prouverait rien — c'est le solde JUSTE qui les sépare.
    const avec = (patch: Partial<PaidLeaveCampaign>) =>
      paidLeaveTargets(
        campaign({
          requests: { alice: request("alice", trois) },
          employeeSettings: { alice: settings("alice", 3) },
          ...patch,
        })
      )("alice")

    expect(avec({ forbiddenWeekIds: [week(35)] })).toBe(3)
    expect(avec({ closureWeekIds: [week(35)] })).toBe(2)
  })

  it("laisse la couverture se calculer normalement", () => {
    // Le magasin est OUVERT et l'équipe au travail : le minimum s'y applique
    // comme partout. Une fermeture, elle, supprime la ligne — et peindre une
    // semaine interdite comme fermée cacherait le seul endroit où la couverture
    // est certaine d'être tenue.
    const interdite = campaign({
      period: { kind: "custom", startWeek: 30, endWeek: 30 },
      forbiddenWeekIds: [week(30)],
      coverage: { drive: { [week(30)]: { minimumHours: 200, toleratedDeficitHours: 0, maximumAbsent: null } } },
    })
    const coverage = calculatePaidLeaveCoverage({
      campaign: interdite,
      employees: [employee("alice")],
      sectors: [SECTOR],
    })

    expect(coverage.cells[0].closed).toBe(false)
    expect(coverage.cells[0].state).toBe("red")
  })
})

describe("ce que le solveur reçoit", () => {
  const interdite = campaign({
    forbiddenWeekIds: [week(30)],
    requests: { alice: request("alice", [week(29), week(30), week(31)]) },
  })

  it("ôte la semaine interdite des plans", () => {
    const sent = buildPaidLeaveSolveRequest({
      campaign: interdite,
      employees: [employee("alice")],
      sectors: [SECTOR],
    })

    expect(sent.employees[0].plans[0].weekIds).toEqual([week(29), week(31)])
    expect(sent.employees[0].targetWeeks).toBe(2)
  })

  it("ne la déclare PAS comme une fermeture", () => {
    // `closureWeekIds` dit au solveur « personne ne travaille » : il y
    // supprimerait la couverture et souderait les congés de part et d'autre.
    // Une semaine interdite ne fait ni l'un ni l'autre — elle disparaît
    // simplement des plans.
    const sent = buildPaidLeaveSolveRequest({
      campaign: interdite,
      employees: [employee("alice")],
      sectors: [SECTOR],
    })

    expect(sent.closureWeekIds).toEqual([])
    expect(sent.weeks).toContain(week(30))
  })
})

describe("ce que l’écran en dit", () => {
  const warn = (base: PaidLeaveCampaign) =>
    paidLeaveGenerationWarnings({
      campaign: base,
      employees: [employee("alice")],
      sectors: [SECTOR],
      weekIds: campaignWeekIds(base),
    }).map((warning) => warning.kind)

  it("prévient quand un vœu tombe sur une semaine interdite", () => {
    // Sans cette ligne, la personne paraîtrait simplement moins bien servie que
    // les autres, et le gérant chercherait la cause dans la couverture.
    const base = campaign({
      forbiddenWeekIds: [week(31)],
      requests: { alice: request("alice", [week(30), week(31)]) },
    })

    expect(warn(base)).toContain("forbidden-wishes")
  })

  it("se tait quand aucun vœu n’y tombe", () => {
    const base = campaign({
      forbiddenWeekIds: [week(35)],
      requests: { alice: request("alice", [week(30)]) },
    })

    expect(warn(base)).not.toContain("forbidden-wishes")
  })

  it("ne déclare PAS incomplète une personne amputée par l’interdiction", () => {
    // C'est le gérant qui a fermé cette semaine : le lui reprocher à chaque
    // écran reviendrait à lui redemander une décision qu'il a prise. La cible
    // est réduite, donc deux semaines sur deux — et non deux sur trois.
    const base = campaign({
      forbiddenWeekIds: [week(31)],
      requests: { alice: request("alice", [week(29), week(30), week(31)]) },
      grants: { alice: [week(29), week(30)] },
    })

    expect(paidLeaveTargets(base)("alice")).toBe(2)
  })
})
