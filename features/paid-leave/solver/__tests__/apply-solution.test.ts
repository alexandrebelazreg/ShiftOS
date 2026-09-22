import { describe, expect, it } from "vitest"

import type { PaidLeaveCampaign } from "@/features/paid-leave/models/paid-leave-campaign"
import { applyOptimalPaidLeaveSolution } from "@/features/paid-leave/solver/apply-solution"
import type { PaidLeaveSolveResponse } from "@/features/paid-leave/solver/paid-leave-solver-contract"

/**
 * Ce que le gérant LIT, une fois le calcul rendu.
 *
 * Ce module n'avait aucun test, alors qu'il traduit la réponse du solveur en
 * phrases affichées — et qu'il portait deux mesures fausses.
 *
 * `prioritySatisfied` se calculait sur le RÉSULTAT : la cible valait
 * `min(semaines accordées à l'un, semaines accordées à l'autre)`, si bien que
 * deux personnes repartant les mains vides donnaient `0 === 0`, c'est-à-dire
 * « priorité satisfaite ». Le critère ne pouvait pratiquement jamais valoir
 * faux : il se vérifiait lui-même.
 *
 * Et `mixed` se lisait sur les rangs des semaines prises une à une, alors qu'une
 * semaine figurant dans deux plans ne porte que le plus petit de ses rangs — un
 * plan de repli accordé EN ENTIER ressemblait donc à un mélange.
 */

const WEEK = (number: number) => `2026-W${String(number).padStart(2, "0")}`

function campaign(patch: Partial<PaidLeaveCampaign> = {}): PaidLeaveCampaign {
  return {
    schemaVersion: 1,
    id: "summer",
    name: "Été 2026",
    year: 2026,
    period: { kind: "custom", startWeek: 28, endWeek: 40 },
    status: "editing",
    employeeSettings: {},
    requests: {},
    coverage: {},
    reinforcementPools: [],
    grants: {},
    solution: null,
    validatedSnapshot: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...patch,
  } as PaidLeaveCampaign
}

const request = (id: string, wish1: string[], wish2: string[] = []) =>
  ({ employeeId: id, wish1, wish2, wish3: [] }) as never

const settings = (id: string, linked: string | null, entitlementWeeks: number | null = null) =>
  ({
    employeeId: id,
    priority: linked !== null,
    linkedEmployeeId: linked,
    entryDate: "2020-01-01",
    firstChoiceHistory: 0,
    entitlementWeeks,
  }) as never

function solution(grants: Record<string, string[]>): Extract<PaidLeaveSolveResponse, { status: "optimal" }> {
  return {
    status: "optimal",
    grants,
    reinforcementAllocations: [],
    objectiveValues: {},
    durationMs: 1,
  } as never
}

function compromise(base: PaidLeaveCampaign, grants: Record<string, string[]>, id: string) {
  const applied = applyOptimalPaidLeaveSolution(base, solution(grants), "2026-02-01T00:00:00.000Z")
  return applied.solution?.compromises.find((entry) => entry.employeeId === id)
}

