import { describe, expect, it } from "vitest"

import type { ScoringPolicy } from "@/features/core/scoring-engine"
import {
  DEFAULT_SCORING_POLICY,
  scoringEngine,
} from "@/features/core/scoring-engine"

import {
  constraint,
  coverage,
  perfectCoverage,
  report,
} from "@/features/core/scoring-engine/__tests__/fixtures"

const T = DEFAULT_SCORING_POLICY.feasibilityThreshold // 0.6

describe("scoringEngine.score", () => {
  it("scores a perfect planning at the top of the range", () => {
    const input = {
      report: report([
        constraint({ id: "cov", type: "hard", category: "coverage", outcome: "pass" }),
        constraint({ id: "av", type: "hard", category: "availability", outcome: "pass" }),
        constraint({ id: "ct", type: "soft", category: "workload", outcome: "pass" }),
        constraint({ id: "fair", type: "soft", category: "fairness", outcome: "pass" }),
      ]),
      coverage: perfectCoverage(),
    }

    const score = scoringEngine.score(input)

    expect(score.feasible).toBe(true)
    expect(score.overall).toBe(1)
    expect(score.hard.score).toBe(1)
    expect(score.soft.score).toBe(1)
    expect(score.coverage.score).toBe(1)
    expect(score.contract.score).toBe(1)
    expect(score.availability.score).toBe(1)
    expect(score.warnings).toEqual([])
    expect(score.details.quality).toBe(1)
  })

  it("marks a single hard failure infeasible and gates the score below the threshold", () => {
    const input = {
      report: report([
        constraint({ id: "cov", type: "hard", category: "coverage", outcome: "pass" }),
        constraint({ id: "av", type: "hard", category: "availability", outcome: "fail" }),
        constraint({ id: "ct", type: "soft", category: "workload", outcome: "pass" }),
      ]),
      coverage: perfectCoverage(),
    }

    const score = scoringEngine.score(input)

    expect(score.feasible).toBe(false)
    expect(score.hard.failed).toBe(1)
    expect(score.hard.score).toBe(0.5) // 1 of 2 hard passed
    expect(score.overall).toBe(0.3) // threshold(0.6) * hard(0.5)
    expect(score.overall).toBeLessThan(T)
    expect(score.warnings.map((w) => w.code)).toEqual([
      "infeasible",
      "availability_conflict",
    ])
  })

  it("penalizes multiple soft failures but keeps the planning feasible", () => {
    const input = {
      report: report([
        constraint({ id: "cov", type: "hard", category: "coverage", outcome: "pass" }),
        constraint({ id: "av", type: "hard", category: "availability", outcome: "pass" }),
        constraint({ id: "ct", type: "soft", category: "workload", outcome: "warning" }),
        constraint({ id: "p1", type: "soft", category: "preference", outcome: "fail" }),
        constraint({ id: "p2", type: "soft", category: "preference", outcome: "warning" }),
        constraint({ id: "eq", type: "soft", category: "fairness", outcome: "fail" }),
      ]),
      coverage: perfectCoverage(),
    }

    const score = scoringEngine.score(input)

    expect(score.feasible).toBe(true)
    expect(score.soft.score).toBe(0.25) // (0 + 2*0.5) / 4
    expect(score.overall).toBe(0.9) // 0.6 + 0.4 * quality(0.75)
    expect(score.overall).toBeGreaterThanOrEqual(T)
    expect(score.warnings.map((w) => w.code)).toEqual([
      "contract_deviation",
      "soft_violations",
    ])
  })

  it("lowers the score on coverage degradation", () => {
    const input = {
      report: report([
        constraint({ id: "av", type: "hard", category: "availability", outcome: "pass" }),
        constraint({ id: "ct", type: "soft", category: "workload", outcome: "pass" }),
      ]),
      coverage: coverage({
        totalRequirements: 4,
        covered: 2,
        underCovered: 2,
        totalRequiredMin: 4,
        totalAssigned: 2,
        overallCoveragePercentage: 0.5,
      }),
    }

    const score = scoringEngine.score(input)

    expect(score.feasible).toBe(true)
    expect(score.coverage.score).toBe(0.5)
    expect(score.coverage.failed).toBe(2)
    expect(score.overall).toBe(0.92) // 0.6 + 0.4 * quality(0.8)
    expect(score.overall).toBeLessThan(scoringEngine.score({
      report: input.report,
      coverage: perfectCoverage(),
    }).overall)
    expect(score.warnings.map((w) => w.code)).toContain("coverage_gap")
  })

  it("handles a mixed scenario (partial coverage + soft warnings)", () => {
    const input = {
      report: report([
        constraint({ id: "cov", type: "hard", category: "coverage", outcome: "pass" }),
        constraint({ id: "av", type: "hard", category: "availability", outcome: "pass" }),
        constraint({ id: "ct", type: "soft", category: "workload", outcome: "warning" }),
        constraint({ id: "pf", type: "soft", category: "preference", outcome: "pass" }),
      ]),
      coverage: coverage({
        totalRequirements: 4,
        covered: 3,
        underCovered: 1,
        totalRequiredMin: 4,
        totalAssigned: 3,
        overallCoveragePercentage: 0.75,
      }),
    }

    const score = scoringEngine.score(input)

    expect(score.feasible).toBe(true)
    expect(score.coverage.score).toBe(0.75)
    expect(score.contract.score).toBe(0.5)
    expect(score.soft.score).toBe(0.75) // (1 + 1*0.5) / 2
    expect(score.overall).toBe(0.9) // 0.6 + 0.4 * quality(0.75)
    expect(score.warnings.map((w) => w.code)).toEqual([
      "coverage_gap",
      "contract_deviation",
      "soft_violations",
    ])
  })

  it("never lets excellent soft scores hide a hard failure", () => {
    // A: infeasible (1 of 2 hard fails) but otherwise perfect.
    const infeasible = scoringEngine.score({
      report: report([
        constraint({ id: "cov", type: "hard", category: "coverage", outcome: "pass" }),
        constraint({ id: "av", type: "hard", category: "availability", outcome: "fail" }),
        constraint({ id: "ct", type: "soft", category: "workload", outcome: "pass" }),
        constraint({ id: "pf", type: "soft", category: "preference", outcome: "pass" }),
      ]),
      coverage: perfectCoverage(),
    })

    // B: feasible but everything soft/coverage is as bad as possible.
    const feasibleButPoor = scoringEngine.score({
      report: report([
        constraint({ id: "av", type: "hard", category: "availability", outcome: "pass" }),
        constraint({ id: "ct", type: "soft", category: "workload", outcome: "fail" }),
        constraint({ id: "pf", type: "soft", category: "preference", outcome: "fail" }),
      ]),
      coverage: coverage({
        totalRequirements: 4,
        covered: 0,
        underCovered: 4,
        overallCoveragePercentage: 0,
      }),
    })

    expect(infeasible.feasible).toBe(false)
    expect(feasibleButPoor.feasible).toBe(true)
    expect(infeasible.overall).toBeLessThan(T)
    expect(feasibleButPoor.overall).toBeGreaterThanOrEqual(T)
    expect(infeasible.overall).toBeLessThan(feasibleButPoor.overall)
  })

  it("respects configurable weights", () => {
    const input = {
      report: report([
        constraint({ id: "av", type: "hard", category: "availability", outcome: "pass" }),
        constraint({ id: "s1", type: "soft", category: "preference", outcome: "fail" }),
        constraint({ id: "s2", type: "soft", category: "fairness", outcome: "fail" }),
      ]),
      coverage: perfectCoverage(),
    }

    const withDefaults = scoringEngine.score(input)

    // Weight soft far more heavily than coverage.
    const softHeavy: ScoringPolicy = {
      ...DEFAULT_SCORING_POLICY,
      weights: { coverage: 1, contract: 1, availability: 1, soft: 7 },
    }
    const withSoftHeavy = scoringEngine.score(input, softHeavy)

    expect(withSoftHeavy.overall).toBeLessThan(withDefaults.overall)
    // Same feasibility, different weighting of the same facts.
    expect(withSoftHeavy.feasible).toBe(true)
    expect(withDefaults.feasible).toBe(true)
  })

  it("honors a custom feasibility threshold", () => {
    const strict: ScoringPolicy = {
      ...DEFAULT_SCORING_POLICY,
      feasibilityThreshold: 0.8,
    }

    const perfect = scoringEngine.score(
      {
        report: report([
          constraint({ id: "av", type: "hard", category: "availability", outcome: "pass" }),
        ]),
        coverage: perfectCoverage(),
      },
      strict
    )

    const infeasible = scoringEngine.score(
      {
        report: report([
          constraint({ id: "cov", type: "hard", category: "coverage", outcome: "pass" }),
          constraint({ id: "av", type: "hard", category: "availability", outcome: "fail" }),
        ]),
        coverage: perfectCoverage(),
      },
      strict
    )

    expect(perfect.overall).toBe(1)
    expect(infeasible.overall).toBe(0.4) // 0.8 * hard(0.5)
    expect(infeasible.overall).toBeLessThan(0.8)
  })

  it("treats a planning with no constraints as vacuously perfect on those dimensions", () => {
    const score = scoringEngine.score({
      report: report([]),
      coverage: perfectCoverage(),
    })

    expect(score.feasible).toBe(true)
    expect(score.hard.score).toBe(1)
    expect(score.soft.score).toBe(1)
    expect(score.contract.score).toBe(1)
    expect(score.availability.score).toBe(1)
    expect(score.overall).toBe(1)
  })

  it("is deterministic for identical input", () => {
    const build = () => ({
      report: report([
        constraint({ id: "av", type: "hard", category: "availability", outcome: "pass" }),
        constraint({ id: "ct", type: "soft", category: "workload", outcome: "warning" }),
      ]),
      coverage: coverage({
        totalRequirements: 2,
        covered: 1,
        underCovered: 1,
        overallCoveragePercentage: 0.5,
      }),
    })

    expect(scoringEngine.score(build())).toEqual(scoringEngine.score(build()))
  })
})
