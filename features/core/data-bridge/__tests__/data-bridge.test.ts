import { describe, expect, it } from "vitest"

import { dataBridge } from "@/features/core/data-bridge"

import {
  bridgeInput,
  employeeRecord,
  storeConfiguration,
  storeInput,
} from "@/features/core/data-bridge/__tests__/fixtures"

describe("dataBridge.toPlanningInput", () => {
  it("maps a valid payload into core models", () => {
    const result = dataBridge.toPlanningInput(bridgeInput())
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const input = result.value
    // Store.
    expect(input.store.name).toBe("Test Store")
    expect(input.store.openingHours.find((d) => d.day === "monday")!.opensAt).toBe("09:00")
    expect(input.store.openingHours.find((d) => d.day === "sunday")!.closed).toBe(true)
    expect(input.store.splitShiftPolicy.kind).toBe("forbidden")

    // Employee + contract + capabilities + constraints.
    expect(input.employees).toHaveLength(1)
    expect(input.employees[0].capabilities).toContain("CAN_OPEN")
    expect(input.contracts).toHaveLength(1)
    expect(input.contracts[0].weeklyHours).toBe(35)
    expect(input.contracts[0].maxDailyHours).toBe(10) // 600 min / 60
    expect(input.employeeConstraints.some((c) => c.type === "FIXED_DAY_OFF")).toBe(true)

    // Demand.
    expect(input.demand.requirements).toHaveLength(1)
    expect(input.demand.requirements[0].window.date).toBe("2026-07-06")
  })

  it("flattens multiple opening ranges to a single open/close span", () => {
    const config = storeConfiguration({
      openingHours: storeConfiguration().openingHours.map((day) =>
        day.day === "monday"
          ? {
              day: day.day,
              closed: false,
              ranges: [
                { start: "06:00", end: "12:00" },
                { start: "13:00", end: "20:00" },
              ],
            }
          : day
      ),
    })
    const result = dataBridge.toPlanningInput(bridgeInput({ store: storeInput(config) }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const monday = result.value.store.openingHours.find((d) => d.day === "monday")!
    expect(monday.opensAt).toBe("06:00")
    expect(monday.closesAt).toBe("20:00")
  })

  it("reports a missing (unknown) employee referenced by an absence", () => {
    const result = dataBridge.toPlanningInput(
      bridgeInput({
        absences: [{ id: "ab1", employeeId: "ghost", start: "2026-07-07", end: "2026-07-08" }],
      })
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.some((e) => e.code === "invalid_reference" && e.id === "ab1")).toBe(true)
  })

  it("reports an invalid contract (non-positive weekly hours)", () => {
    const result = dataBridge.toPlanningInput(
      bridgeInput({ employees: [employeeRecord("e1", { weeklyHours: 0 })] })
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    const err = result.errors.find((e) => e.path.endsWith("weeklyHours"))!
    expect(err.code).toBe("invalid_value")
    expect(err.entity).toBe("contract")
  })

  it("reports an unknown capability required by demand", () => {
    const result = dataBridge.toPlanningInput(
      bridgeInput({
        demand: {
          id: "demand_1",
          requirements: [
            {
              id: "r1",
              date: "2026-07-06",
              start: "09:00",
              end: "17:00",
              minEmployees: 1,
              requiredCapabilities: ["CAN_FLY"],
            },
          ],
        },
      })
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.some((e) => e.code === "unknown_capability")).toBe(true)
  })

  it("reports an invalid availability rule range", () => {
    const result = dataBridge.toPlanningInput(
      bridgeInput({
        availabilityRules: [
          {
            id: "av1",
            employeeId: "e1",
            effect: "unavailable",
            kind: "date_range",
            range: { start: "2026-07-10", end: "2026-07-05" }, // end before start
          },
        ],
      })
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.some((e) => e.code === "invalid_date" && e.id === "av1")).toBe(true)
  })

  it("reports a partial store configuration (missing name)", () => {
    const result = dataBridge.toPlanningInput(
      bridgeInput({ store: storeInput(storeConfiguration({ general: {
        name: "",
        timezone: "UTC",
        country: "France",
        currency: "EUR",
        weekStart: "monday",
      } })) })
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(
      result.errors.some((e) => e.code === "missing_required" && e.path.includes("name"))
    ).toBe(true)
  })

  it("collects multiple errors in one pass and maps nothing on failure", () => {
    const result = dataBridge.toPlanningInput(
      bridgeInput({ employees: [employeeRecord("e1", { firstName: "", weeklyHours: -5 })] })
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.length).toBeGreaterThanOrEqual(2)
  })

  it("is deterministic for identical input", () => {
    expect(dataBridge.toPlanningInput(bridgeInput())).toEqual(
      dataBridge.toPlanningInput(bridgeInput())
    )
  })
})
