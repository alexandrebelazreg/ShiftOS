import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { WEEK_DAYS } from "@/features/core/models"
import { fingerprintProblem, validatePlanningSolutionV3 } from "@/features/core/planning-v3/validator"

import {
  buildDriveCanonicalProblem,
  DRIVE_CANONICAL_DATES,
  DRIVE_CANONICAL_EXPECTED,
  DRIVE_CANONICAL_RULES,
  driveCanonicalReferenceSolution,
  serialiseDriveCanonicalProblem,
} from "@/features/core/planning-v3/__tests__/drive-canonical"

/**
 * The business contract of the canonical Drive problem.
 *
 * Every rule in `DRIVE_CANONICAL_RULES` is pinned here against the problem the
 * PRODUCTION builder actually produces — not against the fixture's own input,
 * which would only prove the fixture agrees with itself.
 *
 * The suite exists because the previous fixture disagreed with the rules on
 * three separate points and nobody noticed for as long as no one asked it to
 * validate a schedule built under the real ones.
 */

/**
 * The canonical problem's identity, pinned.
 *
 * Every benchmark that quotes a number for Drive must quote this fingerprint
 * beside it. Two results carrying different fingerprints answer different
 * questions and may never be tabled as a comparison.
 */
/*
 * Moved from `p3_2d27bbc36346cb07` when the fingerprint stopped ignoring the
 * per-person daily bounds, the right to split, and — the costly one — the
 * `employeeDays` entries entirely. A week where someone was AWAY and the same
 * week where they were present carried one identity, as did two weeks differing
 * only in when a person may first arrive or how late they may stay.
 *
 * Found by a perturbation campaign losing three of its six axes: every
 * start-hour, split-capability and short-absence scenario looked like the
 * baseline and was discarded as a duplicate. Same class of collision as the
 * `hardMinimumEmployees` blindness this pin caught before, and the reason the
 * pin exists at all.
 */
export const DRIVE_CANONICAL_FINGERPRINT = "p3_b114fe2b5b80e957"

const problem = buildDriveCanonicalProblem()

function employee(id: string) {
  const found = problem.employees.find((entry) => String(entry.id) === id)
  if (!found) throw new Error(`Salarié ${id} absent de la fixture canonique.`)
  return found
}

function dayOf(weekDay: string) {
  const found = problem.days.find((entry) => entry.weekDay === weekDay)
  if (!found) throw new Error(`Jour ${weekDay} absent de la fixture canonique.`)
  return found
}

function entryOf(employeeId: string, weekDay: string) {
  const day = dayOf(weekDay)
  const found = problem.employeeDays.find(
    (entry) => String(entry.employeeId) === employeeId && entry.date === day.date
  )
  if (!found) throw new Error(`Aucune disponibilité pour ${employeeId} le ${weekDay}.`)
  return found
}

