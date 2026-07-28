import { describe, expect, it } from "vitest"

import type { IsoDate } from "@/features/core/models"
import { minimumConcurrentPresence } from "@/features/core/shared"
import { solveDecomposed } from "@/features/core/planning-v3/solver-decomposed"
import { validatePlanningSolutionV3 } from "@/features/core/planning-v3/validator"
import { assignRoles } from "@/features/core/planning-v3/role-assignment/assign-roles"
import type { PlanningEmployeeDayV3, PlanningProblemV3 } from "@/features/core/planning-v3/types/problem"

import {
  ACCUEIL_CLOSES_AT,
  ACCUEIL_CONTINUITY_FLOOR,
  ACCUEIL_MAXIMUM_CLOSINGS,
  ACCUEIL_MAXIMUM_OPENINGS,
  ACCUEIL_OPENS_AT,
  ACCUEIL_TEAM,
  SATURDAY_PEAK_END,
  SATURDAY_PEAK_FLOOR,
  SATURDAY_PEAK_START,
  buildAccueilProblem,
} from "@/features/core/planning-v3/solver-decomposed/__tests__/accueil-problem"

const OPTIONS = { timeoutMs: 45_000, maximumPlacementNodes: 6_000_000 } as const

const problem = buildAccueilProblem()
const run = solveDecomposed(problem, OPTIONS)
const solution = run.result.solution
const report = solution === null ? null : validatePlanningSolutionV3(problem, solution)

/** Worked intervals of one date, from every employee combined. */
function intervalsOn(date: string) {
  return solution!.assignments
    .filter((assignment) => assignment.date === date)
    .flatMap((assignment) => assignment.segments)
}

describe("Accueil — le scénario doit trouver un planning légal", () => {
  it("trouve une solution", () => {
    expect(run.result.status).toBe("feasible-timeout")
    expect(solution).not.toBeNull()
  })

  it("produit un planning que le validateur officiel juge légal", () => {
    expect(report!.validHardConstraints).toBe(true)
    expect(report!.violations).toEqual([])
  })

  it("n'annonce aucune optimalité", () => {
    expect(run.result.proof.kind).toBe("none")
    expect(run.result.proof.candidateSpace).toBe("incomplete")
  })

  it("place exactement les contrats de chacun", () => {
    const weekKey = problem.days[0].weekKey
    for (const person of ACCUEIL_TEAM) {
      expect(report!.metrics.weeklyMinutesByEmployeeWeek[`${person.id}|${weekKey}`]).toBe(
        person.contractMinutes
      )
    }
  })

  it("respecte les repos fixes de chacun", () => {
    for (const assignment of solution!.assignments) {
      const day = problem.days.find((entry) => entry.date === assignment.date)!
      const person = ACCUEIL_TEAM.find((entry) => entry.id === String(assignment.employeeId))!
      expect(person.restDays).not.toContain(day.weekDay)
    }
  })

  it("ne fait travailler Kenza que le samedi, dix heures, en coupure", () => {
    const kenza = solution!.assignments.filter(
      (assignment) => String(assignment.employeeId) === "kenza"
    )
    expect(kenza).toHaveLength(1)

    const saturday = problem.days.find((day) => day.weekDay === "saturday")!
    expect(kenza[0].date).toBe(saturday.date)

    const minutes = kenza[0].segments.reduce(
      (sum, segment) => sum + (segment.endMinutes - segment.startMinutes),
      0
    )
    expect(minutes).toBe(600)
    // Dix heures dépassent le continu maximal de huit : la coupure n'est pas
    // une préférence ici, c'est la seule forme légale.
    expect(kenza[0].segments).toHaveLength(2)
    const gap = kenza[0].segments[1].startMinutes - kenza[0].segments[0].endMinutes
    expect(gap).toBeGreaterThanOrEqual(problem.rules.minimumSplitMinutes!)
    expect(gap).toBeLessThanOrEqual(problem.rules.maximumSplitMinutes!)
  })

  it("ne coupe jamais la journée de Brigitte ni celle de Marie", () => {
    for (const assignment of solution!.assignments) {
      const id = String(assignment.employeeId)
      if (id !== "brigitte" && id !== "marie") continue
      expect(assignment.segments).toHaveLength(1)
    }
  })

  it("ne dépasse jamais une coupure par jour", () => {
    for (const assignment of solution!.assignments) {
      expect(assignment.segments.length).toBeLessThanOrEqual(2)
    }
  })

  it("tient la couverture continue de 07:30 à 20:45 chaque jour ouvert", () => {
    for (const day of problem.days.filter((entry) => !entry.closed)) {
      const present = minimumConcurrentPresence(
        { startMinutes: ACCUEIL_OPENS_AT, endMinutes: ACCUEIL_CLOSES_AT },
        intervalsOn(day.date)
      )
      expect(present).toBeGreaterThanOrEqual(ACCUEIL_CONTINUITY_FLOOR)
    }
  })

  it("met au moins deux personnes le samedi de 10:00 à 18:30", () => {
    const saturday = problem.days.find((day) => day.weekDay === "saturday")!
    const present = minimumConcurrentPresence(
      { startMinutes: SATURDAY_PEAK_START, endMinutes: SATURDAY_PEAK_END },
      intervalsOn(saturday.date)
    )
    expect(present).toBeGreaterThanOrEqual(SATURDAY_PEAK_FLOOR)
  })

  it("respecte les plafonds d'ouvertures et de fermetures", () => {
    for (const person of ACCUEIL_TEAM) {
      expect(report!.metrics.openingsByEmployee[person.id] ?? 0).toBeLessThanOrEqual(
        ACCUEIL_MAXIMUM_OPENINGS
      )
      expect(report!.metrics.closingsByEmployee[person.id] ?? 0).toBeLessThanOrEqual(
        ACCUEIL_MAXIMUM_CLOSINGS
      )
    }
  })

  it("garde les horaires alignés sur le pas de 15 minutes malgré une amplitude à la demie", () => {
    for (const assignment of solution!.assignments) {
      for (const segment of assignment.segments) {
        expect(segment.startMinutes % 15).toBe(0)
        expect(segment.endMinutes % 15).toBe(0)
        expect(segment.startMinutes).toBeGreaterThanOrEqual(ACCUEIL_OPENS_AT)
        expect(segment.endMinutes).toBeLessThanOrEqual(ACCUEIL_CLOSES_AT)
      }
    }
  })
})

