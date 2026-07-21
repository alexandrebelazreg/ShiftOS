import { describe, expect, it } from "vitest"

import type { Period } from "@/features/core/employee-engine/types"
import { workedHoursCalculator } from "@/features/core/employee-engine/calculators/worked-hours"

import {
  EMP,
  OTHER_EMP,
  assignment,
  brand,
  segment,
  shift,
} from "@/features/core/employee-engine/calculators/__tests__/fixtures"
import type { Shift } from "@/features/core/models"

const period: Period = { start: "2026-07-01", end: "2026-07-31" }

describe("workedHoursCalculator", () => {
  it("returns zeros for an empty planning", () => {
    const result = workedHoursCalculator.calculate(EMP, [], [], period)

    expect(result.totalMinutes).toBe(0)
    expect(result.totalHours).toBe(0)
    expect(result.byDay).toEqual([])
    expect(result.byWeek).toEqual([])
    expect(result.byMonth).toEqual([])
    expect(result.issues).toEqual([])
  })

  it("computes a single normal shift", () => {
    const s = shift("a", "2026-07-06", [segment("09:00", "17:30")]) // 8h30 = 510 min
    const result = workedHoursCalculator.calculate(EMP, [assignment(s.id)], [s], period)

    expect(result.totalMinutes).toBe(510)
    expect(result.totalHours).toBe(510 / 60) // exact, unrounded
    expect(result.byDay).toEqual([
      { date: "2026-07-06", minutes: 510, hours: 510 / 60 },
    ])
  })

  it("sums multiple shifts and groups by day, week and month", () => {
    const s1 = shift("a", "2026-07-06", [segment("09:00", "12:00")]) // Mon, 180
    const s2 = shift("b", "2026-07-06", [segment("13:00", "17:00")]) // Mon same day, 240
    const s3 = shift("c", "2026-07-13", [segment("09:00", "10:00")]) // next week, 60
    const s4 = shift("d", "2026-08-03", [segment("09:00", "11:00")]) // out of period
    const shifts = [s1, s2, s3, s4]
    const assignments = shifts.map((s) => assignment(s.id))

    const result = workedHoursCalculator.calculate(EMP, assignments, shifts, period)

    // s4 is outside the period → excluded.
    expect(result.totalMinutes).toBe(180 + 240 + 60)
    expect(result.byDay).toEqual([
      { date: "2026-07-06", minutes: 420, hours: 420 / 60 },
      { date: "2026-07-13", minutes: 60, hours: 1 },
    ])
    expect(result.byWeek.map((w) => [w.isoWeek, w.minutes])).toEqual([
      ["2026-W28", 420],
      ["2026-W29", 60],
    ])
    expect(result.byMonth).toEqual([
      { month: "2026-07", minutes: 480, hours: 8 },
    ])
    expect(result.issues).toEqual([])
  })

  it("counts an overnight (cross-day) shift via endDayOffset", () => {
    // 22:00 → 06:00 next day = 8h; attributed to the shift's start date.
    const s = shift("night", "2026-07-06", [segment("22:00", "06:00", 1)])
    const result = workedHoursCalculator.calculate(EMP, [assignment(s.id)], [s], period)

    expect(result.totalMinutes).toBe(480)
    expect(result.byDay).toEqual([{ date: "2026-07-06", minutes: 480, hours: 8 }])
    expect(result.issues).toEqual([])
  })

  it("adds every segment of a split shift", () => {
    const s = shift("split", "2026-07-07", [
      segment("08:00", "12:00"), // 240
      segment("17:00", "20:30"), // 210
    ])
    const result = workedHoursCalculator.calculate(EMP, [assignment(s.id)], [s], period)

    expect(result.totalMinutes).toBe(450)
    expect(result.byDay[0]).toEqual({
      date: "2026-07-07",
      minutes: 450,
      hours: 450 / 60,
    })
  })

  it("ignores assignments belonging to another employee", () => {
    const s = shift("a", "2026-07-06", [segment("09:00", "17:00")])
    const result = workedHoursCalculator.calculate(
      EMP,
      [assignment(s.id, OTHER_EMP)],
      [s],
      period
    )

    expect(result.totalMinutes).toBe(0)
    expect(result.issues).toEqual([])
  })

  it("reports invalid data without throwing", () => {
    const good = shift("good", "2026-07-06", [segment("09:00", "17:00")]) // 480
    const bad = shift("bad", "2026-07-07", [
      segment("18:00", "09:00"), // end <= start → invalid
      segment("aa:bb", "10:00"), // malformed → invalid
    ])
    const missingShiftId = brand<Shift["id"]>("shift_missing")

    const result = workedHoursCalculator.calculate(
      EMP,
      [assignment(good.id), assignment(bad.id), assignment(missingShiftId)],
      [good, bad], // "missing" shift intentionally absent
      period
    )

    // Only the valid shift contributes.
    expect(result.totalMinutes).toBe(480)
    const codes = result.issues.map((i) => i.code).sort()
    expect(codes).toEqual(["invalid_segment", "invalid_segment", "shift_not_found"])
  })
})