describe("Drive canonique — contrat métier", () => {
  it("donne à chacun le contrat hebdomadaire exact", () => {
    for (const entry of problem.employees) {
      expect(entry.contractMinutes).toBe(DRIVE_CANONICAL_RULES.contractMinutes)
    }
  })

  it("pose les budgets journaliers exacts", () => {
    for (const [weekDay, minutes] of Object.entries(DRIVE_CANONICAL_RULES.dailyBudgetMinutes)) {
      expect(dayOf(weekDay).budgetMinutes).toBe(minutes)
    }
    const total = problem.days.reduce((sum, day) => sum + day.budgetMinutes, 0)
    const contracts = problem.employees.reduce((sum, entry) => sum + entry.contractMinutes, 0)
    // Les deux sommes sont la même quantité comptée deux fois : un écart rendrait
    // le problème insoluble par construction.
    expect(total).toBe(contracts)
  })

  it("n'impose AUCUNE limite individuelle d'ouverture", () => {
    // La régression corrigée : un `MAX_OPENINGS = 1` que personne n'avait décidé
    // rendait illégal le planning de référence.
    for (const entry of problem.employees) {
      expect(entry.maximumOpenings).toBe(DRIVE_CANONICAL_RULES.maximumOpeningsPerEmployee)
    }
    expect(employee("valentin").maximumOpenings).toBeNull()
  })

  it("autorise jusqu'à deux fermetures par salarié", () => {
    for (const entry of problem.employees) {
      expect(entry.maximumClosings).toBe(DRIVE_CANONICAL_RULES.maximumClosingsPerEmployee)
    }
    expect(employee("arthur").maximumClosings).toBe(2)
    expect(employee("erwan").maximumClosings).toBe(2)
  })

  it("n'autorise la coupure qu'à un seul salarié", () => {
    for (const entry of problem.employees) {
      expect(entry.canSplitShift).toBe(
        String(entry.id) === DRIVE_CANONICAL_RULES.splitShiftAllowedFor
      )
    }
  })

  it("déclare EXPLICITEMENT le plancher de présence continue sur toute l'ouverture", () => {
    // La règle métier Drive impose une présence minimale continue. Tant que ce
    // champ est absent, la règle n'est enforcée par rien : le validateur ne
    // vérifie un plancher que là où le problème en déclare un.
    const open = problem.days.filter((day) => !day.closed)
    expect(problem.demandSlots.length).toBeGreaterThan(0)

    for (const slot of problem.demandSlots) {
      expect(slot.hardMinimumEmployees).toBe(DRIVE_CANONICAL_RULES.hardMinimumEmployees)
    }

    // Et le plancher couvre bien toute la fenêtre d'ouverture, sans trou : un
    // plancher déclaré sur 13 heures d'une amplitude de 14 laisserait une heure
    // sans garantie.
    for (const day of open) {
      const covered = new Set<number>()
      for (const slot of problem.demandSlots.filter((entry) => entry.date === day.date)) {
        if (slot.hardMinimumEmployees === undefined) continue
        for (
          let minute = slot.startMinutes;
          minute < slot.endMinutes;
          minute += problem.timeStepMinutes
        ) {
          covered.add(minute)
        }
      }
      for (
        let minute = DRIVE_CANONICAL_RULES.opensAtMinutes;
        minute < DRIVE_CANONICAL_RULES.closesAtMinutes;
        minute += problem.timeStepMinutes
      ) {
        expect(covered.has(minute)).toBe(true)
      }
    }
  })

  it("garde le plancher au plus égal à la cible métier", () => {
    // Un plancher au-dessus de la demande configurée serait une contradiction :
    // il rendrait obligatoire ce que le métier n'a jamais demandé.
    for (const slot of problem.demandSlots) {
      expect(slot.hardMinimumEmployees ?? 0).toBeLessThanOrEqual(slot.requiredEmployees)
    }
  })

  it("porte les bornes de durée, de coupure et de repos", () => {
    expect(problem.rules.minimumShiftMinutes).toBe(DRIVE_CANONICAL_RULES.minimumShiftMinutes)
    expect(problem.rules.maximumShiftMinutes).toBe(DRIVE_CANONICAL_RULES.maximumShiftMinutes)
    expect(problem.rules.maximumContinuousMinutes).toBe(
      DRIVE_CANONICAL_RULES.maximumContinuousMinutes
    )
    expect(problem.rules.minimumSplitMinutes).toBe(DRIVE_CANONICAL_RULES.minimumSplitMinutes)
    expect(problem.rules.maximumSplitMinutes).toBe(DRIVE_CANONICAL_RULES.maximumSplitMinutes)
    expect(problem.rules.minimumRestMinutes).toBe(DRIVE_CANONICAL_RULES.minimumRestMinutes)
    expect(problem.timeStepMinutes).toBe(DRIVE_CANONICAL_RULES.timeStepMinutes)
  })
})