/**
 * Deux absents toute la semaine.
 *
 * Le contrat d'un absent n'est PAS replanifié : ses minutes disparaissent du
 * problème, et les budgets journaliers sont réduits d'autant. C'est ce qui
 * distingue une absence d'un simple jour indisponible — replanifier les heures
 * de quelqu'un qui n'est pas là est la manière la plus directe de produire un
 * planning que personne ne peut tenir.
 *
 * Les planchers durs, eux, ne bougent pas. Une équipe réduite ne rend pas la
 * continuité négociable : soit elle tient, soit le moteur doit le dire.
 */
function withAbsences(absentIds: readonly string[]): PlanningProblemV3 {
  const base = buildAccueilProblem()
  const absent = new Set(absentIds)

  const employees = base.employees.filter((employee) => !absent.has(String(employee.id)))
  const removedMinutes = base.employees
    .filter((employee) => absent.has(String(employee.id)))
    .reduce((sum, employee) => sum + employee.contractMinutes, 0)

  // Les budgets souples sont réduits proportionnellement, au pas de 15, le
  // reliquat d'arrondi tombant sur le jour le plus chargé pour que la somme
  // reste exacte.
  const totalBudget = base.days.reduce((sum, day) => sum + day.budgetMinutes, 0)
  const target = totalBudget - removedMinutes
  const scaled = base.days.map((day) =>
    Math.round((day.budgetMinutes * target) / totalBudget / 15) * 15
  )
  const drift = target - scaled.reduce((sum, value) => sum + value, 0)
  const heaviest = scaled.indexOf(Math.max(...scaled))
  scaled[heaviest] += drift

  const days = base.days.map((day, index) => ({ ...day, budgetMinutes: scaled[index] }))
  const employeeDays: readonly PlanningEmployeeDayV3[] = base.employeeDays.filter(
    (entry) => !absent.has(String(entry.employeeId))
  )

  return { ...base, employees, days, employeeDays }
}

