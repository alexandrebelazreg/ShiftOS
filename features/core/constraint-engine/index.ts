/**
 * Constraint Engine — public API.
 *
 * An executable, sector-agnostic engine that EVALUATES a planning against every
 * registered constraint and produces a report. It performs no scheduling,
 * generation, optimization, search or repair.
 *
 * Typical use: create a registry, register constraints, evaluate a context.
 *   const registry = createConstraintRegistry()
 *   registerBuiltInConstraints(registry)
 *   const report = constraintEvaluator.evaluate(registry, context)
 *
 * Domain data (Employee, Shift, Assignment, …) comes from
 * `@/features/core/models`; calculators from `@/features/core/employee-engine`.
 */
export * from "@/features/core/constraint-engine/types"
export * from "@/features/core/constraint-engine/models"
export * from "@/features/core/constraint-engine/registry"
export * from "@/features/core/constraint-engine/evaluator"
export * from "@/features/core/constraint-engine/constraints"
export * from "@/features/core/constraint-engine/utils"
