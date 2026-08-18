import { describe, expect, it } from "vitest"

import {
  buildAbsenceAlerts,
  hasAlerts,
} from "@/features/absences/alerts/absence-alerts"
import {
  buildAbsenceMonth,
  buildYearCounters,
} from "@/features/absences/calendar/absence-month"
import {
  ABSENCE_MOTIVE_DEFAULTS,
  SELECTABLE_ABSENCE_MOTIVES,
  absenceMotiveDefinition,
} from "@/features/absences/models/absence-motive"
import {
  absenceCoversDate,
  absenceOverlaps,
  absencePeriodLabel,
  absentEmployeeIds,
} from "@/features/absences/models/absence-period"
import type { AbsenceRecord } from "@/features/absences/types/absence-record"
import type { EmployeeRecord } from "@/features/employees/types/employee.types"
import type { PlanningSummary } from "@/features/planning/persistence/planning-record"

function absence(patch: Partial<AbsenceRecord> & { id: string }): AbsenceRecord {
  return {
    employeeId: "1",
    type: "sick_leave",
    start: "2026-03-09",
    end: "2026-03-13",
    ...patch,
  }
}

function employee(id: string, firstName: string, lastName: string): EmployeeRecord {
  return { id, firstName, lastName } as unknown as EmployeeRecord
}

const openAllWeek = () => true

describe("le catalogue des motifs", () => {
  it("porte les treize motifs décidés, et pas un de plus", () => {
    expect(ABSENCE_MOTIVE_DEFAULTS).toHaveLength(13)
    expect(ABSENCE_MOTIVE_DEFAULTS.map((motive) => motive.value)).toEqual([
      "sick_leave",
      "work_accident",
      "maternity",
      "parental_leave",
      "family_event",
      "unpaid_leave",
      "training",
      "delegation",
      "unjustified",
      "paid_leave",
      "rest_day",
      "public_holiday",
      "other",
    ])
  })

  it("ne propose pas à la saisie ce qui se déduit d’un autre écran", () => {
    // Le jour férié figure au catalogue — c'est lui qui donne son libellé à la
    // ligne affichée — mais le proposer inviterait à écrire à la main ce qui se
    // coche dans l'écran des jours fériés.
    expect(absenceMotiveDefinition("public_holiday").label).toBe("Jour férié")
    expect(SELECTABLE_ABSENCE_MOTIVES.map((motive) => motive.value)).not.toContain(
      "public_holiday"
    )
    expect(SELECTABLE_ABSENCE_MOTIVES).toHaveLength(12)
  })

  it("n’attend aucun papier pour un repos : rien n’était prévu ce jour-là", () => {
    expect(absenceMotiveDefinition("rest_day")).toMatchObject({
      label: "Repos",
      hours: "deducted",
      proof: null,
    })
  })

  it("applique le tableau des heures validé", () => {
    const hours = (type: string) => absenceMotiveDefinition(type).hours
    expect(hours("sick_leave")).toBe("maintained")
    expect(hours("work_accident")).toBe("maintained")
    expect(hours("maternity")).toBe("maintained")
    expect(hours("family_event")).toBe("maintained")
    expect(hours("paid_leave")).toBe("maintained")
    expect(hours("parental_leave")).toBe("deducted")
    expect(hours("unpaid_leave")).toBe("deducted")
    expect(hours("unjustified")).toBe("deducted")
    expect(hours("training")).toBe("worked")
    expect(hours("delegation")).toBe("worked")
  })

  it("n'attend aucun papier de l'absence injustifiée", () => {
    // C'est ce qui la définit. En réclamer un afficherait une alerte permanente
    // sur la seule absence dont on sait qu'aucun papier ne viendra.
    expect(absenceMotiveDefinition("unjustified").proof).toBeNull()
    expect(absenceMotiveDefinition("sick_leave").proof).toEqual({
      label: "Arrêt de travail",
      dueDays: 2,
    })
  })

  it("ne compte qu'un seul motif en heures", () => {
    const inHours = ABSENCE_MOTIVE_DEFAULTS.filter((motive) => motive.countedInHours)
    expect(inHours.map((motive) => motive.value)).toEqual(["delegation"])
  })

  it("relit un motif inconnu comme « Autre », sans faire disparaître l'absence", () => {
    expect(absenceMotiveDefinition("temporary_unavailability").label).toBe("Autre absence")
  })
})

