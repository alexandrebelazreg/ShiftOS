import { describe, expect, it } from "vitest"

import { validatePlanningSolutionV3 } from "@/features/core/planning-v3/validator"
import { buildDriveCanonicalProblem, DRIVE_CANONICAL_RULES, driveCanonicalReferenceSolution } from "@/features/core/planning-v3/__tests__/drive-canonical"
import {
  ACCUEIL_CANONICAL_RULES,
  ACCUEIL_TEAM,
  buildAccueilCanonicalProblem,
} from "@/features/core/planning-v3/__tests__/accueil-canonical"
import {
  buildDriveWithAbsencesProblem,
  DRIVE_ABSENT_EMPLOYEE_IDS,
} from "@/features/core/planning-v3/__tests__/drive-absences"

/**
 * `minimumPresence` — the sector rule, and the builder that translates it.
 *
 * The floor used to be injected into the built problem by the Drive fixture,
 * which meant the continuous-presence rule existed only inside a test file: a
 * real sector reaching the engine carried no floor at all. It is now declared by
 * the SECTOR and produced by the builder, and these tests pin that.
 *
 * The overlap rule is the part worth reading twice. A floor applies to a demand
 * slot only when the slot lies ENTIRELY inside the floor's window — a floor
 * covering half a slot says nothing about the other half, and stretching it
 * across the whole slot would demand presence at minutes the sector never asked
 * about.
 */

describe("règle sectorielle — plancher de présence", () => {
  const problem = buildDriveCanonicalProblem()

  it("produit le plancher sur chaque créneau, depuis le secteur", () => {
    expect(problem.demandSlots.length).toBeGreaterThan(0)
    for (const slot of problem.demandSlots) {
      expect(slot.hardMinimumEmployees).toBe(DRIVE_CANONICAL_RULES.hardMinimumEmployees)
    }
  })

  it("couvre toute l'amplitude d'ouverture, sans trou", () => {
    for (const day of problem.days.filter((entry) => !entry.closed)) {
      const covered = new Set<number>()
      for (const slot of problem.demandSlots.filter((entry) => entry.date === day.date)) {
        if (slot.hardMinimumEmployees === undefined) continue
        for (let m = slot.startMinutes; m < slot.endMinutes; m += problem.timeStepMinutes) {
          covered.add(m)
        }
      }
      for (
        let m = DRIVE_CANONICAL_RULES.opensAtMinutes;
        m < DRIVE_CANONICAL_RULES.closesAtMinutes;
        m += problem.timeStepMinutes
      ) {
        expect(covered.has(m)).toBe(true)
      }
    }
  })

  it("laisse le planning de référence légal et sans manque", () => {
    const report = validatePlanningSolutionV3(problem, driveCanonicalReferenceSolution(problem))
    expect(report.violations).toEqual([])
    expect(report.underCoveredSlots).toBe(0)
    expect(report.metrics.totalDeficitMinutes).toBe(0)
  })
})

describe("Accueil — deux planchers de hauteurs différentes", () => {
  const problem = buildAccueilCanonicalProblem()

  it("respecte les contrats et les repos fixes déclarés", () => {
    for (const person of ACCUEIL_TEAM) {
      const employee = problem.employees.find((entry) => String(entry.id) === person.id)!
      expect(employee.contractMinutes).toBe(person.contractMinutes)
      for (const restDay of person.restDays) {
        expect(employee.fixedRestDays).toContain(restDay)
      }
    }
  })

  it("équilibre les contrats et les budgets exactement", () => {
    const contracts = problem.employees.reduce((sum, e) => sum + e.contractMinutes, 0)
    const budgets = problem.days.reduce((sum, d) => sum + d.budgetMinutes, 0)
    expect(contracts).toBe(budgets)
  })

  it("pose un plancher de 1 hors pointe et de 2 le samedi de 10:00 à 18:30", () => {
    const saturday = problem.days.find((day) => day.weekDay === "saturday")!
    const peakFrom = 600
    const peakTo = 1_110

    for (const slot of problem.demandSlots) {
      const insidePeak =
        slot.date === saturday.date && slot.startMinutes >= peakFrom && slot.endMinutes <= peakTo
      expect(slot.hardMinimumEmployees).toBe(
        insidePeak
          ? ACCUEIL_CANONICAL_RULES.saturdayPeak.employees
          : ACCUEIL_CANONICAL_RULES.hardMinimumEmployees
      )
    }
  })

  it("garde les horaires à la demie, sur le pas de 15 minutes", () => {
    expect(problem.days.filter((d) => !d.closed).every((d) => d.opensAtMinutes === 450)).toBe(true)
    expect(problem.days.filter((d) => !d.closed).every((d) => d.closesAtMinutes === 1_245)).toBe(true)
    for (const slot of problem.demandSlots) {
      expect(slot.startMinutes % problem.timeStepMinutes).toBe(0)
      expect(slot.endMinutes % problem.timeStepMinutes).toBe(0)
    }
  })

  it("plafonne les ouvertures à 3 et les fermetures à 2", () => {
    for (const employee of problem.employees) {
      expect(employee.maximumOpenings).toBe(
        ACCUEIL_CANONICAL_RULES.maximumOpeningsPerEmployee
      )
      expect(employee.maximumClosings).toBe(ACCUEIL_CANONICAL_RULES.maximumClosingsPerEmployee)
    }
  })
})