describe("le congé simultané, tel que l’écran le rapporte", () => {
  const couple = campaign({
    employeeSettings: { alice: settings("alice", "bob"), bob: settings("bob", "alice") },
    requests: {
      alice: request("alice", [WEEK(30), WEEK(31)]),
      bob: request("bob", [WEEK(30), WEEK(31)]),
    },
  })

  it("dit « non » à deux personnes qui ont demandé et repartent les mains vides", () => {
    // LE défaut de cette correction. La cible valait le minimum des DEUX
    // ATTRIBUTIONS : zéro et zéro donnaient `0 === 0`, c'est-à-dire « droit
    // tenu », et le gérant lisait qu'un couple était réuni alors que personne
    // n'était parti. Lue sur la demande — deux semaines chacun — la cible dit
    // ce qu'il faut : le droit n'est pas tenu.
    expect(compromise(couple, { alice: [], bob: [] }, "alice")?.prioritySatisfied).toBe(false)
  })

  it("n’a rien à satisfaire quand aucun des deux n’a rien demandé", () => {
    // `null` est réservé à « la question ne se pose pas » : sans partenaire, ou
    // quand le couple n'a exprimé aucun vœu. C'est la seule façon de distinguer
    // « droit non tenu » de « aucun droit à tenir ».
    const muets = campaign({
      employeeSettings: { alice: settings("alice", "bob"), bob: settings("bob", "alice") },
      requests: { alice: request("alice", []), bob: request("bob", []) },
    })

    expect(compromise(muets, { alice: [], bob: [] }, "alice")?.prioritySatisfied).toBeNull()
  })

  it("dit « non » quand ils partagent moins que le plus court des deux congés", () => {
    // Chacun obtient ses deux semaines, mais pas les mêmes : le droit au congé
    // simultané n'est pas tenu, et la cible — deux semaines demandées par
    // chacun — le dit.
    expect(
      compromise(couple, { alice: [WEEK(30)], bob: [WEEK(31)] }, "alice")?.prioritySatisfied
    ).toBe(false)
  })

  it("dit « oui » quand le plus court des deux congés est entièrement partagé", () => {
    expect(
      compromise(couple, { alice: [WEEK(30), WEEK(31)], bob: [WEEK(30), WEEK(31)] }, "alice")
        ?.prioritySatisfied
    ).toBe(true)
  })

  it("mesure sur la DEMANDE, pas sur ce que le calcul a laissé", () => {
    // Les deux ont demandé DEUX semaines ensemble ; Bob n'en a obtenu qu'une.
    // Ils n'en partagent donc qu'une sur les deux voulues : le droit n'est pas
    // tenu, et c'est ce qu'il faut lire.
    //
    // Mesurée sur le résultat, la cible se réduisait à `min(2, 1) = 1` — elle
    // suivait la diminution qu'elle était censée constater, et répondait
    // « tenu ». C'est la forme la plus pure du défaut : un critère qui
    // s'aligne sur ce qu'il mesure ne mesure rien.
    expect(
      compromise(couple, { alice: [WEEK(30), WEEK(31)], bob: [WEEK(30)] }, "bob")
        ?.prioritySatisfied
    ).toBe(false)
  })

  it("se contente du plus court des deux congés quand ils diffèrent", () => {
    // Alice demande deux semaines, Bob une seule : la cible du couple est UNE,
    // et la partager suffit — Bob est entièrement en congé avec Alice.
    const inegal = campaign({
      employeeSettings: { alice: settings("alice", "bob"), bob: settings("bob", "alice") },
      requests: {
        alice: request("alice", [WEEK(30), WEEK(31)]),
        bob: request("bob", [WEEK(30)]),
      },
    })

    expect(
      compromise(inegal, { alice: [WEEK(30), WEEK(31)], bob: [WEEK(30)] }, "bob")
        ?.prioritySatisfied
    ).toBe(true)
  })

  it("mesure la cible comme le solveur : solde compris", () => {
    // D3. Alice n'a plus qu'UNE semaine à poser ; le couple ne peut donc en
    // partager qu'une, et c'est ce que le solveur optimise. L'écran recomposait
    // la cible sur la demande NUE — deux semaines — et annonçait « droit non
    // tenu » sur un couple que le calcul venait de prouver réuni.
    const soldeCourt = campaign({
      employeeSettings: {
        alice: settings("alice", "bob", 1),
        bob: settings("bob", "alice"),
      },
      requests: {
        alice: request("alice", [WEEK(30), WEEK(31)]),
        bob: request("bob", [WEEK(30), WEEK(31)]),
      },
    })

    expect(
      compromise(soldeCourt, { alice: [WEEK(30)], bob: [WEEK(30), WEEK(31)] }, "alice")
        ?.prioritySatisfied
    ).toBe(true)
  })

  it("mesure la cible comme le solveur : fermeture comprise", () => {
    // Même défaut par l'autre borne. Le magasin ferme en S31 : les deux y seront
    // en congé de toute façon, et il ne reste qu'UNE semaine à partager. Compter
    // la semaine fermée dans la cible exige du calcul un partage qu'il n'a pas
    // le droit de décider.
    const ferme = campaign({
      closureWeekIds: [WEEK(31)] as never,
      employeeSettings: { alice: settings("alice", "bob"), bob: settings("bob", "alice") },
      requests: {
        alice: request("alice", [WEEK(30), WEEK(31)]),
        bob: request("bob", [WEEK(30), WEEK(31)]),
      },
    })

    expect(
      compromise(ferme, { alice: [WEEK(30)], bob: [WEEK(30)] }, "alice")?.prioritySatisfied
    ).toBe(true)
  })

  it("n’a rien à satisfaire sans partenaire", () => {
    const seule = campaign({
      employeeSettings: { alice: settings("alice", null) },
      requests: { alice: request("alice", [WEEK(30)]) },
    })

    expect(compromise(seule, { alice: [WEEK(30)] }, "alice")?.prioritySatisfied).toBeNull()
  })
})

describe("le plan obtenu, tel que le message le nomme", () => {
  const base = campaign({
    requests: { alice: request("alice", [WEEK(30), WEEK(31)], [WEEK(30), WEEK(35)]) },
  })

  it("un plan de repli accordé en entier n’est pas un mélange", () => {
    // W30 figure dans les DEUX plans et ne porte donc que son meilleur rang.
    // Lu sur les rangs des semaines, « W30 + W35 » mêlait du rang 1 et du
    // rang 2 ; lu sur l'appartenance, c'est le second plan, pris entier.
    const entry = compromise(base, { alice: [WEEK(30), WEEK(35)] }, "alice")

    expect(entry?.mixed).toBe(false)
    expect(entry?.message).toBe("Attribution issue du vœu 2.")
  })

  it("nomme le premier vœu quand il est pris entier", () => {
    const entry = compromise(base, { alice: [WEEK(30), WEEK(31)] }, "alice")

    expect(entry?.mixed).toBe(false)
    expect(entry?.message).toBe("Attribution entièrement issue du vœu 1.")
  })

  it("annonce un mélange quand aucun plan ne contient tout", () => {
    const entry = compromise(base, { alice: [WEEK(31), WEEK(35)] }, "alice")

    expect(entry?.mixed).toBe(true)
    expect(entry?.message).toContain("répartie entre plusieurs niveaux")
  })

  it("nomme une saisie à la main plutôt qu’un rang inexistant", () => {
    // Le solveur ne pioche que dans les plans : une semaine hors de tout vœu ne
    // peut venir que d'une retouche. Le message disait « jusqu'au vœu null ».
    const entry = compromise(base, { alice: [WEEK(38)] }, "alice")

    expect(entry?.message).toBe("Attribution saisie à la main, hors des vœux exprimés.")
  })
})
