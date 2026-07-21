import { describe, expect, it } from "vitest"

import {
  isoWeekNumber,
  isoWeekYear,
  listWeekOptions,
  mondayOf,
  shiftWeeks,
  sundayOf,
  weekPeriod,
} from "@/features/planning/board/model/week"

/**
 * These guard a bug that actually shipped: the planning period was anchored on
 * "today", so week 30 ran Tuesday 21 → Monday 27 while claiming to be week 30.
 * The columns, the dates and the week number all disagreed.
 */
describe("semaine ISO — une semaine commence toujours un lundi", () => {
  it("ramène n'importe quelle date à son lundi", () => {
    // 2026-07-21 is a Tuesday; its week starts on Monday the 20th.
    expect(mondayOf("2026-07-21")).toBe("2026-07-20")
    expect(mondayOf("2026-07-20")).toBe("2026-07-20")
    expect(mondayOf("2026-07-26")).toBe("2026-07-20")
    // Sunday belongs to the week that began six days earlier, not the next one.
    expect(mondayOf("2026-07-19")).toBe("2026-07-13")
  })

  it("clôt la semaine le dimanche", () => {
    expect(sundayOf("2026-07-21")).toBe("2026-07-26")
    expect(weekPeriod("2026-07-21")).toEqual({ start: "2026-07-20", end: "2026-07-26" })
  })

  it("produit toujours sept jours consécutifs", () => {
    const { start, end } = weekPeriod("2026-07-23")
    const days =
      (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000 + 1
    expect(days).toBe(7)
  })
})

describe("semaine ISO — numérotation", () => {
  it("numérote la semaine du 20 juillet 2026 en 30", () => {
    expect(isoWeekNumber("2026-07-20")).toBe(30)
    // Every day of that week carries the same number.
    for (const date of ["2026-07-20", "2026-07-22", "2026-07-26"]) {
      expect(isoWeekNumber(date)).toBe(30)
    }
    // The 27th starts week 31.
    expect(isoWeekNumber("2026-07-27")).toBe(31)
  })

  it("applique la règle du jeudi aux bascules d'année", () => {
    // 2027-01-01 is a Friday: it belongs to week 53 of ISO year 2026.
    expect(isoWeekNumber("2027-01-01")).toBe(53)
    expect(isoWeekYear("2027-01-01")).toBe(2026)
    // 2026-01-01 is a Thursday: week 1 of 2026.
    expect(isoWeekNumber("2026-01-01")).toBe(1)
    expect(isoWeekYear("2026-01-01")).toBe(2026)
  })
})

describe("semaine ISO — navigation", () => {
  it("avance et recule de semaine en semaine en restant sur le lundi", () => {
    expect(shiftWeeks("2026-07-21", 0)).toBe("2026-07-20")
    expect(shiftWeeks("2026-07-20", 1)).toBe("2026-07-27")
    expect(shiftWeeks("2026-07-20", -1)).toBe("2026-07-13")
    expect(isoWeekNumber(shiftWeeks("2026-07-20", 1))).toBe(31)
  })

  it("propose des semaines passées et futures, toutes alignées sur le lundi", () => {
    const options = listWeekOptions("2026-07-21", 2, 4)
    expect(options).toHaveLength(7)
    expect(options[0].value).toBe("2026-07-06")
    expect(options[2].value).toBe("2026-07-20")
    expect(options[2].weekNumber).toBe(30)
    expect(options[2].label).toBe("S30 · 20 juil. → 26 juil.")
    // Every option is a Monday and the numbers increase by one.
    for (const [index, option] of options.entries()) {
      expect(mondayOf(option.value)).toBe(option.value)
      if (index > 0) expect(option.weekNumber - options[index - 1].weekNumber).toBe(1)
    }
  })
})
