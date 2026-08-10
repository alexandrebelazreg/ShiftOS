/**
 * Planning evaluation — public API.
 *
 * What remains of the old Planning Generator after the V2 business pipeline was
 * deleted: the EVALUATION half, and the input/settings vocabulary the V3
 * pipeline is built on.
 *
 * The module no longer produces a schedule. `v3-highs-fast` does that, through
 * the solve contract. What lives here is everything that reads one:
 *
 *   Assignments + Shifts → Constraint Engine → Coverage (Demand Engine)
 *                        → Fairness Engine → Scoring Engine
 *
 * It is kept under this name rather than renamed because the types it exports —
 * `PlanningGenerationInput`, `GenerationSettings`, `GenerationContext` — are the
 * vocabulary the V3 problem builder consumes, and moving them would be a rename
 * across the whole core for no behavioural gain.
 */
export * from "@/features/core/planning-generator/types"
export * from "@/features/core/planning-generator/utils"
export * from "@/features/core/planning-generator/builders"
export * from "@/features/core/planning-generator/generator"
