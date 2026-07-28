import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { buildDriveCanonicalProblem } from "@/features/core/planning-v3/__tests__/drive-canonical"
import type { PlanningSolutionV3 } from "@/features/core/planning-v3/types/solution"
import { validatePlanningSolutionV3 } from "@/features/core/planning-v3/validator"

interface SolverResult {
  readonly status: string
  readonly solution: PlanningSolutionV3
}

const resultPath = join(
  process.cwd(),
  "shiftos-highs-solver",
  "results",
  "drive-canonical-highs-result.json"
)
const result = JSON.parse(readFileSync(resultPath, "utf8")) as SolverResult
const problem = buildDriveCanonicalProblem()
const report = validatePlanningSolutionV3(problem, result.solution)

describe("Python/HiGHS — parité Drive canonique", () => {
  it("répond au bon problème", () => {
    expect(result.status).toBe("feasible")
    expect(result.solution.problemFingerprint).toBe("p3_f5a81f5b6eacfcff")
  })

  it("est accepté par le validateur officiel", () => {
    expect(report.violations).toEqual([])
    expect(report.validHardConstraints).toBe(true)
  })

  it("atteint zéro déficit", () => {
    expect(report.underCoveredSlots).toBe(0)
    expect(report.metrics.totalDeficitMinutes).toBe(0)
  })
})
