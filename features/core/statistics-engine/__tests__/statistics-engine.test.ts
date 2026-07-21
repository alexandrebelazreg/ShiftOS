import { describe, expect, it } from "vitest"

import type { Coverage } from "@/features/core/demand-engine"
import type { StatisticsInput } from "@/features/core/statistics-engine"
import { statisticsService } from "@/features/core/statistics-engine"

import {
  PERIOD,
  STORE_ID,
  absence,
  assignment,
  brand,
  employee,
  holiday,
  planning,
  shift,
  store,
} from "@/features/core/statistics-engine/__tests__/fixtures"
import type { DemandId } from "@/features/core/demand-engine"

const MON = "2026-07-06"
const TUE = "2026-07-07"
const WED = "2026-07-08"
const SAT = "2026-07-11"
const SUN = "2026-07-12"

function makeInput(
  employees: ReturnType<typeof employee>[],
  shifts: ReturnType<typeof shift>[],
  assignments: ReturnType<typeof assignment>[],
  extra: Partial<Pick<StatisticsInput, "coverage">> & {
    holidays?: ReturnType<typeof holiday>[]
    absences?: ReturnType<typeof absence>[]
  } = {}
): StatisticsInput {
  return {
    planning: planning(),
    employees,
    assignments,
    shifts,
    store: store(),
    calendar: { holidays: extra.holidays ?? [], absences: extra.absences ?? [] },
    coverage: extra.coverage,
  }
}

const only = <T>(list: readonly T[]): T => list[0]

