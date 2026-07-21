/**
 * Fairness Engine — public API.
 *
 * A pure, deterministic, sector-agnostic engine that MEASURES how fairly work
 * is distributed across a team and produces a `FairnessReport`. It analyzes a
 * planning; it never modifies, repairs or optimizes it, decides no business
 * policy, and touches no UI and no database.
 *
 * Typical use:
 *   const report = fairnessEngine.analyze({ planning, employees, assignments, statistics })
 *   // custom policy and/or dimension set:
 *   const report = fairnessEngine.analyze(input, { policy, registry })
 *
 * Dimensions are independently pluggable: each is a `FairnessDimensionCalculator`
 * (a per-employee value extractor) registered in a `FairnessRegistry`. Adding
 * one is a new calculator plus one registration — the engine itself never
 * changes. All fairness maths lives in `utils` and `distribution-analyzer`.
 *
 * Inputs come from sibling core engines:
 * - `statistics` → `@/features/core/statistics-engine` (EmployeeStatistics[])
 * - domain models → `@/features/core/models`
 */
export * from "@/features/core/fairness-engine/types"
export * from "@/features/core/fairness-engine/models"
export * from "@/features/core/fairness-engine/policies"
export * from "@/features/core/fairness-engine/registry"
export * from "@/features/core/fairness-engine/calculators"
export * from "@/features/core/fairness-engine/utils"
