import { describe, expect, it } from "vitest"

import { employeeDeletionVerdict, type EmployeeCitationSources } from "@/features/employees/deletion"
import { sectorDeletionVerdict } from "@/features/sectors/deletion"
import { createEmptySector } from "@/features/sectors"
import type { PlanningRecord } from "@/features/planning/persistence/planning-record"

/**
 * Ce qui peut disparaître, et ce qui ne le peut pas.
 *
 * La propriété centrale est négative, comme pour les verrous : **au moindre
 * doute, on ne supprime pas.** L'erreur dans un sens se répare d'un clic — on
 * désactive, on recrée — tandis que l'erreur dans l'autre sens détruit une
 * absence enregistrée ou rend illisible un planning de l'an dernier.
 *
 * Deux dangers sont testés nommément parce qu'ils sont invisibles à la lecture
 * du code : la cascade SQL sur les absences, et le rattachement des salariés à
 * un secteur PAR SON NOM.
 */

const EMPTY: EmployeeCitationSources = {
  plannings: [],
  absences: [],
  permanences: [],
  leaveCampaigns: [],
}

function planningWith(employeeId: string, sectorIds: readonly string[] = []): PlanningRecord {
  return {
    id: "p1",
    status: "published",
    label: "Semaine 27",
    periodStart: "2026-07-06",
    periodEnd: "2026-07-12",
    sectorIds,
    createdAt: "2026-07-01",
    updatedAt: "2026-07-01",
    savedAt: "2026-07-01",
    state: {
      shifts: [],
      assignments: [{ id: "a1", planningId: "p1", shiftId: "s1", employeeId, status: "confirmed" }],
    },
  } as unknown as PlanningRecord
}

describe("supprimer une fiche salarié", () => {
  it("laisse partir une fiche que rien ne cite", () => {
    // Le cas visé : la fiche créée il y a deux minutes avec une faute de frappe.
    const verdict = employeeDeletionVerdict("e1", EMPTY)
    expect(verdict.deletable).toBe(true)
    expect(verdict.citations).toEqual([])
  })

  it("retient une fiche affectée dans un planning", () => {
    const verdict = employeeDeletionVerdict("e1", { ...EMPTY, plannings: [planningWith("e1")] })
    expect(verdict.deletable).toBe(false)
    expect(verdict.citations[0].family).toBe("planning")
  })

  it("retient une fiche qui porte une absence — que la base effacerait sans un mot", () => {
    // `absences.employee_id` porte `on delete cascade`. Sans ce test, la
    // suppression emporterait l'arrêt de travail enregistré, silencieusement.
    const verdict = employeeDeletionVerdict("e1", {
      ...EMPTY,
      absences: [{ employeeId: "e1", start: "2026-03-02" }],
    })
    expect(verdict.deletable).toBe(false)
    expect(verdict.citations[0].family).toBe("absence")
  })

  it("retient une fiche inscrite à un tour de permanence", () => {
    const month = {
      id: "2026-03",
      assignments: { "2026-03-02_opening": "e1" },
      rest: {},
      weeks: {},
    }
    const verdict = employeeDeletionVerdict("e1", { ...EMPTY, permanences: [month as never] })
    expect(verdict.deletable).toBe(false)
    expect(verdict.citations[0].family).toBe("permanence")
  })

  it("retient une fiche prise dans une campagne de congés", () => {
    const campaign = {
      id: "c1",
      name: "Été 2026",
      year: 2026,
      requests: { r1: { employeeId: "e1" } },
      employeeSettings: {},
      grants: {},
      coverage: {},
      reinforcementPools: [],
      solution: null,
    }
    const verdict = employeeDeletionVerdict("e1", { ...EMPTY, leaveCampaigns: [campaign as never] })
    expect(verdict.deletable).toBe(false)
    expect(verdict.citations[0].family).toBe("leave")
  })

  it("ne retient pas une fiche pour les citations de quelqu'un d'autre", () => {
    // Sans quoi la présence d'un seul planning gèlerait toute l'équipe.
    const verdict = employeeDeletionVerdict("e2", {
      ...EMPTY,
      plannings: [planningWith("e1")],
      absences: [{ employeeId: "e1", start: "2026-03-02" }],
    })
    expect(verdict.deletable).toBe(true)
  })
})

describe("supprimer un secteur", () => {
  const sector = { ...createEmptySector("s1"), name: "Charcuterie" }
  const EMPTY_SECTOR = { employees: [], plannings: [], leaveCampaigns: [] }

  it("laisse partir un secteur que rien ne cite", () => {
    expect(sectorDeletionVerdict(sector, EMPTY_SECTOR).deletable).toBe(true)
  })

  it("retient un secteur auquel un salarié est rattaché PAR SON NOM", () => {
    // Le rattachement est une chaîne, pas une clé : rien dans le typage ne
    // signale la casse. Supprimer viderait le rattachement sans rien dire, et
    // la fiche continuerait de porter un nom qui ne désigne plus rien.
    const verdict = sectorDeletionVerdict(sector, {
      ...EMPTY_SECTOR,
      employees: [{ status: "active", sectors: ["Charcuterie"], firstName: "Marie", lastName: "Martin" }],
    })
    expect(verdict.deletable).toBe(false)
    expect(verdict.citations[0].label).toBe("Marie Martin")
  })

  it("retient un secteur même pour un salarié inactif", () => {
    // Sa fiche existe encore, et la réactiver doit la retrouver rattachée à
    // quelque chose de réel.
    const verdict = sectorDeletionVerdict(sector, {
      ...EMPTY_SECTOR,
      employees: [{ status: "inactive", sectors: ["Charcuterie"] }],
    })
    expect(verdict.deletable).toBe(false)
  })

  it("retient un secteur cité par un planning publié", () => {
    // C'est aussi ce que lit l'historique des fermetures : le retirer ferait
    // perdre à l'équité la mémoire de ces semaines.
    const verdict = sectorDeletionVerdict(sector, {
      ...EMPTY_SECTOR,
      plannings: [planningWith("e1", ["s1"])],
    })
    expect(verdict.deletable).toBe(false)
    expect(verdict.citations[0].family).toBe("planning")
  })

  it("ne confond pas deux secteurs de noms voisins", () => {
    const verdict = sectorDeletionVerdict(sector, {
      ...EMPTY_SECTOR,
      employees: [{ status: "active", sectors: ["Charcuterie traiteur"] }],
    })
    expect(verdict.deletable).toBe(true)
  })
})
