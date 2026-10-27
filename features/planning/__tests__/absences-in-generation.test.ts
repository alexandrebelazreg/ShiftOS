import { describe, expect, it } from "vitest"

import type { HolidayPlanEntry, IsoDate } from "@/features/core/models"
import { buildPlanningProblemV3 } from "@/features/core/planning-v3/problem-builder"
import type { AbsenceRecord } from "@/features/absences/types/absence-record"
import type { EmployeeRecord } from "@/features/employees/types/employee.types"
import {
  employee,
  SMALL_SECTOR_SCOPE,
  smallSector,
  smallSectorEmployees,
  storeConfig,
} from "@/features/planning/__tests__/planning-fixtures"
import {
  planningAbsences,
  snapToStep,
  weeklyTargetAfterAbsences,
} from "@/features/planning/flow/absence-target"
import { preparePlanningGeneration } from "@/features/planning/flow/planning-flow"

/**
 * Deux pannes vues sur le Drive, chacune à un bout de la préparation.
 *
 * 1. Un congé posé APRÈS une première génération n'était pas lu : l'écran ne
 *    passait aucune absence, et « Régénérer » replanifiait le salarié pendant
 *    ses vacances.
 * 2. Un férié retirait un cinquième du contrat sans le ramener sur la grille :
 *    36 h 45 − un cinquième = 1 764 min, que le constructeur refusait comme
 *    « pas un multiple de 15 », et toute la semaine avec.
 */

const WEEK = SMALL_SECTOR_SCOPE.period

function absence(patch: Partial<AbsenceRecord> & Pick<AbsenceRecord, "employeeId" | "start" | "end">): AbsenceRecord {
  return { id: `abs_${patch.employeeId}_${patch.start}`, type: "paid_leave", ...patch }
}

function problemFor(options: {
  readonly employees?: readonly EmployeeRecord[]
  readonly absences?: readonly AbsenceRecord[]
  readonly holidayPlan?: readonly HolidayPlanEntry[]
}) {
  const prepared = preparePlanningGeneration({
    savedPlannings: [],
    absences: options.absences ?? [],
    ...(options.holidayPlan ? { holidayPlan: options.holidayPlan } : {}),
    store: storeConfig(),
    employees: options.employees ?? smallSectorEmployees(),
    sectors: [smallSector()],
    scope: SMALL_SECTOR_SCOPE,
  })
  if (prepared.status === "error") {
    throw new Error(prepared.errors.map((error) => error.message).join(" | "))
  }
  return buildPlanningProblemV3(prepared.generationInput)
}

describe("les absences dans la génération", () => {
  it("rend le salarié indisponible les jours de congé, et réduit ce qu'il reste à placer", () => {
    const built = problemFor({
      absences: [absence({ employeeId: "e1", start: "2026-07-08", end: "2026-07-10" })],
    })
    if (!built.ok) throw new Error(built.errors.map((error) => error.message).join(" | "))

    const days = built.problem.employeeDays.filter((day) => String(day.employeeId) === "e1")
    const off = days.filter((day) => !day.available && day.unavailableReason === "absence")
    expect(off.map((day) => day.date)).toEqual(["2026-07-08", "2026-07-09", "2026-07-10"])

    const e1 = built.problem.employees.find((entry) => String(entry.id) === "e1")
    const e2 = built.problem.employees.find((entry) => String(entry.id) === "e2")
    // Trois jours sur cinq : il reste deux cinquièmes de 20 h.
    expect(e1?.contractMinutes).toBe(480)
    expect(e2?.contractMinutes).toBe(1_200)
  })

  it("ne laisse rien à placer à quelqu'un d'absent toute la semaine", () => {
    const built = problemFor({
      absences: [absence({ employeeId: "e1", start: "2026-07-01", end: "2026-07-31" })],
    })
    if (!built.ok) throw new Error(built.errors.map((error) => error.message).join(" | "))
    const e1 = built.problem.employees.find((entry) => String(entry.id) === "e1")
    expect(e1?.contractMinutes).toBe(0)
    expect(
      built.problem.employeeDays.filter((day) => String(day.employeeId) === "e1" && day.available)
    ).toEqual([])
  })

  it("ne change rien sans absence — la production ne bouge pas", () => {
    const without = problemFor({})
    const cancelled = problemFor({
      absences: [
        absence({ employeeId: "e1", start: "2026-07-08", end: "2026-07-10", status: "cancelled" }),
      ],
    })
    expect(cancelled).toEqual(without)
  })
})

describe("planningAbsences", () => {
  const ids = new Set(["e1"])

  it("écarte l'annulée, la fériée, la demi-journée, les heures, l'hors-périmètre et l'hors-période", () => {
    const kept = planningAbsences(
      [
        absence({ id: "keep", employeeId: "e1", start: "2026-07-08", end: "2026-07-08" }),
        absence({ id: "cancelled", employeeId: "e1", start: "2026-07-08", end: "2026-07-08", status: "cancelled" }),
        absence({ id: "holiday", employeeId: "e1", start: "2026-07-08", end: "2026-07-08", source: "holiday" }),
        absence({ id: "half", employeeId: "e1", start: "2026-07-08", end: "2026-07-08", halfDay: "morning" }),
        absence({ id: "hours", employeeId: "e1", start: "2026-07-08", end: "2026-07-08", hours: 2 }),
        absence({ id: "other", employeeId: "zz", start: "2026-07-08", end: "2026-07-08" }),
        absence({ id: "later", employeeId: "e1", start: "2026-08-01", end: "2026-08-10" }),
      ],
      ids,
      WEEK
    )
    expect(kept.map((entry) => entry.id)).toEqual(["keep"])
  })

  it("garde les semaines venues de la campagne de congés", () => {
    const kept = planningAbsences(
      [absence({ employeeId: "e1", start: "2026-07-06", end: "2026-07-12", source: "paid_leave_campaign" })],
      ids,
      WEEK
    )
    expect(kept).toHaveLength(1)
  })
})

