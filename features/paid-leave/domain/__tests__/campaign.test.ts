import { describe, expect, it } from "vitest"

import { campaignWeeks, weekIdForDate, weeksInIsoYear } from "@/features/paid-leave/calendar/campaign-weeks"
import {
  effectiveRequestedWeeks,
  grantableWishes,
  linkPriorityEmployees,
  orphanedWishes,
  preferenceRank,
  togglePaidLeaveWish,
  wishPlanSizes,
  wishPlansDisagree,
} from "@/features/paid-leave/domain/campaign"
import type { PaidLeaveEmployeeSettings, PaidLeaveRequest, PaidLeaveWeekId } from "@/features/paid-leave/models/paid-leave-campaign"

describe("campagnes de congés payés", () => {
  it("construit les périodes été et hiver en semaines ISO", () => {
    expect(campaignWeeks(2026, { kind: "summer", startWeek: 18, endWeek: 43 })).toHaveLength(26)
    const winter = campaignWeeks(2026, { kind: "winter", startWeek: 44, endWeek: 17 })
    expect(winter[0].id).toBe("2026-W44")
    expect(winter.at(-1)?.id).toBe("2027-W17")
    expect(weeksInIsoYear(2026)).toBe(53)
    expect(weekIdForDate("2027-01-01")).toBe("2026-W53")
  })

  it("déduit le nombre demandé de la taille des plans", () => {
    const request: PaidLeaveRequest = {
      employeeId: "alice",
      wish1: ["2026-W20", "2026-W21"],
      wish2: ["2026-W20"],
      wish3: [],
    }
    const weeks = new Set<PaidLeaveWeekId>(["2026-W20", "2026-W21"])
    expect(effectiveRequestedWeeks(request, weeks)).toBe(2)
    expect(preferenceRank(request, "2026-W20")).toBe(1)
  })

  it("ne compte pas les vœux tombés hors de la période", () => {
    // Le défaut qui rendait une campagne invalidable à vie : le solveur
    // filtrait ces semaines, l'écran non, et l'écart ne se refermait jamais.
    const request: PaidLeaveRequest = {
      employeeId: "alice",
      wish1: ["2026-W20"],
      wish2: ["2026-W40"],
      wish3: [],
    }
    const weeks = new Set<PaidLeaveWeekId>(["2026-W20", "2026-W21"])

    expect(effectiveRequestedWeeks(request, weeks)).toBe(1)
    expect(grantableWishes(request, weeks)).toEqual(["2026-W20"])
    expect(orphanedWishes(request, weeks)).toEqual(["2026-W40"])
  })

  it("lit une demande absente comme zéro plutôt que de lever", () => {
    // Une fiche créée après la campagne n'a pas encore de demande, et l'écran
    // doit continuer à s'afficher.
    expect(effectiveRequestedWeeks(undefined, new Set())).toBe(0)
    expect(grantableWishes(undefined, new Set())).toEqual([])
    expect(orphanedWishes(undefined, new Set())).toEqual([])
  })

  it("maintient un lien réciproque sans modifier les priorités", () => {
    const setting = (employeeId: string, priority = false): PaidLeaveEmployeeSettings => ({
      employeeId,
      priority,
      linkedEmployeeId: null,
      entryDate: "2020-01-01",
      firstChoiceHistory: 0,
    })
    const linked = linkPriorityEmployees(
      { alice: setting("alice", true), bruno: setting("bruno") },
      "alice",
      "bruno"
    )
    expect(linked.alice).toMatchObject({ priority: true, linkedEmployeeId: "bruno" })
    expect(linked.bruno).toMatchObject({ priority: false, linkedEmployeeId: "alice" })
  })

  it("permet de cocher et décocher séparément les trois niveaux de vœux", () => {
    const request: PaidLeaveRequest = {
      employeeId: "alice",
      wish1: [],
      wish2: [],
      wish3: [],
    }
    const withWish1 = togglePaidLeaveWish(request, 1, "2026-W20")
    const withWish2 = togglePaidLeaveWish(withWish1, 2, "2026-W21")
    const withWish3 = togglePaidLeaveWish(withWish2, 3, "2026-W22")

    expect(withWish3).toMatchObject({
      wish1: ["2026-W20"],
      wish2: ["2026-W21"],
      wish3: ["2026-W22"],
    })
    expect(togglePaidLeaveWish(withWish3, 2, "2026-W21").wish2).toEqual([])
  })
})

describe("le nombre de semaines demandées se déduit des vœux", () => {
  const weeks = new Set<PaidLeaveWeekId>(["2026-W20", "2026-W21", "2026-W22"])
  const request = (wish1: PaidLeaveWeekId[], wish2: PaidLeaveWeekId[] = [], wish3: PaidLeaveWeekId[] = []): PaidLeaveRequest =>
    ({ employeeId: "alice", wish1, wish2, wish3 })

  it("vaut le nombre commun quand les trois plans le portent", () => {
    // Le cas normal : deux semaines voulues, trois façons de les prendre.
    const alice = request(["2026-W20", "2026-W21"], ["2026-W21", "2026-W22"], ["2026-W20", "2026-W22"])

    expect(effectiveRequestedWeeks(alice, weeks)).toBe(2)
    expect(wishPlansDisagree(alice, weeks)).toBe(false)
  })

  it("retient le plus grand plan quand les rangs sont inégaux", () => {
    // Un rang plus court ne doit pas rétrécir une demande que les autres
    // expriment en entier ; l'écart est signalé ailleurs, pas absorbé ici.
    const alice = request(["2026-W20", "2026-W21"], ["2026-W22"])

    expect(effectiveRequestedWeeks(alice, weeks)).toBe(2)
    expect(wishPlansDisagree(alice, weeks)).toBe(true)
  })

  it("ne compte pas les semaines hors période dans la taille d’un plan", () => {
    const alice = request(["2026-W20", "2026-W40"])

    expect(wishPlanSizes(alice, weeks)).toEqual([1, 0, 0])
    expect(effectiveRequestedWeeks(alice, weeks)).toBe(1)
  })

  it("ne voit aucune incohérence dans un seul rang rempli", () => {
    // On peut n'avoir qu'une seule idée : ce n'est pas une saisie inachevée.
    expect(wishPlansDisagree(request(["2026-W20", "2026-W21"]), weeks)).toBe(false)
  })

  it("ne compte pas deux fois une semaine cochée deux fois dans le même rang", () => {
    expect(wishPlanSizes(request(["2026-W20", "2026-W20"]), weeks)).toEqual([1, 0, 0])
  })

  it("vaut zéro sans aucun vœu, et cocher suffit à le lever", () => {
    // LE PIÈGE DISPARU : il n'existe plus de nombre à remplir à côté, donc plus
    // de personne dont les vœux s'affichent et qui n'obtient rien.
    const empty = request([])
    expect(effectiveRequestedWeeks(empty, weeks)).toBe(0)
    expect(effectiveRequestedWeeks(togglePaidLeaveWish(empty, 1, "2026-W20"), weeks)).toBe(1)
  })
})