describe("Drive avec absences — la capacité tombe, le plancher ne bouge pas", () => {
  const problem = buildDriveWithAbsencesProblem()

  it("ne crée aucun horaire travaillable pour les absents", () => {
    for (const employeeId of DRIVE_ABSENT_EMPLOYEE_IDS) {
      const entries = problem.employeeDays.filter(
        (entry) => String(entry.employeeId) === employeeId
      )
      expect(entries.length).toBeGreaterThan(0)
      for (const entry of entries) {
        expect(entry.available).toBe(false)
        expect(entry.mandatory).toBe(false)
        expect(entry.maximumMinutes).toBe(0)
      }
    }
  })

  it("ne replanifie pas les heures des absents", () => {
    for (const employeeId of DRIVE_ABSENT_EMPLOYEE_IDS) {
      const employee = problem.employees.find((entry) => String(entry.id) === employeeId)!
      expect(employee.contractMinutes).toBe(0)
    }
  })

  it("ne déduit l'absence qu'une seule fois", () => {
    // La déduction est portée par les contrats. Les budgets valent exactement ce
    // qui reste dû : les compter une deuxième fois ferait disparaître des heures
    // que l'équipe présente doit pourtant travailler.
    const contracts = problem.employees.reduce((sum, e) => sum + e.contractMinutes, 0)
    const budgets = problem.days.reduce((sum, d) => sum + d.budgetMinutes, 0)
    expect(contracts).toBe(budgets)

    const present = problem.employees.filter((e) => e.contractMinutes > 0)
    expect(present).toHaveLength(3)
    expect(contracts).toBe(present.length * 2_205)
  })

  it("laisse le plancher dur strictement inchangé", () => {
    const canonical = buildDriveCanonicalProblem()
    for (const slot of problem.demandSlots) {
      const original = canonical.demandSlots.find((entry) => entry.id === slot.id)!
      expect(slot.hardMinimumEmployees).toBe(original.hardMinimumEmployees)
      // Et la demande de RÉFÉRENCE ne bouge pas non plus : c'est la cible
      // adaptée, calculée par le moteur, qui absorbe la réduction.
      expect(slot.requiredEmployees).toBe(original.requiredEmployees)
    }
  })

  it("garde chaque budget journalier dans la capacité réellement disponible", () => {
    for (const day of problem.days.filter((entry) => !entry.closed)) {
      const capacity = problem.employeeDays
        .filter((entry) => entry.date === day.date && entry.available)
        .reduce((sum, entry) => {
          const employee = problem.employees.find(
            (candidate) => String(candidate.id) === String(entry.employeeId)
          )!
          const ceiling = employee.canSplitShift
            ? Math.min(problem.rules.maximumShiftMinutes, 2 * (problem.rules.maximumContinuousMinutes ?? 0))
            : Math.min(problem.rules.maximumShiftMinutes, problem.rules.maximumContinuousMinutes ?? Infinity)
          return sum + Math.min(ceiling, entry.maximumMinutes)
        }, 0)
      expect(day.budgetMinutes).toBeLessThanOrEqual(capacity)
    }
  })
})