describe("Drive canonique — repos fixes et jours obligatoires", () => {
  it("ne rend jamais obligatoire un jour de repos fixe", () => {
    // La règle générale, vérifiée sur TOUS les salariés et tous les jours :
    // `workEveryNonFixedRestDay` ne peut pas primer sur un repos fixe.
    for (const entry of problem.employeeDays) {
      const person = employee(String(entry.employeeId))
      const day = problem.days.find((candidate) => candidate.date === entry.date)!
      if (!person.fixedRestDays.includes(day.weekDay)) continue
      expect(entry.available).toBe(false)
      expect(entry.mandatory).toBe(false)
      expect(entry.fixedRest).toBe(true)
    }
  })

  it("ne rend jamais obligatoire un jour indisponible", () => {
    for (const entry of problem.employeeDays) {
      if (entry.available) continue
      expect(entry.mandatory).toBe(false)
    }
  })

  it("laisse Luca au repos le mercredi", () => {
    const entry = entryOf("luca", "wednesday")
    expect(entry.fixedRest).toBe(true)
    expect(entry.available).toBe(false)
    expect(entry.mandatory).toBe(false)
  })

  it("laisse Arthur au repos le jeudi", () => {
    const entry = entryOf("arthur", "thursday")
    expect(entry.fixedRest).toBe(true)
    expect(entry.available).toBe(false)
    expect(entry.mandatory).toBe(false)
  })

  it("garde les autres jours ouverts obligatoires", () => {
    // Le pendant de la règle : le drapeau fait bien son travail là où aucun
    // repos fixe ne s'y oppose.
    const entry = entryOf("luca", "monday")
    expect(entry.available).toBe(true)
    expect(entry.mandatory).toBe(true)
  })
})

describe("Drive canonique — contraintes horaires individuelles", () => {
  it("empêche Dylan de commencer avant 08:00 tous les jours ouverts", () => {
    for (const day of problem.days.filter((entry) => !entry.closed)) {
      const entry = problem.employeeDays.find(
        (candidate) => String(candidate.employeeId) === "dylan" && candidate.date === day.date
      )!
      expect(entry.earliestStartMinutes).toBe(
        DRIVE_CANONICAL_RULES.earliestStartOverrides.dylan
      )
    }
  })

  it("laisse les autres salariés sur la fenêtre du secteur", () => {
    for (const day of problem.days.filter((entry) => !entry.closed)) {
      for (const person of problem.employees) {
        if (String(person.id) === "dylan") continue
        const entry = problem.employeeDays.find(
          (candidate) =>
            String(candidate.employeeId) === String(person.id) && candidate.date === day.date
        )!
        expect(entry.earliestStartMinutes).toBe(DRIVE_CANONICAL_RULES.opensAtMinutes)
        expect(entry.latestEndMinutes).toBe(DRIVE_CANONICAL_RULES.closesAtMinutes)
      }
    }
  })
})

describe("Drive canonique — le planning Python de référence", () => {
  const solution = driveCanonicalReferenceSolution(problem)
  const report = validatePlanningSolutionV3(problem, solution)

  it("est LÉGAL au regard du validateur officiel", () => {
    // Le critère d'alignement. Tant qu'il échoue, aucune comparaison entre
    // moteurs n'a de sens : ils ne répondraient pas au même problème.
    expect(report.violations).toEqual([])
    expect(report.validHardConstraints).toBe(DRIVE_CANONICAL_EXPECTED.validHardConstraints)
  })

  it("couvre la semaine sans aucun manque", () => {
    expect(report.underCoveredSlots).toBe(DRIVE_CANONICAL_EXPECTED.underCoveredSlots)
    expect(report.metrics.totalDeficitMinutes).toBe(DRIVE_CANONICAL_EXPECTED.deficitMinutes)
  })

  it("a la forme attendue", () => {
    expect(solution.assignments).toHaveLength(DRIVE_CANONICAL_EXPECTED.assignments)
    expect(
      solution.assignments.filter((assignment) => assignment.segments.length > 1)
    ).toHaveLength(DRIVE_CANONICAL_EXPECTED.splitShifts)
  })

  it("place les contrats et les budgets exactement", () => {
    const weekKey = problem.days[0].weekKey
    for (const person of problem.employees) {
      expect(report.metrics.weeklyMinutesByEmployeeWeek[`${String(person.id)}|${weekKey}`]).toBe(
        DRIVE_CANONICAL_RULES.contractMinutes
      )
    }
    for (const day of problem.days.filter((entry) => !entry.closed)) {
      expect(report.metrics.dailyMinutesByDate[day.date]).toBe(day.budgetMinutes)
    }
  })

  it("respecte les plafonds de fermeture et n'a aucun plafond d'ouverture à respecter", () => {
    for (const person of problem.employees) {
      const closings = report.metrics.closingsByEmployee[String(person.id)] ?? 0
      expect(closings).toBeLessThanOrEqual(DRIVE_CANONICAL_RULES.maximumClosingsPerEmployee)
    }
  })

  it("respecte les bornes de segment et de coupure", () => {
    for (const assignment of solution.assignments) {
      const total = assignment.segments.reduce(
        (sum, segment) => sum + (segment.endMinutes - segment.startMinutes),
        0
      )
      expect(total).toBeLessThanOrEqual(DRIVE_CANONICAL_RULES.maximumShiftMinutes)

      for (const segment of assignment.segments) {
        const duration = segment.endMinutes - segment.startMinutes
        expect(duration).toBeGreaterThanOrEqual(DRIVE_CANONICAL_RULES.minimumShiftMinutes)
        expect(duration).toBeLessThanOrEqual(DRIVE_CANONICAL_RULES.maximumContinuousMinutes)
      }

      if (assignment.segments.length === 2) {
        const gap = assignment.segments[1].startMinutes - assignment.segments[0].endMinutes
        expect(gap).toBeGreaterThanOrEqual(DRIVE_CANONICAL_RULES.minimumSplitMinutes)
        expect(gap).toBeLessThanOrEqual(DRIVE_CANONICAL_RULES.maximumSplitMinutes)
      }
    }
  })
})

