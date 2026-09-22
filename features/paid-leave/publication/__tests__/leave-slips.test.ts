import { describe, expect, it } from "vitest"

import {
  buildLeaveSlips,
  describeFractionation,
  describeRemaining,
  describeShortBalance,
} from "@/features/paid-leave/publication/leave-slips"
import { buildLeaveSheet } from "@/features/paid-leave/publication/leave-sheet"
import type {
  PaidLeaveCampaign,
  PaidLeaveWeekId,
} from "@/features/paid-leave/models/paid-leave-campaign"
import type { EmployeeRecord } from "@/features/employees/types/employee.types"
import type { SectorDemandConfiguration } from "@/features/sectors"

/**
 * Le billet individuel, et le dénominateur qu'il montre.
 *
 * La feuille A3 dit ce qui a été décidé. Elle ne dit à personne POURQUOI, et
 * c'est la seule question que se pose celui qui y cherche son nom et n'y trouve
 * pas ses semaines d'août. Le verdict existait depuis le premier jour dans
 * `compromises` ; il n'avait aucun support pour sortir de l'écran du gérant.
 *
 * Le piège principal est le DÉNOMINATEUR. « 3 sur 5 » se lit comme un échec de
 * l'arbitrage — alors que si les deux semaines manquantes sont refusées par le
 * SOLDE, l'arbitrage n'y est pour rien et la personne resterait « incomplète »
 * à vie. C'est la troisième fois que cette distinction doit être faite dans ce
 * module, après le compte rendu de génération et la feuille au mur.
 */

const SECTOR = { id: "drive", name: "Drive", status: "active" } as SectorDemandConfiguration

