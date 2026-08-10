import { describe, expect, it } from "vitest"

import {
  buildDashboardAbsenceSummary,
  formatDateRange,
} from "@/features/absences/dashboard/absence-summary"
import type { AbsenceRecord } from "@/features/absences/types/absence-record"
import type { IsoDate } from "@/features/core/models"
import type { EmployeeRecord } from "@/features/employees/types/employee.types"

const employees = [
  { id: "alice", firstName: "Alice", lastName: "Martin" },
  { id: "bruno", firstName: "Bruno", lastName: "Petit" },
  { id: "clara", firstName: "Clara", lastName: "Roux" },
] as EmployeeRecord[]

function absence(
  id: string,
  employeeId: string,
  type: AbsenceRecord["type"],
  start: string,
  end = start
): AbsenceRecord {
  return { id, employeeId, type, start, end }
}

describe("récapitulatif des congés et absences", () => {
  it("sépare les congés en cours, les départs S+1 et les autres absences", () => {
    const summary = buildDashboardAbsenceSummary(
      "2026-08-05" as IsoDate,
      employees,
      [
        absence("current", "alice", "paid_leave", "2026-08-03", "2026-08-07"),
        absence("next", "bruno", "unpaid_leave", "2026-08-11", "2026-08-14"),
        absence("sick", "clara", "sick_leave", "2026-08-06"),
        absence("training-next", "clara", "training", "2026-08-12"),
      ]
    )

    expect(summary.currentLeave.map((item) => item.id)).toEqual(["current"])
    expect(summary.nextWeekLeaveDepartures.map((item) => item.id)).toEqual(["next"])
    expect(summary.otherCurrentWeekAbsences.map((item) => item.id)).toEqual(["sick"])
    expect(summary.currentLeave[0]).toMatchObject({
      employeeName: "Alice Martin",
      typeLabel: "Congé payé",
    })
  })

  it("compte un départ uniquement à sa date de début", () => {
    const summary = buildDashboardAbsenceSummary(
      "2026-08-05" as IsoDate,
      employees,
      [absence("long", "alice", "paid_leave", "2026-08-01", "2026-08-12")]
    )

    expect(summary.currentLeave).toHaveLength(1)
    expect(summary.nextWeekLeaveDepartures).toHaveLength(0)
  })

  it("formate les périodes en français", () => {
    expect(formatDateRange("2026-08-03", "2026-08-03")).toBe("3 août")
    expect(formatDateRange("2026-08-03", "2026-08-09")).toBe("3 août – 9 août")
  })

  it("affiche un motif futur sans supprimer l’absence", () => {
    const summary = buildDashboardAbsenceSummary(
      "2026-08-05" as IsoDate,
      employees,
      [absence("future-type", "alice", "jury_duty", "2026-08-05")]
    )

    expect(summary.otherCurrentWeekAbsences[0]).toMatchObject({
      id: "future-type",
      typeLabel: "Autre absence",
    })
  })
})