describe("Drive canonique — stabilité", () => {
  it("a une empreinte stable et déterministe", () => {
    const again = buildDriveCanonicalProblem()
    expect(fingerprintProblem(again)).toBe(fingerprintProblem(problem))
    // Épinglée : un changement de règle, de builder ou de fixture doit être
    // remarqué, jamais subi.
    expect(fingerprintProblem(problem)).toBe(DRIVE_CANONICAL_FINGERPRINT)
  })

  it("se sérialise en JSON sans perte", () => {
    const json = serialiseDriveCanonicalProblem()
    const parsed = JSON.parse(json)
    expect(parsed.version).toBe(problem.version)
    expect(parsed.employees).toHaveLength(problem.employees.length)
    expect(parsed.days).toHaveLength(problem.days.length)
    expect(parsed.demandSlots).toHaveLength(problem.demandSlots.length)
    expect(json.endsWith("\n")).toBe(true)
  })

  it("couvre les six jours ouverts attendus", () => {
    const open = problem.days.filter((day) => !day.closed).map((day) => day.date)
    expect(open).toEqual([...DRIVE_CANONICAL_DATES])
    expect(WEEK_DAYS).toContain(problem.days[0].weekDay)
  })
})

/**
 * The JSON the Python spike reads.
 *
 * A snapshot rots silently: change a rule, the builder or the fixture and the
 * committed file quietly stops describing the problem the application poses,
 * while the spike keeps reporting a result about the OLD one — and the result
 * reads as if it still applied. This test regenerates from the real builder and
 * fails on any drift.
 *
 * Set `UPDATE_DRIVE_CANONICAL=1` to rewrite the snapshots after an intended
 * change.
 */
describe("Drive canonique — instantanés partagés avec le spike Python", () => {
  const root = join(process.cwd(), "experiments", "planning-v3-cpsat", "fixtures")
  const problemPath = join(root, "drive-canonical-problem.json")
  const solutionPath = join(root, "drive-canonical-reference-solution.json")

  it("écrit un problème identique au fichier committé", () => {
    const regenerated = serialiseDriveCanonicalProblem()
    if (process.env.UPDATE_DRIVE_CANONICAL === "1") {
      writeFileSync(problemPath, regenerated, "utf8")
    }
    expect(existsSync(problemPath)).toBe(true)
    const committed = readFileSync(problemPath, "utf8")
    expect(JSON.parse(committed)).toEqual(JSON.parse(regenerated))
    expect(committed).toBe(regenerated)
  })

  it("écrit un planning de référence identique au fichier committé", () => {
    const regenerated = `${JSON.stringify(
      driveCanonicalReferenceSolution(problem).assignments,
      null,
      2
    )}\n`
    if (process.env.UPDATE_DRIVE_CANONICAL === "1") {
      writeFileSync(solutionPath, regenerated, "utf8")
    }
    expect(existsSync(solutionPath)).toBe(true)
    expect(readFileSync(solutionPath, "utf8")).toBe(regenerated)
  })
})
