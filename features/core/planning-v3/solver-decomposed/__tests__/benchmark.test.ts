import { writeFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

import type { PlanningProblemV3 } from "@/features/core/planning-v3/types/problem"
import { fingerprintProblem, validatePlanningSolutionV3 } from "@/features/core/planning-v3/validator"
import { solveDecomposed } from "@/features/core/planning-v3/solver-decomposed"
import {
  buildDriveCanonicalProblem,
  DRIVE_CANONICAL_RULES,
} from "@/features/core/planning-v3/__tests__/drive-canonical"
import { buildAccueilProblem } from "@/features/core/planning-v3/solver-decomposed/__tests__/accueil-problem"

/**
 * The benchmark — DELIBERATELY NON-BLOCKING.
 *
 * It measures and records; it does not gate. No threshold here is allowed to
 * fail the suite, because a timing assertion on a shared runner fails for
 * reasons that have nothing to do with the engine, and a flaky gate teaches
 * everyone to re-run until green.
 *
 * What it DOES assert is that the run happened and produced a legal schedule. A
 * benchmark measuring a broken engine measures nothing.
 *
 * ── Every entry carries its problem's fingerprint ─────────────────────────
 *
 * Not decoration. A parity experiment found three published Drive figures that
 * had been read as a comparison while describing three different problems: a
 * CP-SAT run cut off at 120 s, a CP-SAT run proven optimal on an older problem,
 * and a Python reference produced under rules the fixture did not encode. The
 * fingerprint is what makes that mistake impossible to repeat — two rows with
 * different fingerprints are two answers to two questions, and the report says
 * so.
 *
 * Drive is measured on the CANONICAL fixture, never on the legacy migration
 * one.
 */

const ENGINE_VERSION = "decomposed-v3/2 (skeleton scored by guaranteed deficit)"

interface Measurement {
  readonly scenario: string
  readonly problemFingerprint: string
  readonly engine: string
  readonly engineVersion: string
  readonly timeLimitMs: number
  readonly nodeLimit: number
  readonly stopCause: string
  /** What is PROVEN about the answer. Always `none` for this engine. */
  readonly proofKind: string
  readonly outcome: string
  readonly underCoveredSlots: number
  readonly deficitMinutes: number
  readonly validatorAcceptsHardConstraints: boolean
  readonly totalMs: number
  readonly phaseMs: Readonly<Record<string, number>>
  readonly allocationsTested: number
  readonly skeletonsGenerated: number
  readonly uniqueSkeletonSignatures: number
  readonly skeletonsPlaced: number
  readonly candidatesGenerated: number
  readonly placementNodes: number
  readonly repairsTested: number
  readonly repairsApplied: number
  readonly objective: Readonly<Record<string, number>>
  /** The structural rules that make this problem what it is. */
  readonly rulesSummary: Readonly<Record<string, unknown>>
  readonly schedule: readonly string[]
}

function clock(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`
}

function rulesSummaryOf(problem: PlanningProblemV3): Readonly<Record<string, unknown>> {
  return {
    employees: problem.employees.length,
    openDays: problem.days.filter((day) => !day.closed).length,
    contractMinutes: [...new Set(problem.employees.map((e) => e.contractMinutes))],
    maximumOpeningsPerEmployee: [...new Set(problem.employees.map((e) => e.maximumOpenings))],
    maximumClosingsPerEmployee: [...new Set(problem.employees.map((e) => e.maximumClosings))],
    minimumShiftMinutes: problem.rules.minimumShiftMinutes,
    maximumShiftMinutes: problem.rules.maximumShiftMinutes,
    maximumContinuousMinutes: problem.rules.maximumContinuousMinutes ?? null,
    splitWindowMinutes: [
      problem.rules.minimumSplitMinutes ?? null,
      problem.rules.maximumSplitMinutes ?? null,
    ],
    minimumRestMinutes: problem.rules.minimumRestMinutes,
    minimumOpeningsPerDay: problem.rules.minimumOpeningsPerDay,
    exactClosingsPerDay: problem.rules.exactClosingsPerDay,
    mandatoryDays: problem.employeeDays.filter((entry) => entry.mandatory).length,
    hardCoverageFloors: problem.demandSlots.filter(
      (slot) => slot.hardMinimumEmployees !== undefined
    ).length,
  }
}

function measure(scenario: string, problem: PlanningProblemV3): Measurement {
  const timeLimitMs = 45_000
  const nodeLimit = 6_000_000
  const run = solveDecomposed(problem, { timeoutMs: timeLimitMs, maximumPlacementNodes: nodeLimit })
  const solution = run.result.solution
  const report = solution === null ? null : validatePlanningSolutionV3(problem, solution)

  return {
    scenario,
    problemFingerprint: fingerprintProblem(problem),
    engine: "decomposed-v3",
    engineVersion: ENGINE_VERSION,
    timeLimitMs,
    nodeLimit,
    stopCause: run.report.stopCause,
    proofKind: run.result.proof.kind,
    outcome: run.result.status,
    underCoveredSlots: report?.underCoveredSlots ?? -1,
    deficitMinutes: report?.metrics.totalDeficitMinutes ?? -1,
    validatorAcceptsHardConstraints: report?.validHardConstraints ?? false,
    totalMs: run.report.totalMs,
    phaseMs: Object.fromEntries(run.report.phaseMs.map((entry) => [entry.phase, entry.durationMs])),
    allocationsTested: run.report.allocationsTested,
    skeletonsGenerated: run.report.skeletonsGenerated,
    uniqueSkeletonSignatures: run.report.uniqueSkeletonSignatures,
    skeletonsPlaced: run.report.skeletonsTested,
    candidatesGenerated: run.report.candidatesGenerated,
    placementNodes: run.report.placementNodes,
    repairsTested: run.report.repairsTested,
    repairsApplied: run.report.repairsApplied,
    objective: Object.fromEntries(
      (run.report.bestObjective ?? []).map((entry) => [entry.label, entry.value])
    ),
    rulesSummary: rulesSummaryOf(problem),
    schedule: (solution?.assignments ?? []).map(
      (assignment) =>
        `${assignment.date} ${String(assignment.employeeId).padEnd(10)} ${assignment.segments
          .map((segment) => `${clock(segment.startMinutes)}-${clock(segment.endMinutes)}`)
          .join(" + ")}`
    ),
  }
}

describe("benchmark du moteur décomposé (non bloquant)", () => {
  const measurements: Measurement[] = []

  it("mesure le scénario Drive canonique", () => {
    const measurement = measure("drive-canonical", buildDriveCanonicalProblem())
    measurements.push(measurement)

    // Les seules assertions : la mesure porte sur un moteur qui marche…
    expect(measurement.validatorAcceptsHardConstraints).toBe(true)
    // …et qui ne prétend rien démontrer.
    expect(measurement.proofKind).toBe("none")
    // …sur le problème canonique, pas sur un autre.
    expect(measurement.rulesSummary.maximumClosingsPerEmployee).toEqual([
      DRIVE_CANONICAL_RULES.maximumClosingsPerEmployee,
    ])
  }, 120_000)

  it("mesure le scénario Accueil", () => {
    const measurement = measure("accueil", buildAccueilProblem())
    measurements.push(measurement)

    expect(measurement.validatorAcceptsHardConstraints).toBe(true)
    expect(measurement.proofKind).toBe("none")
  }, 120_000)

  it("enregistre les mesures pour le rapport", () => {
    writeFileSync(
      "planning-v3-decomposed-benchmark.json",
      `${JSON.stringify({ measuredAt: "run-local", measurements }, null, 2)}\n`
    )
    expect(measurements).toHaveLength(2)
  })
})
