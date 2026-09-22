import { describe, expect, it } from "vitest"

import { calculatePaidLeaveCoverage } from "@/features/paid-leave/coverage/paid-leave-coverage"
import {
  activeClosureWeeks,
  attributableWeekIds,
  campaignWeekIds,
  orphanedWishes,
  paidLeaveTargets,
  remainingEntitlementWeeks,
} from "@/features/paid-leave/domain/campaign"
import {
  describePaidLeaveOutcome,
  paidLeaveGenerationWarnings,
} from "@/features/paid-leave/domain/generation-report"
import type {
  PaidLeaveCampaign,
  PaidLeaveWeekId,
} from "@/features/paid-leave/models/paid-leave-campaign"
import { validatePaidLeaveCampaign } from "@/features/paid-leave/domain/validation"
import { buildLeaveSheet } from "@/features/paid-leave/publication/leave-sheet"
import { buildPaidLeaveSolveRequest } from "@/features/paid-leave/solver/paid-leave-solver-contract"
import type { EmployeeRecord } from "@/features/employees/types/employee.types"
import type { SectorDemandConfiguration } from "@/features/sectors"

/**
 * La fermeture du magasin, vue de l'écran.
 *
 * Elle n'est pas une attribution de plus : c'est un fait qui déplace DEUX
 * notions qu'on avait le droit de confondre jusque-là. « Dans la campagne » et
 * « attribuable » cessent de coïncider, et le solde de chacun se réduit d'autant
 * de semaines que le magasin ferme.
 *
 * Les quatre bornes de la cible se composaient jusqu'ici dans quatre fichiers
 * séparément. Il a suffi d'en ajouter une quatrième pour que trois d'entre eux
 * se trompent — d'où `paidLeaveTargets`, et d'où ces tests sur la composition
 * plutôt que sur chaque borne prise à part.
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

describe("les deux ensembles de semaines, que la fermeture sépare", () => {
  const ferme = campaign({ closureWeekIds: [week(31), week(32)] })

  it("retire les semaines fermées de ce qui est attribuable", () => {
    expect(attributableWeekIds(ferme).has(week(31))).toBe(false)
    expect(attributableWeekIds(ferme).has(week(30))).toBe(true)
  })

  it("les laisse DANS la campagne, et c’est toute la distinction", () => {
    // Un vœu posé sur une semaine de fermeture n'est pas un vœu hors période :
    // il est sans objet. Confondre les deux ferait dire à l'écran qu'une
    // semaine demandée est tombée hors de la campagne, ce qui est faux — et le
    // gérant irait vérifier des dates qui sont justes.
    expect(campaignWeekIds(ferme).has(week(31))).toBe(true)
    expect(
      orphanedWishes(request("alice", [week(31)]), campaignWeekIds(ferme))
    ).toEqual([])
  })

  it("ignore une fermeture tombée hors de la période", () => {
    // Elle survit à un changement de période. La compter décompterait du solde
    // une fermeture qui n'a plus lieu dans cette campagne.
    const deplacee = campaign({ closureWeekIds: [week(31), week(50)] })

    expect([...activeClosureWeeks(deplacee)]).toEqual([week(31)])
  })
})

describe("le solde, une fois la fermeture déduite", () => {
  it("retranche les semaines fermées du solde", () => {
    expect(remainingEntitlementWeeks(5, 2)).toBe(3)
  })

  it("laisse passer « solde inconnu » sans fabriquer un zéro", () => {
    // LE défaut à éviter. Une soustraction appliquée à `null` lu comme zéro
    // donnerait zéro, et une seule semaine de fermeture fermerait la campagne à
    // toutes les personnes dont le solde n'est pas saisi — c'est-à-dire à
    // toutes les campagnes écrites avant ce champ.
    expect(remainingEntitlementWeeks(null, 2)).toBeNull()
    expect(remainingEntitlementWeeks(undefined, 2)).toBeNull()
  })

  it("ne descend jamais sous zéro", () => {
    expect(remainingEntitlementWeeks(1, 3)).toBe(0)
  })
})

describe("la cible, une fois les quatre bornes composées", () => {
  it("borne au solde RESTANT, fermeture déduite", () => {
    // Cinq semaines demandées, un solde de cinq, deux semaines fermées : il
    // reste trois semaines à poser. Sans la déduction, la campagne en accordait
    // cinq à côté de la fermeture et la personne en avait posé sept.
    const ferme = campaign({
      closureWeekIds: [week(34), week(35)],
      requests: { alice: request("alice", [week(28), week(29), week(30), week(31), week(32)]) },
      employeeSettings: { alice: settings("alice", 5) },
    })

    expect(paidLeaveTargets(ferme)("alice")).toBe(3)
  })

  it("retire les semaines fermées de la demande elle-même", () => {
    // Le plan porte trois semaines dont une fermée : il n'en reste que deux à
    // placer. La personne obtient bien ses trois semaines d'absence, mais le
    // solveur n'en décide que deux.
    const ferme = campaign({
      closureWeekIds: [week(30)],
      requests: { alice: request("alice", [week(29), week(30), week(31)]) },
    })

    expect(paidLeaveTargets(ferme)("alice")).toBe(2)
  })

  it("ne vérifie rien quand le solde est inconnu, fermeture ou non", () => {
    const ferme = campaign({
      closureWeekIds: [week(30)],
      requests: { alice: request("alice", [week(29), week(31)]) },
      employeeSettings: { alice: settings("alice", null) },
    })

    expect(paidLeaveTargets(ferme)("alice")).toBe(2)
  })
})

describe("ce que le contrat envoie au solveur", () => {
  const ferme = campaign({
    closureWeekIds: [week(30)],
    requests: { alice: request("alice", [week(29), week(30), week(31)]) },
    employeeSettings: { alice: settings("alice", 4) },
  })

  it("ôte les semaines fermées des plans", () => {
    const sent = buildPaidLeaveSolveRequest({
      campaign: ferme,
      employees: [employee("alice")],
      sectors: [SECTOR],
    })

    expect(sent.employees[0].plans[0].weekIds).toEqual([week(29), week(31)])
    expect(sent.employees[0].targetWeeks).toBe(2)
  })

  it("garde les semaines fermées dans le calendrier, et les nomme", () => {
    // Elles restent dans `weeks` : la contiguïté des congés se lit sur cette
    // liste, et une semaine fermée SOUDE les congés de part et d'autre. Les en
    // retirer ferait de W29 et W31 deux absences séparées.
    const sent = buildPaidLeaveSolveRequest({
      campaign: ferme,
      employees: [employee("alice")],
      sectors: [SECTOR],
    })

    expect(sent.weeks).toContain(week(30))
    expect(sent.closureWeekIds).toEqual([week(30)])
  })
})

describe("la couverture d’une semaine fermée", () => {
  const ferme = campaign({
    period: { kind: "custom", startWeek: 30, endWeek: 30 },
    closureWeekIds: [week(30)],
    coverage: { drive: { [week(30)]: { minimumHours: 200, toleratedDeficitHours: 0, maximumAbsent: 0 } } },
  })

  it("ne compte ni en rouge ni en orange", () => {
    // Le minimum est hors d'atteinte et le plafond vaut zéro : sans la
    // fermeture, la cellule est rouge deux fois. Le solveur, lui, saute la
    // ligne entière — un écran qui annonce un rouge que le calcul ne verra
    // jamais est pire qu'un écran muet.
    const coverage = calculatePaidLeaveCoverage({
      campaign: ferme,
      employees: [employee("alice")],
      sectors: [SECTOR],
    })

    expect(coverage.cells[0].closed).toBe(true)
    expect(coverage.cells[0].state).toBe("closed")
    expect(coverage.redCellCount).toBe(0)
    expect(coverage.orangeCellCount).toBe(0)
  })

  it("redevient rouge dès que la fermeture est retirée", () => {
    const ouvert = calculatePaidLeaveCoverage({
      campaign: { ...ferme, closureWeekIds: [] },
      employees: [employee("alice")],
      sectors: [SECTOR],
    })

    expect(ouvert.cells[0].state).toBe("red")
  })
})

describe("ce que le compte rendu dit de la fermeture", () => {
  const ferme = campaign({
    closureWeekIds: [week(34), week(35)],
    requests: { alice: request("alice", [week(28), week(29)]) },
    grants: { alice: [week(28), week(29)] },
  })

  it("la nomme au lieu de la passer sous silence", () => {
    // Elle n'entre dans aucun des deux comptes — ce n'est pas une attribution.
    // Sans cette phrase, deux semaines de congé pour toute l'équipe
    // n'apparaîtraient nulle part dans le compte rendu du calcul qui vient
    // pourtant de les prendre en compte.
    const outcome = describePaidLeaveOutcome({
      campaign: ferme,
      employees: [employee("alice")],
      sectors: [SECTOR],
      weekIds: campaignWeekIds(ferme),
      durationMs: 1200,
    })

    expect(outcome.message).toContain("Fermeture du magasin : 2 semaines")
    expect(outcome.incompleteEmployees).toBe(0)
  })

  it("ne dit rien quand le magasin ne ferme pas", () => {
    const outcome = describePaidLeaveOutcome({
      campaign: { ...ferme, closureWeekIds: [] },
      employees: [employee("alice")],
      sectors: [SECTOR],
      weekIds: campaignWeekIds(ferme),
      durationMs: 1200,
    })

    expect(outcome.message).not.toContain("Fermeture")
  })

  it("prévient quand la fermeture dépasse à elle seule le solde", () => {
    // Elle ne se refuse pas : la personne sera en congé ces semaines-là qu'elle
    // ait le solde ou non. Le dire est donc la seule chose à faire — cela se
    // règle en paie, et personne ne peut le décider à sa place.
    const court = campaign({
      closureWeekIds: [week(34), week(35)],
      requests: { alice: request("alice", [week(28)]) },
      employeeSettings: { alice: settings("alice", 1) },
    })

    const warnings = paidLeaveGenerationWarnings({
      campaign: court,
      employees: [employee("alice")],
      sectors: [SECTOR],
      weekIds: campaignWeekIds(court),
    })

    expect(warnings.map((warning) => warning.kind)).toContain("closure-over-entitlement")
  })
})

describe("ce que la fermeture ne doit PAS coûter", () => {
  // Trois semaines demandées dont une ferme : la personne ne peut recevoir que
  // deux attributions, et c'est tout ce qu'elle pouvait recevoir.
  const ferme = campaign({
    closureWeekIds: [week(30)],
    requests: { alice: request("alice", [week(29), week(30), week(31)]) },
    grants: { alice: [week(29), week(31)] },
  })

  it("laisse son crédit d'équité à qui a tout ce qu'il pouvait avoir", () => {
    // LE piège silencieux. Jugée sur la campagne entière, la cible vaut trois,
    // le compte ne tombe jamais juste, et la personne perd le crédit qui la
    // ferait passer devant à la campagne suivante — pour une fermeture qu'elle
    // n'a pas choisie. Le solveur, lui, compte déjà la fermeture hors du plan.
    const validee = validatePaidLeaveCampaign(ferme, "2026-03-01T00:00:00.000Z")

    expect(validee.validatedSnapshot?.fullFirstChoiceEmployeeIds).toEqual(["alice"])
  })

  it("fige la fermeture AVEC les attributions", () => {
    // Elle décide comment les relire : deux semaines de part et d'autre d'une
    // fermeture forment un congé continu, la même paire sans fermeture est un
    // congé coupé en deux — irrégulier au sens de L3141-19. Relire l'arbitrage
    // de l'an dernier à la lumière d'une fermeture modifiée depuis dirait
    // l'inverse de ce qui a été décidé.
    const validee = validatePaidLeaveCampaign(ferme, "2026-03-01T00:00:00.000Z")

    expect(validee.validatedSnapshot?.closureWeekIds).toEqual([week(30)])
  })

  it("compte « 2 sur 2 » sur la feuille, et non « 2 sur 3 »", () => {
    const sheet = buildLeaveSheet({
      campaign: ferme,
      employees: [employee("alice")],
      sectors: [SECTOR],
      storeName: "Magasin",
      printedAtLabel: "le 1er mars",
    })
    const row = sheet.groups[0].rows[0]

    expect(row.grantedCount).toBe(2)
    expect(row.requestedCount).toBe(2)
  })

  it("montre la fermeture sur la feuille, sans la confondre avec une attribution", () => {
    // La feuille est ce qu'on punaise au mur. Une fermeture qui n'y figure pas
    // est une fermeture que personne ne connaît — et fondue dans les
    // attributions, elle ferait croire à toute l'équipe qu'elle doit cette
    // semaine à son arbitrage.
    const sheet = buildLeaveSheet({
      campaign: ferme,
      employees: [employee("alice")],
      sectors: [SECTOR],
      storeName: "Magasin",
      printedAtLabel: "le 1er mars",
    })
    const cells = sheet.groups[0].rows[0].cells

    expect(cells.find((cell) => cell.weekId === week(30))?.closed).toBe(true)
    expect(cells.find((cell) => cell.weekId === week(30))?.granted).toBe(false)
    expect(cells.find((cell) => cell.weekId === week(29))?.closed).toBe(false)
  })
})