describe("la lecture des dates", () => {
  it("couvre ses bornes, et rien au-delà", () => {
    const record = absence({ id: "a" })
    expect(absenceCoversDate(record, "2026-03-09")).toBe(true)
    expect(absenceCoversDate(record, "2026-03-13")).toBe(true)
    expect(absenceCoversDate(record, "2026-03-08")).toBe(false)
    expect(absenceCoversDate(record, "2026-03-14")).toBe(false)
  })

  it("suit la fin repoussée par une prolongation", () => {
    // Ce qui remplace la « fin inconnue » : l'arrêt porte la date de son papier,
    // et la prolongation repousse cette date le jour où elle arrive.
    const extended = absence({
      id: "a",
      end: "2026-03-20",
      extensions: [{ previousEnd: "2026-03-13", newEnd: "2026-03-20", recordedOn: "2026-03-12" }],
    })
    expect(absenceCoversDate(extended, "2026-03-18")).toBe(true)
    expect(absenceCoversDate(extended, "2026-03-21")).toBe(false)
    expect(absenceOverlaps(extended, "2026-03-16", "2026-03-22")).toBe(true)
  })

  it("ne retire plus personne une fois annulée", () => {
    const cancelled = absence({ id: "a", status: "cancelled" })
    expect(absenceCoversDate(cancelled, "2026-03-10")).toBe(false)
    expect(absenceOverlaps(cancelled, "2026-03-01", "2026-03-31")).toBe(false)
    expect(absentEmployeeIds([cancelled], "2026-03-10").size).toBe(0)
  })

  it("n'écrit pas « du 9 au 9 » pour une seule journée", () => {
    expect(absencePeriodLabel(absence({ id: "a" }))).toBe("du 09/03/2026 au 13/03/2026")
    expect(absencePeriodLabel(absence({ id: "a", end: "2026-03-09" }))).toBe("le 09/03/2026")
    expect(
      absencePeriodLabel(absence({ id: "a", end: "2026-03-09", halfDay: "afternoon" }))
    ).toBe("le 09/03/2026 (après-midi)")
  })
})

describe("le mois des absences", () => {
  const employees = [employee("2", "Bruno", "Sala"), employee("1", "Adeline", "Roche")]

  it("range les salariés par nom et donne un jour par colonne", () => {
    const month = buildAbsenceMonth({
      year: 2026,
      month: 3,
      employees,
      absences: [],
      opensOn: openAllWeek,
    })
    expect(month.title).toBe("Mars 2026")
    expect(month.days).toHaveLength(31)
    expect(month.days[0].label).toBe("1")
    expect(month.rows.map((row) => row.name)).toEqual(["Adeline Roche", "Bruno Sala"])
  })

  it("remplit les cases couvertes, et elles seules", () => {
    const month = buildAbsenceMonth({
      year: 2026,
      month: 3,
      employees,
      absences: [absence({ id: "a", employeeId: "1" })],
      opensOn: openAllWeek,
    })
    const adeline = month.rows[0]
    expect(adeline.cells[7].absence).toBeNull()
    expect(adeline.cells[8].motiveLabel).toBe("Maladie")
    expect(adeline.cells[12].motiveLabel).toBe("Maladie")
    expect(adeline.cells[13].absence).toBeNull()
    expect(month.rows[1].cells.every((cell) => cell.absence === null)).toBe(true)
  })

  it("compte une demi-journée pour une demie", () => {
    const month = buildAbsenceMonth({
      year: 2026,
      month: 3,
      employees,
      absences: [
        absence({ id: "a", employeeId: "1", start: "2026-03-09", end: "2026-03-09", halfDay: "afternoon" }),
      ],
      opensOn: openAllWeek,
    })
    expect(month.rows[0].daysOff).toBe(0.5)
  })

  it("montre les congés de campagne sans permettre d'y toucher", () => {
    const month = buildAbsenceMonth({
      year: 2026,
      month: 3,
      employees,
      absences: [
        absence({
          id: "validated-paid-leave:1:2026-W11",
          employeeId: "1",
          type: "paid_leave",
        }),
      ],
      opensOn: openAllWeek,
    })
    expect(month.rows[0].cells[9].locked).toBe(true)
    expect(month.rows[0].cells[9].motiveLabel).toBe("Congé payé")
  })

  it("grise les jours où le magasin n'ouvre pas", () => {
    const month = buildAbsenceMonth({
      year: 2026,
      month: 3,
      employees,
      absences: [],
      opensOn: (day) => day !== "sunday",
    })
    // Le 1er mars 2026 est un dimanche.
    expect(month.days[0].open).toBe(false)
    expect(month.days[1].open).toBe(true)
  })
})

