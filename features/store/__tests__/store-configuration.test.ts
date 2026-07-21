import { describe, expect, it } from "vitest"

import type { GeneralInformation, StoreConfiguration } from "@/features/store"
import {
  DEFAULT_STORE_CONFIGURATION,
  storeConfigurationService as svc,
} from "@/features/store"

const VALID_GENERAL: GeneralInformation = {
  name: "Test Store",
  timezone: "Europe/Paris",
  country: "France",
  currency: "EUR",
  weekStart: "monday",
}

/** A fully valid configuration built from the generic defaults. */
function validConfig(overrides: Partial<StoreConfiguration> = {}): StoreConfiguration {
  return svc.create({ general: VALID_GENERAL, ...overrides })
}

/** Does any validation issue point at `field`? */
function failsOn(config: StoreConfiguration, field: string): boolean {
  const result = svc.validate(config)
  return !result.success && result.error.issues.some((i) => i.path.join(".").includes(field))
}

describe("store configuration — defaults", () => {
  it("exposes sensible, generic defaults (no tenant-specific values)", () => {
    const d = DEFAULT_STORE_CONFIGURATION
    expect(d.general.name).toBe("") // generic, not a real store name
    expect(d.general.timezone).toBe("UTC")
    expect(d.general.country).toBe("")
    expect(d.planning.mode).toBe("dynamic")
    expect(d.planning.granularity).toBe(60)
    expect(d.scoring.feasibilityThreshold).toBe(0.6)
    expect(d.fairness.minCohortSize).toBe(2)
    expect(d.openingHours).toHaveLength(7)
    expect(d.openingHours.find((day) => day.day === "sunday")!.closed).toBe(true)
  })

  it("a configuration built on the defaults validates once given a name", () => {
    expect(svc.validate(validConfig()).success).toBe(true)
  })
})

describe("store configuration — validation of invalid values", () => {
  it("rejects a non-ISO currency", () => {
    expect(failsOn(validConfig({ general: { ...VALID_GENERAL, currency: "eur" } }), "currency")).toBe(
      true
    )
  })

  it("rejects a planning where max shift duration < min", () => {
    const planning = { ...DEFAULT_STORE_CONFIGURATION.planning, minShiftDuration: 600, maxShiftDuration: 120 }
    expect(failsOn(validConfig({ planning }), "maxShiftDuration")).toBe(true)
  })

  it("rejects an invalid granularity", () => {
    const planning = { ...DEFAULT_STORE_CONFIGURATION.planning, granularity: 45 as never }
    expect(failsOn(validConfig({ planning }), "granularity")).toBe(true)
  })

  it("rejects daily bounds where max < min", () => {
    const shift = { ...DEFAULT_STORE_CONFIGURATION.shift, minDailyDuration: 600, maxDailyDuration: 120 }
    expect(failsOn(validConfig({ shift }), "maxDailyDuration")).toBe(true)
  })
})

describe("store configuration — opening hours", () => {
  it("accepts multiple non-overlapping ranges in a day", () => {
    const openingHours = DEFAULT_STORE_CONFIGURATION.openingHours.map((day) =>
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
    )
    expect(svc.validate(validConfig({ openingHours })).success).toBe(true)
  })

  it("rejects overlapping ranges", () => {
    const openingHours = DEFAULT_STORE_CONFIGURATION.openingHours.map((day) =>
      day.day === "monday"
        ? {
            day: day.day,
            closed: false,
            ranges: [
              { start: "06:00", end: "13:00" },
              { start: "12:00", end: "20:00" }, // overlaps the previous
            ],
          }
        : day
    )
    expect(failsOn(validConfig({ openingHours }), "ranges")).toBe(true)
  })

  it("rejects an open day with no ranges", () => {
    const openingHours = DEFAULT_STORE_CONFIGURATION.openingHours.map((day) =>
      day.day === "monday" ? { day: day.day, closed: false, ranges: [] } : day
    )
    expect(failsOn(validConfig({ openingHours }), "ranges")).toBe(true)
  })
})

describe("store configuration — split shifts", () => {
  it("rejects an enabled split policy with max break < min break", () => {
    const splitShift = { enabled: true, minBreak: 120, maxBreak: 60, maxSplitShiftsPerEmployee: 2 }
    expect(failsOn(validConfig({ splitShift }), "maxBreak")).toBe(true)
  })

  it("ignores break bounds when split shifts are disabled", () => {
    const splitShift = { enabled: false, minBreak: 120, maxBreak: 60, maxSplitShiftsPerEmployee: 2 }
    expect(svc.validate(validConfig({ splitShift })).success).toBe(true)
  })
})

describe("store configuration — planning settings", () => {
  it("accepts each valid granularity", () => {
    for (const granularity of [15, 30, 60] as const) {
      const planning = { ...DEFAULT_STORE_CONFIGURATION.planning, granularity }
      expect(svc.validate(validConfig({ planning })).success).toBe(true)
    }
  })
})

describe("store configuration — engine mappers", () => {
  it("maps to a ScoringPolicy", () => {
    const config = validConfig({
      scoring: {
        weights: { coverage: 5, contract: 1, availability: 1, soft: 1 },
        warningCredit: 0.3,
        feasibilityThreshold: 0.7,
      },
    })
    const policy = svc.toScoringPolicy(config)
    expect(policy.weights.coverage).toBe(5)
    expect(policy.warningCredit).toBe(0.3)
    expect(policy.feasibilityThreshold).toBe(0.7)
    expect(policy.dimensionCategories.contract).toContain("workload")
  })

  it("maps to a FairnessPolicy, including extendable extra weights", () => {
    const config = validConfig({
      fairness: {
        weights: { workedHours: 2, opening: 1, closing: 1, weekend: 3, preferences: 1 },
        extraWeights: { saturday: 4 },
        imbalanceThreshold: 0.4,
        warningThreshold: 0.8,
        minCohortSize: 3,
      },
    })
    const policy = svc.toFairnessPolicy(config)
    expect(policy.dimensionWeights.worked_hours).toBe(2)
    expect(policy.dimensionWeights.weekend).toBe(3)
    expect(policy.dimensionWeights.preference).toBe(1)
    expect(policy.dimensionWeights.saturday).toBe(4) // future dimension, no code change
    expect(policy.warningFairnessThreshold).toBe(0.8)
    expect(policy.minCohortSize).toBe(3)
  })

  it("builds a configured constraint registry", () => {
    const registry = svc.toConstraintRegistry(validConfig())
    const ids = registry.all().map((c) => c.id)
    expect(ids).toContain("coverage.shift_coverage")
    expect(ids).toContain("availability.employee_availability")
    expect(registry.all()).toHaveLength(3)
  })

  it("maps to GenerationSettings carrying the config's mode and policies", () => {
    const config = validConfig()
    const settings = svc.toGenerationSettings(config, {
      planningId: "planning_1" as never,
      period: { start: "2026-07-06", end: "2026-07-12" },
      now: "2026-07-01T00:00:00.000Z",
    })
    expect(settings.mode).toBe(config.planning.mode)
    expect(settings.scoringPolicy).toEqual(svc.toScoringPolicy(config))
    expect(settings.fairnessPolicy).toEqual(svc.toFairnessPolicy(config))
  })
})
