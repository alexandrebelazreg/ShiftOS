import { describe, expect, it } from "vitest"

import { minimumConcurrentPresence } from "@/features/core/shared"
import { solveDecomposed } from "@/features/core/planning-v3/solver-decomposed"
import { validatePlanningSolutionV3 } from "@/features/core/planning-v3/validator"
import type { DecomposedOptions } from "@/features/core/planning-v3/solver-decomposed"

import {
  buildDecomposedDriveProblem,
  DRIVE_HARD_FLOOR,
  DYLAN_EARLIEST_START_MINUTES,
} from "@/features/core/planning-v3/solver-decomposed/__tests__/drive-decomposed-problem"

/**
 * The Drive week against the decomposed engine.
 *
 * This file pins what the engine ACTUALLY does — including where it falls
 * short — so the gap stays visible in the suite rather than living in a report
 * nobody re-reads. Nothing here is asserted from the engine's own opinion of
 * itself: every legality claim below is the INDEPENDENT validator's.
 */

const OPTIONS: DecomposedOptions = { timeoutMs: 30_000, maximumPlacementNodes: 4_000_000 }

const problem = buildDecomposedDriveProblem()

/** One solve, shared by every assertion. The determinism test re-runs on purpose. */
const run = solveDecomposed(problem, OPTIONS)
const solution = run.result.solution
const report = solution === null ? null : validatePlanningSolutionV3(problem, solution)

/** Sprint 3D.1, the engine actually in production, leaves four slots short. */
const SPRINT_3D1_UNDER_COVERED_SLOTS = 4
/**
 * What CP-SAT measured on this week, after a 120-second budget, in
 * `drive-solve-response-current.json`.
 *
 * NOT a like-for-like comparison, and it must not be presented as one: CP-SAT
 * solved the week WITHOUT Dylan's 08:00 bound and WITHOUT the unbreakable
 * floor, both of which this fixture adds. The number is here for scale, not as
 * a scoreboard.
 */
const CP_SAT_UNDER_COVERED_SLOTS_EASIER_PROBLEM = 8
/**
 * What the decomposed engine measures today, on the HARDER problem.
 *
 * Was 8 until Phase 3 learned to rank skeletons by the deficit they have
 * already made unavoidable, instead of handing duties out by fairness alone.
 * The number moved DOWN because the engine got better, not because the bar
 * moved: every assertion around it is unchanged, and the acceptance marker
 * below still fails.
 *
 * Verified not to be a budget artefact — ten times the placement budget
 * (89 s and 40 allocations instead of 8 s and 4) returns the same 6 slots and
 * the same 330 minutes.
 */
const DECOMPOSED_UNDER_COVERED_SLOTS = 6

