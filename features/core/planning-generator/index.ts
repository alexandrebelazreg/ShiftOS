/**
 * Planning Generator — public API.
 *
 * Produces a deterministic planning through the business pipeline, then
 * orchestrates the existing Core evaluation engines.
 *
 * Pipeline:
 *   Demand (input) → Planning Generator → Constraint Engine → Coverage (Demand
 *   Engine) → Fairness Engine → Scoring Engine
 *
 * Typical use:
 *   const registry = createConstraintRegistry()
 *   registerBuiltInConstraints(registry)
 *   const result = planningGenerator.generate({ store, employees, demand, registry, settings })
 *   // swap the algorithm without touching the generator:
 *   planningGenerator.generate(input, { strategy: myStrategy })
 *
 * The generator holds NO business rule — every rule lives in the injected
 * constraint registry and the downstream engines.
 */
export * from "@/features/core/planning-generator/types"
export * from "@/features/core/planning-generator/utils"
export * from "@/features/core/planning-generator/builders"
export * from "@/features/core/planning-generator/validators"
export * from "@/features/core/planning-generator/ranking"
export * from "@/features/core/planning-generator/strategies"
export * from "@/features/core/planning-generator/pipeline"
export * from "@/features/core/planning-generator/generator"
