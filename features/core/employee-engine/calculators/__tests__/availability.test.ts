import { describe, expect, it } from "vitest"

import type { WeekDay } from "@/features/core/models"
import type { Period } from "@/features/core/employee-engine/types"
import { availabilityCalculator } from "@/features/core/employee-engine/calculators/availability"
import type { AvailabilityInput } from "@/features/core/employee-engine/calculators/availability-calculator"
import type {
  DailyAvailability,
  EmployeeAvailability,
} from "@/features/core/employee-engine/models"

import {
  ALL_DAYS,
  EMP,
  OTHER_EMP,
  absence,
  contract,
  dateRule,
  dayConstraint,
  daySchedule,
  holiday,
  recurringRule,
  store,
} from "@/features/core/employee-engine/calculators/__tests__/fixtures"

// A run of 7 consecutive days → every week day appears exactly once.
const period: Period = { start: "2026-07-06", end: "2026-07-12" }

function calc(over: Partial<AvailabilityInput> = {}): EmployeeAvailability {
  return availabilityCalculator.calculate({
    employeeId: EMP,
    period,
    store: store(),
    contract: contract(ALL_DAYS),
    constraints: [],
    availabilityRules: [],
    absences: [],
    holidays: [],
    ...over,
  })
}

function onDay(result: EmployeeAvailability, day: WeekDay): DailyAvailability {
  const found = result.days.find((d) => d.weekDay === day)
  if (!found) throw new Error(`missing week day ${day}`)
  return found
}

/** The concrete date of a given week day within `period`. */
const DATE_OF: Record<WeekDay, string> = Object.fromEntries(
  calc().days.map((d) => [d.weekDay, d.date])
) as Record<WeekDay, string>

describe("availabilityCalculator", () => {
  it("returns one entry per calendar date in the period", () => {
    const result = calc()
    expect(result.days).toHaveLength(7)
    expect(result.employeeId).toBe(EMP)
    expect(result.period).toBe(period)
  })

  it("marks a working, open, unconstrained day available with the store window", () => {
    expect(onDay(calc(), "monday")).toMatchObject({
      weekDay: "monday",
      status: "available",
      windows: [{ start: "09:00", end: "18:00" }],
    })
  })

  it("marks a non-working day unavailable (not_a_working_day)", () => {
    const result = calc({ contract: contract(["monday"]) })
    const tuesday = onDay(result, "tuesday")
    expect(tuesday.status).toBe("unavailable")
    expect(tuesday.unavailableReason).toBe("not_a_working_day")
    expect(tuesday.windows).toEqual([])
  })

  it("treats a closed store day as unavailable (store_closed)", () => {
    const result = calc({ store: store({ monday: daySchedule("monday", null, null) }) })
    expect(onDay(result, "monday").unavailableReason).toBe("store_closed")
  })

  it("marks a public holiday unavailable (public_holiday)", () => {
    const result = calc({ holidays: [holiday(DATE_OF.monday)] })
    expect(onDay(result, "monday").unavailableReason).toBe("public_holiday")
  })

  it("marks an absence period unavailable (absence)", () => {
    const result = calc({
      absences: [absence("sick_leave", DATE_OF.tuesday, DATE_OF.thursday)],
    })
    expect(onDay(result, "tuesday").unavailableReason).toBe("absence")
    expect(onDay(result, "wednesday").unavailableReason).toBe("absence")
    expect(onDay(result, "thursday").unavailableReason).toBe("absence")
    expect(onDay(result, "friday").status).toBe("available")
  })

  it("applies a one-day unavailability exception (date_exception)", () => {
    const result = calc({ availabilityRules: [dateRule(DATE_OF.wednesday, "unavailable")] })
    expect(onDay(result, "wednesday").unavailableReason).toBe("date_exception")
    expect(onDay(result, "tuesday").status).toBe("available")
  })

  it("applies exceptional one-day availability on a non-working day", () => {
    const result = calc({
      contract: contract(["monday"]), // saturday is not a working day…
      availabilityRules: [dateRule(DATE_OF.saturday, "available")], // …but explicitly available
    })
    expect(onDay(result, "saturday").status).toBe("available")
  })

  it("supports recurring availability adding a week day, and removing one", () => {
    const added = calc({
      contract: contract(["monday"]),
      availabilityRules: [recurringRule("saturday", "available")],
    })
    expect(onDay(added, "saturday").status).toBe("available")

    const removed = calc({
      contract: contract(["monday", "saturday"]),
      availabilityRules: [recurringRule("saturday", "unavailable")],
    })
    expect(onDay(removed, "saturday").unavailableReason).toBe("not_a_working_day")
  })

  it("marks every open day unavailable when the contract is missing", () => {
    const result = calc({ contract: null })
    expect(onDay(result, "monday").unavailableReason).toBe("missing_contract")
    expect(result.days.every((d) => d.status === "unavailable")).toBe(true)
  })

  it("respects fixed day off and forbidden day constraints", () => {
    const result = calc({
      constraints: [
        dayConstraint("monday", "FIXED_DAY_OFF"),
        dayConstraint("tuesday", "FORBIDDEN_DAY"),
      ],
    })
    expect(onDay(result, "monday").unavailableReason).toBe("fixed_day_off")
    expect(onDay(result, "tuesday").unavailableReason).toBe("forbidden_day")
  })

  it("gives a holiday precedence over an absence on the same day", () => {
    const result = calc({
      holidays: [holiday(DATE_OF.monday)],
      absences: [absence("paid_leave", DATE_OF.monday, DATE_OF.monday)],
    })
    expect(onDay(result, "monday").unavailableReason).toBe("public_holiday")
  })

  it("ignores absences and constraints belonging to another employee", () => {
    const result = calc({
      absences: [absence("sick_leave", DATE_OF.monday, DATE_OF.monday, OTHER_EMP)],
      constraints: [dayConstraint("tuesday", "FORBIDDEN_DAY", OTHER_EMP)],
    })
    expect(onDay(result, "monday").status).toBe("available")
    expect(onDay(result, "tuesday").status).toBe("available")
  })
})