const employee = (id: string, last = "Test"): EmployeeRecord =>
  ({
    id,
    firstName: id,
    lastName: last,
    status: "active",
    sectors: ["Drive"],
    weeklyHours: 35,
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
    period: { kind: "custom", startWeek: 28, endWeek: 40 },
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

const build = (base: PaidLeaveCampaign, employees: readonly EmployeeRecord[]) =>
  buildLeaveSlips({
    campaign: base,
    employees,
    sectors: [SECTOR],
    storeName: "Magasin",
    printedAtLabel: "Édité le 1er mars",
  })

describe("qui reçoit un billet", () => {
  it("le donne à qui a demandé et n’a rien obtenu", () => {
    // C'est dur à tendre, et c'est exactement pour cela qu'il faut le faire :
    // le silence est pire, et la phrase du verdict dit au moins pourquoi.
    const rien = campaign({
      requests: { alice: request("alice", [week(30)]) },
      grants: { alice: [] },
    })

    expect(build(rien, [employee("alice")]).slips).toHaveLength(1)
  })

  it("ne le donne pas à qui n’a rien demandé", () => {
    // Il n'y aurait rien à lui apprendre, et un billet vide dans une enveloppe
    // de paie est une question de plus, pas une réponse.
    expect(build(campaign(), [employee("alice")]).slips).toEqual([])
  })

  it("ignore les personnes qui ont quitté l’équipe", () => {
    const partie = campaign({ grants: { partie: [week(30)] } })
    const slips = build(partie, [{ ...employee("partie"), status: "inactive" } as EmployeeRecord])

    expect(slips.slips).toEqual([])
  })

  it("range les billets par nom de famille", () => {
    const deux = campaign({
      grants: { a: [week(30)], b: [week(31)] },
    })
    const slips = build(deux, [employee("a", "Zola"), employee("b", "Adam")])

    expect(slips.slips.map((slip) => slip.employeeId)).toEqual(["b", "a"])
  })
})

describe("ce que le billet montre des semaines", () => {
  const ferme = campaign({
    closureWeekIds: [week(32)],
    requests: { alice: request("alice", [week(30), week(31)]) },
    grants: { alice: [week(30), week(31)] },
  })

  it("mêle les attributions et la fermeture, dans l’ordre du calendrier", () => {
    const slip = build(ferme, [employee("alice")]).slips[0]

    expect(slip.weeks.map((entry) => entry.weekId)).toEqual([week(30), week(31), week(32)])
  })

  it("marque la semaine de fermeture et ne lui donne aucun rang", () => {
    // Personne ne l'a demandée : lui coller « vœu 1 » ferait croire à un
    // arbitrage là où il n'y a qu'un magasin fermé.
    const fermeture = build(ferme, [employee("alice")]).slips[0].weeks[2]

    expect(fermeture.closed).toBe(true)
    expect(fermeture.rank).toBeNull()
  })

  it("ne compte pas la fermeture dans les semaines attribuées", () => {
    // Elle ne se décide pas, donc elle ne s'attribue pas — même si elle
    // s'affiche juste au-dessus.
    expect(build(ferme, [employee("alice")]).slips[0].grantedCount).toBe(2)
  })
})

describe("le dénominateur, qui est tout le sujet", () => {
  // Cinq semaines demandées, un solde de trois : l'arbitrage n'a jamais eu le
  // droit d'en accorder plus de trois.
  const soldeCourt = campaign({
    requests: {
      alice: request("alice", [week(28), week(29), week(30), week(31), week(32)]),
    },
    employeeSettings: { alice: settings("alice", 3) },
    grants: { alice: [week(28), week(29), week(30)] },
  })

  it("montre ce qu’on POUVAIT accorder, pas ce qui a été demandé", () => {
    const slip = build(soldeCourt, [employee("alice")]).slips[0]

    expect(slip.grantableCount).toBe(3)
    expect(slip.grantedCount).toBe(3)
  })

  it("explique l’écart plutôt que de le laisser passer pour un refus", () => {
    const slip = build(soldeCourt, [employee("alice")]).slips[0]

    expect(slip.requestedCount).toBe(5)
    expect(describeShortBalance(slip)).toContain("n’en permettaient que 3")
  })

  it("se tait quand la demande tient dans le solde", () => {
    // Une phrase qui apparaît toujours cesse d'être lue.
    const large = campaign({
      requests: { alice: request("alice", [week(30)]) },
      employeeSettings: { alice: settings("alice", 5) },
      grants: { alice: [week(30)] },
    })

    expect(describeShortBalance(build(large, [employee("alice")]).slips[0])).toBeNull()
  })

  it("la feuille au mur compte de la MÊME façon", () => {
    // Deux documents décrivant la même personne ne peuvent pas afficher deux
    // dénominateurs. La feuille disait « 3 / 5 » et le billet « 3 sur 3 ».
    const row = buildLeaveSheet({
      campaign: soldeCourt,
      employees: [employee("alice")],
      sectors: [SECTOR],
      storeName: "Magasin",
      printedAtLabel: "Édité le 1er mars",
    }).groups[0].rows[0]

    expect(row.requestedCount).toBe(3)
  })
})

describe("ce que le billet dit des droits", () => {
  it("annonce les jours de fractionnement, et la renonciation", () => {
    // C'est un DROIT : le taire reviendrait à le garder pour soi. Et ne dire
    // que le droit laisserait croire qu'il est automatique.
    const hiver = campaign({
      period: { kind: "custom", startWeek: 1, endWeek: 52 },
      requests: { alice: request("alice", [week(28), week(29), week(48)]) },
      grants: { alice: [week(28), week(29), week(48)] },
    })
    const slip = build(hiver, [employee("alice")]).slips[0]

    expect(slip.fractionationDays).toBe(2)
    expect(describeFractionation(slip)).toContain("renoncer par écrit")
  })

  it("n’en parle pas quand il n’y a rien à annoncer", () => {
    const ete = campaign({
      requests: { alice: request("alice", [week(30)]) },
      grants: { alice: [week(30)] },
    })

    expect(describeFractionation(build(ete, [employee("alice")]).slips[0])).toBeNull()
  })

  it("compte la fermeture dans le solde restant", () => {
    // La personne pose bien ces semaines-là : les oublier lui annoncerait un
    // reliquat qu'elle n'a pas.
    const ferme = campaign({
      closureWeekIds: [week(32)],
      requests: { alice: request("alice", [week(30)]) },
      employeeSettings: { alice: settings("alice", 5) },
      grants: { alice: [week(30)] },
    })
    const slip = build(ferme, [employee("alice")]).slips[0]

    expect(slip.remainingWeeks).toBe(3)
    expect(describeRemaining(slip)).toContain("3 semaines")
  })

  it("ne dit rien du solde quand il n’est pas saisi", () => {
    const inconnu = campaign({
      requests: { alice: request("alice", [week(30)]) },
      grants: { alice: [week(30)] },
    })

    expect(describeRemaining(build(inconnu, [employee("alice")]).slips[0])).toBeNull()
  })
})

describe("le verdict, et l’état de la campagne", () => {
  it("reprend la phrase enregistrée avec le calcul", () => {
    const calculee = campaign({
      requests: { alice: request("alice", [week(30)]) },
      grants: { alice: [week(30)] },
      solution: {
        generatedAt: "2026-02-01T00:00:00.000Z",
        status: "optimal",
        grants: { alice: [week(30)] },
        reinforcementAllocations: [],
        compromises: [
          {
            employeeId: "alice",
            grantedWeeks: [week(30)],
            preferenceRanks: [1],
            mixed: false,
            prioritySatisfied: null,
            message: "Attribution entièrement issue du vœu 1.",
          },
        ],
      },
    } as Partial<PaidLeaveCampaign>)

    expect(build(calculee, [employee("alice")]).slips[0].message).toBe(
      "Attribution entièrement issue du vœu 1."
    )
  })

  it("marque une campagne non validée comme une proposition", () => {
    // Un brouillon distribué devient une promesse. Le bandeau est la seule
    // chose qui empêche un billet de sortir du bureau trop tôt.
    const brouillon = campaign({
      requests: { alice: request("alice", [week(30)]) },
      grants: { alice: [week(30)] },
    })

    expect(build(brouillon, [employee("alice")]).draft).toBe(true)
  })
})
