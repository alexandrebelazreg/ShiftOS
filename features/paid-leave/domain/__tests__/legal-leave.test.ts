import { describe, expect, it } from "vitest"

import { paidLeaveGenerationWarnings } from "@/features/paid-leave/domain/generation-report"
import {
  isMainLeaveWeek,
  outsideWorkingDays,
  readPaidLeaveLegally,
} from "@/features/paid-leave/domain/legal-leave"
import { campaignWeekIds } from "@/features/paid-leave/domain/campaign"
import type {
  PaidLeaveCampaign,
  PaidLeaveWeekId,
} from "@/features/paid-leave/models/paid-leave-campaign"
import type { EmployeeRecord } from "@/features/employees/types/employee.types"
import type { SectorDemandConfiguration } from "@/features/sectors"

/**
 * Ce que la loi dit d'une attribution déjà posée.
 *
 * Deux règles, et le même refus de les imposer au solveur — pour deux raisons
 * opposées, qui méritent chacune d'être vérifiée ici.
 *
 * La continuité (L3141-19) se heurte à la couverture : en contrainte, elle
 * rendrait `infeasible` une campagne servable, et « rien » est une plus
 * mauvaise réponse qu'une attribution irrégulière annoncée comme telle.
 *
 * Le fractionnement (L3141-23) n'est pas un défaut : c'est un droit qui
 * s'ouvre au salarié. Il n'y a rien à optimiser, seulement quelque chose à ne
 * pas découvrir en paie.
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

function campaign(patch: Partial<PaidLeaveCampaign> = {}): PaidLeaveCampaign {
  return {
    schemaVersion: 1,
    id: "annee",
    name: "Année 2026",
    year: 2026,
    // Toute l'année : les deux règles se jouent sur la frontière du 31 octobre,
    // et une campagne d'été ne pourrait pas la franchir.
    period: { kind: "custom", startWeek: 1, endWeek: 52 },
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

describe("la période légale, comptée en jours ouvrables", () => {
  it("couvre le 1er mai au 31 octobre", () => {
    // S19 de 2026 commence le lundi 4 mai ; S44 commence le lundi 26 octobre.
    expect(outsideWorkingDays(week(19))).toBe(0)
    expect(isMainLeaveWeek(week(19))).toBe(true)
  })

  it("exclut ce qui tombe avant mai et après octobre", () => {
    // S10 commence le 2 mars ; S45 commence le lundi 2 novembre.
    expect(outsideWorkingDays(week(10))).toBe(6)
    expect(isMainLeaveWeek(week(10))).toBe(false)
    expect(isMainLeaveWeek(week(45))).toBe(false)
  })

  it("coupe une semaine à cheval au bon endroit", () => {
    // LE cas qui a fait abandonner l'arrondi à la semaine, et ce n'est pas un
    // cas limite : S18 est la PREMIÈRE semaine de la campagne d'été proposée
    // par défaut. Du lundi 27 avril au dimanche 3 mai : quatre jours ouvrables
    // dehors, deux dedans. Arrondie à son lundi, elle en compterait six.
    expect(outsideWorkingDays(week(18))).toBe(4)
    expect(isMainLeaveWeek(week(18))).toBe(true)
  })

  it("garde entière la dernière semaine d'octobre", () => {
    // S44 court du lundi 26 octobre au dimanche 1er novembre. Ses six jours
    // ouvrables vont du lundi au samedi 31 octobre : tous dedans. Le dimanche
    // 1er novembre est dehors, et c'est précisément pour lui qu'on compte six
    // jours et non sept — sept feraient franchir un seuil à une semaine qui ne
    // le franchit pas.
    expect(outsideWorkingDays(week(44))).toBe(0)
  })
})

describe("la continuité du congé principal (L3141-19)", () => {
  it("signale deux semaines d’été qui ne se touchent pas", () => {
    // Douze jours ouvrables ou moins : le congé DOIT être continu. Deux
    // semaines séparées par une semaine de travail n'en font pas un.
    const lecture = readPaidLeaveLegally(
      campaign({ grants: { alice: [week(28), week(30)] } }),
      "alice"
    )

    expect(lecture.requiredBlock).toBe(2)
    expect(lecture.longestBlock).toBe(1)
    expect(lecture.mainLeaveSplit).toBe(true)
  })

  it("se tait quand les deux semaines se suivent", () => {
    const lecture = readPaidLeaveLegally(
      campaign({ grants: { alice: [week(28), week(29)] } }),
      "alice"
    )

    expect(lecture.longestBlock).toBe(2)
    expect(lecture.mainLeaveSplit).toBe(false)
  })

  it("accepte le fractionnement dès qu’un morceau atteint deux semaines", () => {
    // Au-delà de douze jours ouvrables, la loi autorise la coupure pourvu
    // qu'une fraction fasse douze jours d'un seul tenant. Trois semaines dont
    // deux collées sont donc régulières.
    const lecture = readPaidLeaveLegally(
      campaign({ grants: { alice: [week(28), week(29), week(33)] } }),
      "alice"
    )

    expect(lecture.longestBlock).toBe(2)
    expect(lecture.mainLeaveSplit).toBe(false)
  })

  it("ne reproche rien à une seule semaine", () => {
    // Une semaine est continue par construction : exiger deux semaines d'un
    // salarié qui n'en pose qu'une inventerait une infraction.
    const lecture = readPaidLeaveLegally(
      campaign({ grants: { alice: [week(28)] } }),
      "alice"
    )

    expect(lecture.requiredBlock).toBe(1)
    expect(lecture.mainLeaveSplit).toBe(false)
  })

  it("ne reproche rien à un congé entièrement hors saison", () => {
    // Le congé principal est celui de la période légale. Deux semaines en
    // février séparées n'ont aucune continuité à respecter — elles ouvrent en
    // revanche un droit, et c'est l'autre règle qui s’en charge.
    const lecture = readPaidLeaveLegally(
      campaign({ grants: { alice: [week(6), week(8)] } }),
      "alice"
    )

    expect(lecture.requiredBlock).toBe(0)
    expect(lecture.mainLeaveSplit).toBe(false)
  })

  it("compte la fermeture du magasin comme un congé", () => {
    // LE cas qui se laisse oublier. La personne obtient W29, le magasin ferme
    // en W30 : son absence dure bien deux semaines d'affilée. Ne regarder que
    // les attributions lui reprocherait une coupure qu'elle ne vit pas.
    const lecture = readPaidLeaveLegally(
      campaign({ grants: { alice: [week(29)] }, closureWeekIds: [week(30)] }),
      "alice"
    )

    expect(lecture.leaveWeeks).toEqual([week(29), week(30)])
    expect(lecture.longestBlock).toBe(2)
    expect(lecture.mainLeaveSplit).toBe(false)
  })
})

describe("les jours de fractionnement (L3141-23)", () => {
  it("ouvre deux jours pour une semaine posée hors saison", () => {
    // Une semaine pleine hors période vaut six jours ouvrables, et l'article en
    // donne deux à partir de six.
    const lecture = readPaidLeaveLegally(
      campaign({ grants: { alice: [week(28), week(29), week(48)] } }),
      "alice"
    )

    expect(lecture.daysOutsideMainPeriod).toBe(6)
    expect(lecture.fractionationDays).toBe(2)
  })

  it("n’en ouvre qu’UN quand la semaine est à cheval sur le 1er mai", () => {
    // S18 place quatre jours ouvrables hors période : l'article en donne un,
    // pas deux. C'est la première semaine de la campagne d'été par défaut, donc
    // le cas normal — et l'arrondi à la semaine annonçait ici un droit de trop.
    const lecture = readPaidLeaveLegally(
      campaign({ grants: { alice: [week(18), week(19)] } }),
      "alice"
    )

    expect(lecture.daysOutsideMainPeriod).toBe(4)
    expect(lecture.fractionationDays).toBe(1)
  })

  it("n’ouvre rien quand tout tombe dans la saison", () => {
    const lecture = readPaidLeaveLegally(
      campaign({ grants: { alice: [week(28), week(29)] } }),
      "alice"
    )

    expect(lecture.fractionationDays).toBe(0)
  })

  it("ignore la cinquième semaine, qui n’ouvre aucun droit", () => {
    // Le congé principal s'arrête à vingt-quatre jours ouvrables, soit quatre
    // semaines. La cinquième se prend à part et ne compte dans aucune des deux
    // règles : quatre semaines d'été puis une en décembre n'ouvrent rien.
    const lecture = readPaidLeaveLegally(
      campaign({
        grants: { alice: [week(28), week(29), week(30), week(31), week(50)] },
      }),
      "alice"
    )

    expect(lecture.mainLeaveWeeks).toBe(4)
    expect(lecture.daysOutsideMainPeriod).toBe(0)
    expect(lecture.fractionationDays).toBe(0)
  })

  it("compte une fermeture hors saison comme le reste", () => {
    // Une fermeture entre Noël et le Nouvel An ouvre le droit aussi sûrement
    // qu'une semaine demandée — et personne ne l'a choisie, ce qui rend le
    // silence encore moins acceptable.
    const lecture = readPaidLeaveLegally(
      campaign({ grants: { alice: [week(28), week(29)] }, closureWeekIds: [week(52)] }),
      "alice"
    )

    expect(lecture.daysOutsideMainPeriod).toBe(6)
    expect(lecture.fractionationDays).toBe(2)
  })
})

describe("ce que le compte rendu en dit", () => {
  const warnings = (patch: Partial<PaidLeaveCampaign>) => {
    const base = campaign(patch)
    return paidLeaveGenerationWarnings({
      campaign: base,
      employees: [employee("alice")],
      sectors: [SECTOR],
      weekIds: campaignWeekIds(base),
    }).map((warning) => warning.kind)
  }

  it("nomme un congé principal coupé", () => {
    expect(warnings({ grants: { alice: [week(28), week(30)] } })).toContain("main-leave-split")
  })

  it("nomme un droit au fractionnement", () => {
    expect(warnings({ grants: { alice: [week(28), week(29), week(48)] } })).toContain("fractionation")
  })

  it("se tait avant le calcul, quand rien n’est encore attribué", () => {
    // Les deux lignes se lisent sur les attributions. Une campagne en cours de
    // saisie n'en a aucune, et reprocher à tout le monde un congé principal
    // vide rendrait le compte rendu illisible là où il sert le plus.
    const kinds = warnings({ requests: { alice: { employeeId: "alice", wish1: [week(28)], wish2: [], wish3: [] } } })

    expect(kinds).not.toContain("main-leave-split")
    expect(kinds).not.toContain("fractionation")
  })
})