describe("Accueil — deux absents toute la semaine", () => {
  const reduced = withAbsences(["marie", "kenza"])
  const reducedRun = solveDecomposed(reduced, OPTIONS)

  it("ne replanifie pas les contrats des absents", () => {
    // Trié : le problème conserve l'ordre d'entrée, c'est le moteur qui
    // normalise. Comparer un ordre que la fixture ne promet pas testerait la
    // fixture, pas l'absence.
    expect(reduced.employees.map((employee) => String(employee.id)).sort()).toEqual([
      "brigitte",
      "marine",
    ])
    const remaining = reduced.employees.reduce(
      (sum, employee) => sum + employee.contractMinutes,
      0
    )
    const budget = reduced.days.reduce((sum, day) => sum + day.budgetMinutes, 0)
    expect(budget).toBe(remaining)
  })

  it("laisse les planchers durs strictement inchangés", () => {
    for (const slot of reduced.demandSlots) {
      const original = buildAccueilProblem().demandSlots.find((entry) => entry.id === slot.id)!
      expect(slot.hardMinimumEmployees).toBe(original.hardMinimumEmployees)
    }
  })

  it("ne laisse aucun trou, ou déclare explicitement l'impossibilité", () => {
    // Les deux réponses sont acceptables ; une troisième ne l'est pas — un
    // planning troué présenté comme une solution.
    if (reducedRun.result.solution === null) {
      expect(["infeasible", "feasible-timeout"]).toContain(reducedRun.result.status)
      expect(reducedRun.result.diagnostics.length).toBeGreaterThan(0)
      return
    }

    const audit = validatePlanningSolutionV3(reduced, reducedRun.result.solution)
    expect(audit.validHardConstraints).toBe(true)
    expect(audit.violations.some((entry) => entry.rule === "hard-coverage-floor")).toBe(false)

    for (const day of reduced.days.filter((entry) => !entry.closed)) {
      const present = minimumConcurrentPresence(
        { startMinutes: ACCUEIL_OPENS_AT, endMinutes: ACCUEIL_CLOSES_AT },
        reducedRun.result.solution.assignments
          .filter((assignment) => assignment.date === day.date)
          .flatMap((assignment) => assignment.segments)
      )
      expect(present).toBeGreaterThanOrEqual(ACCUEIL_CONTINUITY_FLOOR)
    }
  })

  it("ne se replie jamais sur un autre moteur", () => {
    expect(reducedRun.result.proof.kind).toBe("none")
    expect(reducedRun.result.proof.deterministic).toBe(true)
  })
})

describe("post-traitement des rôles — Coffre / Accueil / Caisse", () => {
  const opensAtByDate = Object.fromEntries(
    problem.days.filter((day) => !day.closed).map((day) => [day.date, ACCUEIL_OPENS_AT])
  )
  const saturday = problem.days.find((day) => day.weekDay === "saturday")!
  const roles = assignRoles({
    solution: solution!,
    opensAtByDate,
    accueilOnlyDates: [saturday.date as IsoDate],
  })

  it("met l'ouvreuse au Coffre la première heure, puis à l'Accueil", () => {
    for (const day of problem.days.filter((entry) => !entry.closed && entry.weekDay !== "saturday")) {
      const coffre = roles.filter((entry) => entry.date === day.date && entry.role === "Coffre")
      expect(coffre).toHaveLength(1)
      expect(coffre[0].startMinutes).toBe(ACCUEIL_OPENS_AT)
      expect(coffre[0].endMinutes).toBe(ACCUEIL_OPENS_AT + 60)

      // La même personne enchaîne à l'Accueil, sans trou entre les deux.
      const suite = roles.find(
        (entry) =>
          entry.date === day.date &&
          entry.employeeId === coffre[0].employeeId &&
          entry.startMinutes === coffre[0].endMinutes
      )
      expect(suite?.role).toBe("Accueil")
    }
  })

  it("envoie la seconde arrivée en Caisse du lundi au vendredi", () => {
    for (const day of problem.days.filter((entry) => !entry.closed && entry.weekDay !== "saturday")) {
      const onDay = solution!.assignments.filter((assignment) => assignment.date === day.date)
      if (onDay.length < 2) continue

      const caisse = roles.filter((entry) => entry.date === day.date && entry.role === "Caisse")
      expect(caisse.length).toBeGreaterThan(0)

      const arrivals = [...onDay].sort(
        (left, right) =>
          left.segments[0].startMinutes - right.segments[0].startMinutes ||
          String(left.employeeId).localeCompare(String(right.employeeId))
      )
      expect(String(caisse[0].employeeId)).toBe(String(arrivals[1].employeeId))
    }
  })

  it("garde tout le monde à l'Accueil le samedi", () => {
    const saturdayRoles = roles.filter((entry) => entry.date === saturday.date)
    expect(saturdayRoles.length).toBeGreaterThan(0)
    for (const entry of saturdayRoles) {
      expect(entry.role).toBe("Accueil")
    }
  })

  it("couvre chaque minute travaillée exactement une fois", () => {
    const worked = solution!.assignments.reduce(
      (sum, assignment) =>
        sum +
        assignment.segments.reduce(
          (inner, segment) => inner + (segment.endMinutes - segment.startMinutes),
          0
        ),
      0
    )
    const covered = roles.reduce((sum, entry) => sum + (entry.endMinutes - entry.startMinutes), 0)
    expect(covered).toBe(worked)
  })
})
