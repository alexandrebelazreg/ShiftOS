import { describe, expect, it } from "vitest"
import { allocateDailyContractMinutes } from "@/features/core/planning-generator"

const DRIVE_DISTRIBUTION = { monday: 15, tuesday: 15, wednesday: 15, thursday: 15, friday: 22, saturday: 18, sunday: 0 } as const

describe("répartition contractuelle journalière", () => {
  it("utilise les plus forts restes avec un total exact et des pas de 15 minutes", () => {
    const first = allocateDailyContractMinutes(10_950, DRIVE_DISTRIBUTION), second = allocateDailyContractMinutes(10_950, DRIVE_DISTRIBUTION)
    expect(first).toEqual(second)
    expect(first.reduce((sum, target) => sum + target.targetMinutes, 0)).toBe(10_950)
    expect(first.every((target) => target.targetMinutes % 15 === 0)).toBe(true)
    expect(Object.fromEntries(first.map((target) => [target.day, target.targetMinutes]))).toEqual({ monday: 1_650, tuesday: 1_650, wednesday: 1_635, thursday: 1_635, friday: 2_415, saturday: 1_965, sunday: 0 })
  })
  it("refuse un total incompatible avec le pas configuré", () => { expect(() => allocateDailyContractMinutes(2_191, DRIVE_DISTRIBUTION)).toThrow(/multiple de 15/) })
})