describe("Drive — moteur décomposé", () => {
  it("retourne une solution sans jamais annoncer d'optimalité", () => {
    expect(run.result.status).toBe("feasible-timeout")
    expect(solution).not.toBeNull()
    // Le point non négociable : l'espace est réduit par construction, donc
    // aucune optimalité ne peut être démontrée par ce moteur, jamais.
    expect(run.result.proof.kind).toBe("none")
    expect(run.result.proof.candidateSpace).toBe("incomplete")
    expect(run.result.proof.lowerBound).toBeNull()
    expect(run.result.proof.deterministic).toBe(true)
  })

  it("produit un planning que le validateur officiel juge légal", () => {
    expect(report).not.toBeNull()
    expect(report!.validHardConstraints).toBe(true)
    expect(report!.violations).toEqual([])
  })

  it("respecte exactement les contrats et les budgets journaliers", () => {
    const weekKey = problem.days[0].weekKey
    for (const employee of problem.employees) {
      expect(report!.metrics.weeklyMinutesByEmployeeWeek[`${String(employee.id)}|${weekKey}`]).toBe(
        employee.contractMinutes
      )
    }
    for (const day of problem.days.filter((entry) => !entry.closed)) {
      expect(report!.metrics.dailyMinutesByDate[day.date]).toBe(day.budgetMinutes)
    }
  })

  it("ne fait jamais commencer Dylan avant 08:00", () => {
    const dylanShifts = solution!.assignments.filter(
      (assignment) => String(assignment.employeeId) === "dylan"
    )
    expect(dylanShifts.length).toBeGreaterThan(0)
    for (const shift of dylanShifts) {
      expect(shift.segments[0].startMinutes).toBeGreaterThanOrEqual(DYLAN_EARLIEST_START_MINUTES)
    }
  })

  it("ne dépasse le maximum de fermetures d'aucun salarié", () => {
    for (const employee of problem.employees) {
      const closings = report!.metrics.closingsByEmployee[String(employee.id)] ?? 0
      if (employee.maximumClosings !== null) {
        expect(closings).toBeLessThanOrEqual(employee.maximumClosings)
      }
      const openings = report!.metrics.openingsByEmployee[String(employee.id)] ?? 0
      if (employee.maximumOpenings !== null) {
        expect(openings).toBeLessThanOrEqual(employee.maximumOpenings)
      }
    }
  })

  it("tient le plancher incassable sur chaque créneau, sans exception", () => {
    // Recomputé ici avec la primitive atomique partagée, indépendamment du
    // moteur ET du validateur : le plancher est la seule contrainte que la
    // consigne interdit absolument de dégrader.
    for (const slot of problem.demandSlots) {
      const intervals = solution!.assignments
        .filter((assignment) => assignment.date === slot.date)
        .flatMap((assignment) => assignment.segments)
      const present = minimumConcurrentPresence(
        { startMinutes: slot.startMinutes, endMinutes: slot.endMinutes },
        intervals
      )
      expect(present).toBeGreaterThanOrEqual(DRIVE_HARD_FLOOR)
    }
    expect(report!.violations.some((v) => v.rule === "hard-coverage-floor")).toBe(false)
  })

  it("garde les shifts entre la durée minimale et la durée maximale", () => {
    for (const assignment of solution!.assignments) {
      const minutes = assignment.segments.reduce(
        (sum, segment) => sum + (segment.endMinutes - segment.startMinutes),
        0
      )
      expect(minutes).toBeGreaterThanOrEqual(problem.rules.minimumShiftMinutes)
      expect(minutes).toBeLessThanOrEqual(problem.rules.maximumShiftMinutes)
    }
  })

  it("assure une fermeture par jour ouvert et douze heures de repos", () => {
    for (const day of problem.days.filter((entry) => !entry.closed)) {
      const closers = solution!.assignments.filter(
        (assignment) =>
          assignment.date === day.date &&
          assignment.segments[assignment.segments.length - 1].endMinutes === day.closesAtMinutes
      )
      expect(closers).toHaveLength(problem.rules.exactClosingsPerDay)
    }

    for (const employee of problem.employees) {
      const worked = solution!.assignments
        .filter((assignment) => String(assignment.employeeId) === String(employee.id))
        .sort((left, right) => left.date.localeCompare(right.date))
      for (let index = 1; index < worked.length; index++) {
        const previous = worked[index - 1]
        const current = worked[index]
        const gapDays =
          (Date.parse(`${current.date}T00:00:00Z`) - Date.parse(`${previous.date}T00:00:00Z`)) /
          86_400_000
        const rest =
          gapDays * 1_440 -
          previous.segments[previous.segments.length - 1].endMinutes +
          current.segments[0].startMinutes
        expect(rest).toBeGreaterThanOrEqual(problem.rules.minimumRestMinutes)
      }
    }
  })

  it("pose tout sur le pas de 15 minutes", () => {
    for (const assignment of solution!.assignments) {
      for (const segment of assignment.segments) {
        expect(segment.startMinutes % problem.timeStepMinutes).toBe(0)
        expect(segment.endMinutes % problem.timeStepMinutes).toBe(0)
      }
    }
  })

  it("traite le déficit souple comme une dégradation, jamais comme un blocage", () => {
    expect(report!.degradations.some((entry) => entry.rule === "coverage-deficit")).toBe(true)
    for (const degradation of report!.degradations) {
      expect(degradation.severity).toBe("degradation")
    }
    expect(report!.requiresExplicitAcceptance).toBe(true)
  })

  it("annonce un déficit que le validateur recalcule à l'identique", () => {
    // Le contre-contrôle : le moteur s'engage sur un chiffre, le validateur le
    // recalcule de zéro. Un désaccord serait une violation bloquante.
    expect(solution!.declaredMetrics?.totalDeficitMinutes).toBe(
      report!.metrics.totalDeficitMinutes
    )
    expect(report!.violations.some((v) => v.rule === "declared-metrics")).toBe(false)
  })

  it("est déterministe sur trois exécutions", () => {
    const runs = [run, solveDecomposed(problem, OPTIONS), solveDecomposed(problem, OPTIONS)]
    const schedules = runs.map((entry) => JSON.stringify(entry.result.solution?.assignments))
    expect(new Set(schedules).size).toBe(1)
    const objectives = runs.map((entry) => JSON.stringify(entry.result.objective))
    expect(new Set(objectives).size).toBe(1)
    // L'empreinte est un résumé indépendant de la solution : deux exécutions
    // qui la partagent ont produit exactement le même planning.
    const fingerprints = runs.map((entry) => entry.report.solutionFingerprint)
    expect(new Set(fingerprints).size).toBe(1)
  }, 180_000)

  it("rapporte les diagnostics techniques que la consigne demande", () => {
    expect(run.report.totalMs).toBeGreaterThanOrEqual(0)
    expect(run.report.phaseMs.length).toBeGreaterThan(0)
    expect(run.report.allocationsTested).toBeGreaterThan(0)
    expect(run.report.skeletonsTested).toBeGreaterThan(0)
    expect(run.report.candidatesGenerated).toBeGreaterThan(0)
    expect(run.report.problemFingerprint).toMatch(/^p3_/)
    expect(run.report.solutionFingerprint).not.toBeNull()
    expect(run.report.stopCause).toBeTruthy()
    expect(run.report.bestObjective).not.toBeNull()
  })
})

