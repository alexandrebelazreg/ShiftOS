/**
 * The engine adapters — the ONLY modules allowed to name a solver.
 *
 * Kept out of the contract barrel on purpose. Importing a type from
 * `@/features/core/planning-contract` must never drag a search engine into the
 * bundle, and the composition layer that picks an engine must have to say so
 * explicitly, in one place, by importing this file.
 *
 * Every adapter satisfies `PlanningSolveAdapter`. A caller that holds one of
 * them as that type cannot tell which it is holding, which is the property the
 * whole contract exists to buy.
 */
export type { EnginePreservationSupport } from "@/features/core/planning-contract/adapters/from-audited-v3"
export { toSolvePlanningResponse } from "@/features/core/planning-contract/adapters/from-audited-v3"
export { solveWithLegacyV2Adapter } from "@/features/core/planning-contract/adapters/solve-with-legacy-v2"
export {
  createDfsPrototypeAdapter,
  PROTOTYPE_PRESERVATION_SUPPORT,
  solveWithDfsPrototype,
} from "@/features/core/planning-contract/adapters/solve-with-dfs-prototype"
export {
  CP_SAT_PRESERVATION_TARGET,
  solveWithCpSat,
} from "@/features/core/planning-contract/adapters/solve-with-cp-sat"