describe("les compteurs de l'année", () => {
  it("additionne par motif, la demi-journée pour une demie", () => {
    const counters = buildYearCounters(2026, [
      absence({ id: "a", start: "2026-03-09", end: "2026-03-13" }),
      absence({ id: "b", start: "2026-05-04", end: "2026-05-04", halfDay: "morning" }),
      absence({ id: "c", type: "training", start: "2026-06-01", end: "2026-06-02" }),
    ])
    expect(counters).toEqual([
      { type: "sick_leave", label: "Maladie", days: 5.5, hours: 0 },
      { type: "training", label: "Formation", days: 2, hours: 0 },
    ])
  })

  it("compte la délégation en heures, jamais en journées", () => {
    const counters = buildYearCounters(2026, [
      absence({ id: "a", type: "delegation", start: "2026-03-09", end: "2026-03-09", hours: 2 }),
      absence({ id: "b", type: "delegation", start: "2026-04-09", end: "2026-04-09", hours: 3.5 }),
    ])
    expect(counters).toEqual([
      { type: "delegation", label: "Heures de délégation", days: 0, hours: 5.5 },
    ])
  })

  it("ne compte d'une absence à cheval que les journées de l'année", () => {
    const counters = buildYearCounters(2026, [
      absence({ id: "a", start: "2026-12-28", end: "2027-01-06" }),
    ])
    expect(counters[0].days).toBe(4)
  })

  it("ignore les absences annulées et les autres années", () => {
    const counters = buildYearCounters(2026, [
      absence({ id: "a", status: "cancelled" }),
      absence({ id: "b", start: "2025-03-09", end: "2025-03-13" }),
    ])
    expect(counters).toEqual([])
  })
})

describe("le bandeau", () => {
  const names = new Map([["1", "Adeline Roche"]])
  const planning = (patch: Partial<PlanningSummary>): PlanningSummary => ({
    id: "p1",
    status: "published",
    label: "Semaine 11",
    periodStart: "2026-03-09",
    periodEnd: "2026-03-15",
    updatedAt: "2026-03-01T09:00:00.000Z",
    ...patch,
  })

  it("ne dit rien quand il n'y a rien à dire", () => {
    const alerts = buildAbsenceAlerts({
      today: "2026-03-10",
      absences: [],
      plannings: [planning({})],
      employeeNames: names,
    })
    expect(hasAlerts(alerts)).toBe(false)
  })

  it("signale une absence tombant sur un planning déjà fait", () => {
    const alerts = buildAbsenceAlerts({
      today: "2026-03-10",
      absences: [absence({ id: "a" })],
      plannings: [planning({})],
      employeeNames: names,
    })
    expect(alerts.onPlannedWeeks).toHaveLength(1)
    expect(alerts.onPlannedWeeks[0].employeeName).toBe("Adeline Roche")
    expect(alerts.onPlannedWeeks[0].plannings).toEqual([
      { label: "Semaine 11", published: true },
    ])
  })

  it("ignore les plannings archivés, sur lesquels plus rien ne se décide", () => {
    const alerts = buildAbsenceAlerts({
      today: "2026-03-10",
      absences: [absence({ id: "a" })],
      plannings: [planning({ status: "archived" })],
      employeeNames: names,
    })
    expect(alerts.onPlannedWeeks).toEqual([])
  })

  it("réclame un justificatif en retard, jamais un justificatif reçu", () => {
    const late = buildAbsenceAlerts({
      today: "2026-03-15",
      absences: [absence({ id: "a", proofDueOn: "2026-03-11" })],
      plannings: [],
      employeeNames: names,
    })
    expect(late.lateProofs).toHaveLength(1)
    expect(late.lateProofs[0].proofLabel).toBe("Arrêt de travail")
    expect(late.lateProofs[0].lateDays).toBe(4)

    const received = buildAbsenceAlerts({
      today: "2026-03-15",
      absences: [absence({ id: "a", proofDueOn: "2026-03-11", proofReceivedOn: "2026-03-10" })],
      plannings: [],
      employeeNames: names,
    })
    expect(received.lateProofs).toEqual([])
  })

  it("ne réclame rien avant l'échéance", () => {
    const alerts = buildAbsenceAlerts({
      today: "2026-03-10",
      absences: [absence({ id: "a", proofDueOn: "2026-03-11" })],
      plannings: [],
      employeeNames: names,
    })
    expect(alerts.lateProofs).toEqual([])
  })
})
