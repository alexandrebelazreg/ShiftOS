/**
 * Demand Engine — the universal, sector-agnostic workforce demand model.
 *
 * It represents demand as a set of `CoverageRequirement`s and compares that
 * demand against assignments via a pure `coverageCalculator`. It performs no
 * scheduling, optimization, constraint evaluation or generation.
 */
export * from "@/features/core/demand-engine/types"
export * from "@/features/core/demand-engine/models"
export * from "@/features/core/demand-engine/calculators"
export * from "@/features/core/demand-engine/services"
export * from "@/features/core/demand-engine/utils"