describe("Drive — qualité mesurée face aux moteurs existants", () => {
  it("génère un espace de candidats bien plus petit que l'énumération exhaustive", () => {
    // CP-SAT a énuméré 20 150 candidats sur cette même semaine
    // (`drive-solve-response-current.json`). La décomposition retire une
    // dimension entière : après la Phase 2 la durée est décidée, seul le départ
    // reste libre.
    expect(run.report.candidatesGenerated).toBeLessThan(20_150)
  })

  it("mesure l'écart actuel du moteur décomposé", () => {
    expect(report!.underCoveredSlots).toBe(DECOMPOSED_UNDER_COVERED_SLOTS)
    // Même chiffre que CP-SAT, mais sur un problème STRICTEMENT PLUS
    // CONTRAINT et en quelques secondes au lieu de 120. Aucune des deux
    // moitiés de cette phrase ne suffit seule, donc les deux sont écrites.
    expect(report!.underCoveredSlots).toBeLessThanOrEqual(
      CP_SAT_UNDER_COVERED_SLOTS_EASIER_PROBLEM
    )
    expect(run.report.totalMs).toBeLessThan(120_000)
    // Toujours moins bon que le moteur de production. Écrit ici pour que
    // l'écart reste lisible, pas pour être contourné.
    expect(report!.underCoveredSlots).toBeGreaterThan(SPRINT_3D1_UNDER_COVERED_SLOTS)
  })

  /**
   * L'objectif d'acceptation, gardé comme LIMITATION EXÉCUTABLE VIA UN ÉCHEC
   * ATTENDU — même dispositif que pour le prototype DFS.
   *
   * `it.fails` affirme que l'assertion ci-dessous échoue ENCORE. Tant que le
   * moteur reste au-dessus de la barre, la suite est verte : le manque est
   * enregistré, pas alarmant. Le jour où la recherche atteint la barre,
   * l'assertion passe, `it.fails` rougit, et c'est le signal de retirer le
   * marqueur. L'exigence ne peut donc jamais être discrètement abandonnée.
   */
  it.fails(
    `[LIMITATION EXÉCUTABLE] le moteur décomposé doit descendre à ${SPRINT_3D1_UNDER_COVERED_SLOTS} créneaux sous-couverts ou moins`,
    () => {
      expect(report!.underCoveredSlots).toBeLessThanOrEqual(SPRINT_3D1_UNDER_COVERED_SLOTS)
    }
  )
})
