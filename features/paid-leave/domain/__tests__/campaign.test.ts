import { describe, expect, it } from "vitest"

import { campaignWeeks, weekIdForDate, weeksInIsoYear } from "@/features/paid-leave/calendar/campaign-weeks"
import {
  effectiveRequestedWeeks,
  linkPriorityEmployees,
  preferenceRank,
  togglePaidLeaveWish,
} from "@/features/paid-leave/domain/campaign"
import type { PaidLeaveEmployeeSettings, PaidLeaveRequest } from "@/features/paid-leave/models/paid-leave-campaign"

describe("campagnes de congés payés", () => {
  it("construit les périodes été et hiver en semaines ISO", () => {
    expect(campaignWeeks(2026, { kind: "summer", startWeek: 18, endWeek: 43 })).toHaveLength(26)
    const winter = campaignWeeks(2026, { kind: "winter", startWeek: 44, endWeek: 17 })
    expect(winter[0].id).toBe("2026-W44")
    expect(winter.at(-1)?.id).toBe("2027-W17")
    expect(weeksInIsoYear(2026)).toBe(53)
    expect(weekIdForDate("2027-01-01")).toBe("2026-W53")
  })

  it("limite l’attribution au nombre demandé et aux semaines distinctes cochées", () => {
    const request: PaidLeaveRequest = {
      employeeId: "alice",
      requestedWeeks: 3,
      wish1: ["2026-W20", "2026-W21"],
      wish2: ["2026-W20"],
      wish3: [],
    }
    expect(effectiveRequestedWeeks(request)).toBe(2)
    expect(preferenceRank(request, "2026-W20")).toBe(1)
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
      requestedWeeks: 2,
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