describe("weeklyTargetAfterAbsences", () => {
  const base = {
    contractMinutes: 2_100,
    targetMinutes: 2_100,
    workingDays: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const,
    fixedDaysOff: [] as const,
    period: WEEK,
    isOpen: (date: IsoDate) => date !== "2026-07-12",
    holidayDates: new Set<string>(),
  }
  const off = (start: string, end: string) => [{ id: "a", employeeId: "e1", start, end }]

  it("retire la part des journées travaillables manquées", () => {
    // Six jours travaillables, un manqué : un sixième de 35 h.
    expect(weeklyTargetAfterAbsences({ ...base, absences: off("2026-07-07", "2026-07-07") })).toBe(1_750)
  })

  it("ne compte ni un jour de repos fixe, ni un jour fermé, ni un férié déjà déduit", () => {
    const target = weeklyTargetAfterAbsences({
      ...base,
      targetMinutes: 1_680,
      fixedDaysOff: ["monday"],
      holidayDates: new Set(["2026-07-07"]),
      absences: off("2026-07-06", "2026-07-12"),
    })
    // Lundi repos, dimanche fermé, mardi férié : il reste mercredi → samedi,
    // quatre jours sur cinq travaillables, et la cible ne descend jamais sous zéro.
    expect(target).toBe(0)
  })
})

describe("le férié et le pas de la grille", () => {
  it("génère la semaine d'un salarié à 36 h 45 quand un férié tombe dedans", () => {
    const people = [
      employee("e1", {
        weeklyHours: 36.75,
        weeklyMinutes: 2_205,
        sectors: ["Test"],
      } as Partial<EmployeeRecord>),
      ...smallSectorEmployees().filter((person) => person.id !== "e1"),
    ]
    const built = problemFor({
      employees: people,
      holidayPlan: [
        {
          date: "2026-07-07" as IsoDate,
          opening: "chome",
          volunteerIds: [],
          opensAtMinutes: null,
          closesAtMinutes: null,
        },
      ],
    })
    if (!built.ok) throw new Error(built.errors.map((error) => error.message).join(" | "))
    const e1 = built.problem.employees.find((entry) => String(entry.id) === "e1")
    expect(e1?.contractMinutes).toBeDefined()
    expect((e1?.contractMinutes ?? 1) % 15).toBe(0)
    expect(e1?.contractMinutes).toBeLessThan(2_205)
  })

  it("arrondit au pas le plus proche", () => {
    expect(snapToStep(1_764, 15)).toBe(1_770)
    expect(snapToStep(1_752, 15)).toBe(1_755)
    expect(snapToStep(1_680, 15)).toBe(1_680)
  })
})

describe("un volontaire en arrêt le jour férié", () => {
  // Volontaire, il ne perd aucune heure pour le férié : il est censé y
  // travailler. En arrêt ce jour-là, il ne le peut plus — et sa journée doit
  // sortir de son objectif comme n'importe quelle journée d'absence. Elle n'en
  // sortait pas : tous les fériés étaient sautés pour tout le monde, et il
  // gardait une journée sans aucun jour pour la placer.
  const holiday: HolidayPlanEntry = {
    date: "2026-07-07" as IsoDate,
    opening: "travaille",
    volunteerIds: ["e1", "e2"],
    opensAtMinutes: 540,
    closesAtMinutes: 1020,
  }

  it("retire la journée fériée manquée de son objectif", () => {
    const built = problemFor({
      holidayPlan: [holiday],
      absences: [absence({ employeeId: "e1", start: "2026-07-07", end: "2026-07-07", type: "sick_leave" })],
    })
    if (!built.ok) throw new Error(built.errors.map((error) => error.message).join(" | "))
    const e1 = built.problem.employees.find((entry) => String(entry.id) === "e1")
    const e2 = built.problem.employees.find((entry) => String(entry.id) === "e2")
    // Un jour sur cinq manqué : 20 h → 16 h. Le volontaire présent garde tout.
    expect(e1?.contractMinutes).toBe(960)
    expect(e2?.contractMinutes).toBe(1_200)
    expect(
      built.problem.employeeDays.find((day) => String(day.employeeId) === "e1" && day.date === holiday.date)?.available
    ).toBe(false)
  })

  it("ne retire rien de plus à un non-volontaire absent ce jour-là, déjà réduit par le férié", () => {
    const withoutAbsence = problemFor({ holidayPlan: [{ ...holiday, volunteerIds: ["e2"] }] })
    const withAbsence = problemFor({
      holidayPlan: [{ ...holiday, volunteerIds: ["e2"] }],
      absences: [absence({ employeeId: "e1", start: "2026-07-07", end: "2026-07-07", type: "sick_leave" })],
    })
    if (!withoutAbsence.ok || !withAbsence.ok) throw new Error("construction impossible")
    const contractOf = (problem: typeof withAbsence.problem) =>
      problem.employees.find((entry) => String(entry.id) === "e1")?.contractMinutes
    expect(contractOf(withAbsence.problem)).toBe(contractOf(withoutAbsence.problem))
  })
})