describe("statisticsService", () => {
  it("returns zeros for an empty planning", () => {
    const report = statisticsService.compute(makeInput([employee("e1")], [], []))

    const e1 = only(report.employees)
    expect(e1.workedMinutes).toBe(0)
    expect(e1.workedHours).toBe(0)
    expect(e1.workedDays).toBe(0)
    expect(e1.assignmentCount).toBe(0)
    expect(e1.coverageContribution).toBe(0)

    expect(report.planning.totalWorkedHours).toBe(0)
    expect(report.planning.assignmentCount).toBe(0)
    expect(report.planning.employeeCount).toBe(0)
    expect(report.planning.averageWorkedHours).toBe(0)
    expect(report.planning.planningDurationDays).toBe(7) // Mon–Sun inclusive
    expect(report.planning.coverageRate).toBeNull()

    expect(report.store.generatedShifts).toBe(0)
    expect(report.store.assignmentCount).toBe(0)
    expect(report.store.coverageGaps).toBe(0)
  })

  it("computes a single employee's worked time and days", () => {
    const report = statisticsService.compute(
      makeInput(
        [employee("e1")],
        [shift("s1", MON)], // 09:00–17:00 = 8h
        [assignment("a1", "e1", "s1")]
      )
    )

    const e1 = only(report.employees)
    expect(e1.workedMinutes).toBe(480)
    expect(e1.workedHours).toBe(8)
    expect(e1.workedDays).toBe(1)
    expect(e1.assignmentCount).toBe(1)
    expect(e1.openingCount).toBe(0) // starts 09:00, store opens 08:00
    expect(e1.closingCount).toBe(0) // ends 17:00, store closes 20:00
    expect(e1.coverageContribution).toBe(1) // sole assignment

    expect(report.planning.totalWorkedHours).toBe(8)
    expect(report.planning.employeeCount).toBe(1)
    expect(report.planning.averageWorkedHours).toBe(8)
    expect(report.store.generatedShifts).toBe(1)
  })

  it("detects opening and closing shifts against the store schedule", () => {
    const report = statisticsService.compute(
      makeInput(
        [employee("e1")],
        [
          shift("open", MON, [{ startTime: "08:00", endTime: "12:00" }]), // opens the store
          shift("close", TUE, [{ startTime: "16:00", endTime: "20:00" }]), // closes the store
        ],
        [assignment("a1", "e1", "open"), assignment("a2", "e1", "close")]
      )
    )

    const e1 = only(report.employees)
    expect(e1.openingCount).toBe(1)
    expect(e1.closingCount).toBe(1)
  })

  it("aggregates multiple employees and their coverage contribution", () => {
    const report = statisticsService.compute(
      makeInput(
        [employee("e1"), employee("e2")],
        [shift("s1", MON), shift("s2", TUE), shift("s3", WED)],
        [
          assignment("a1", "e1", "s1"),
          assignment("a2", "e1", "s2"),
          assignment("a3", "e2", "s3"),
        ]
      )
    )

    const e1 = report.employees.find((e) => e.employeeId === brand("e1"))!
    const e2 = report.employees.find((e) => e.employeeId === brand("e2"))!
    expect(e1.assignmentCount).toBe(2)
    expect(e1.workedHours).toBe(16)
    expect(e1.coverageContribution).toBeCloseTo(0.6667, 4)
    expect(e2.assignmentCount).toBe(1)
    expect(e2.coverageContribution).toBeCloseTo(0.3333, 4)

    expect(report.planning.totalWorkedHours).toBe(24)
    expect(report.planning.assignmentCount).toBe(3)
    expect(report.planning.employeeCount).toBe(2)
    expect(report.planning.averageWorkedHours).toBe(12)
    expect(report.store.generatedShifts).toBe(3)
    expect(report.store.assignmentCount).toBe(3)
  })

  it("counts night shifts (segments crossing midnight)", () => {
    const report = statisticsService.compute(
      makeInput(
        [employee("e1")],
        [shift("night", MON, [{ startTime: "22:00", endTime: "06:00", endDayOffset: 1 }])],
        [assignment("a1", "e1", "night")]
      )
    )

    const e1 = only(report.employees)
    expect(e1.nightShiftCount).toBe(1)
    expect(e1.workedMinutes).toBe(480) // 22:00 → 06:00 next day
  })

  it("counts weekend, Saturday and Sunday shifts", () => {
    const report = statisticsService.compute(
      makeInput(
        [employee("e1")],
        [shift("sat", SAT), shift("sun", SUN)],
        [assignment("a1", "e1", "sat"), assignment("a2", "e1", "sun")]
      )
    )

    const e1 = only(report.employees)
    expect(e1.saturdayCount).toBe(1)
    expect(e1.sundayCount).toBe(1)
    expect(e1.weekendCount).toBe(2)
  })

  it("counts split shifts (two or more segments)", () => {
    const report = statisticsService.compute(
      makeInput(
        [employee("e1")],
        [
          shift("split", MON, [
            { startTime: "08:00", endTime: "12:00" },
            { startTime: "14:00", endTime: "18:00" },
          ]),
        ],
        [assignment("a1", "e1", "split")]
      )
    )

    const e1 = only(report.employees)
    expect(e1.splitShiftCount).toBe(1)
    expect(e1.workedMinutes).toBe(480) // 240 + 240
  })

  it("counts worked public holidays", () => {
    const report = statisticsService.compute(
      makeInput(
        [employee("e1")],
        [shift("s1", MON)],
        [assignment("a1", "e1", "s1")],
        { holidays: [holiday("h1", MON)] }
      )
    )

    expect(only(report.employees).holidayCount).toBe(1)
  })

  it("counts absence days within the period", () => {
    const report = statisticsService.compute(
      makeInput(
        [employee("e1")],
        [],
        [],
        { absences: [absence("ab1", "e1", TUE, WED)] } // 2 days
      )
    )

    expect(only(report.employees).absenceCount).toBe(2)
  })

  it("reads coverage rate and gaps from the demand engine's coverage", () => {
    const coverage: Coverage = {
      demandId: brand<DemandId>("demand_1"),
      results: [],
      gaps: [
        { requirementId: brand("r1") } as never,
        { requirementId: brand("r2") } as never,
      ],
      statistics: {
        totalRequirements: 4,
        covered: 2,
        underCovered: 2,
        overCovered: 0,
        requirementsWithMissingCapabilities: 0,
        totalRequiredMin: 4,
        totalAssigned: 2,
        overallCoveragePercentage: 0.5,
      },
    }

    const report = statisticsService.compute(
      makeInput([employee("e1")], [shift("s1", MON)], [assignment("a1", "e1", "s1")], { coverage })
    )

    expect(report.planning.coverageRate).toBe(0.5)
    expect(report.store.coverageRate).toBe(0.5)
    expect(report.store.coverageGaps).toBe(2)
  })

  it("is deterministic for identical input", () => {
    const build = () =>
      makeInput(
        [employee("e1"), employee("e2")],
        [shift("s1", MON), shift("s2", SAT)],
        [assignment("a1", "e1", "s1"), assignment("a2", "e2", "s2")]
      )

    expect(statisticsService.compute(build())).toEqual(statisticsService.compute(build()))
    // Store id surfaced correctly.
    expect(statisticsService.compute(build()).store.storeId).toBe(STORE_ID)
    // Period echoed on employee stats.
    expect(statisticsService.compute(build()).employees[0].period).toEqual(PERIOD)
  })
})
