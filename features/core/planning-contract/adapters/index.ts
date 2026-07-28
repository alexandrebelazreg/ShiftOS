/**
 * The engine adapters — the ONLY modules allowed to name a solver.
 *
 * Kept out of the contract barrel on purpose. Importing a type from
 * `@/features/core/planning-contract` must never drag a search engine into the
 * bundle, and the composition layer that picks an engine must have to say so
 * explicitly, in one place, by importing this file.
 *
 * CP-SAT is deliberately NOT exported here. It reaches `node:child_process` to
 * run its model in a subprocess, which cannot be bundled for a browser, so a
 * single re-export from this barrel would break every UI module that only
 * wanted a type. It lives at `@/features/core/planning-contract/adapters/cp-sat`
 * and is imported on purpose, from a server module.
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
// Exportable from this barrel, unlike CP-SAT: the decomposed engine is pure
// TypeScript running in process, so it reaches no `node:` module and bundles
// for a browser without dragging a subprocess in.
export {
  createDecomposedV3Adapter,
  DECOMPOSED_PRESERVATION_SUPPORT,
  solveWithDecomposedV3,
} from "@/features/core/planning-contract/adapters/solve-with-decomposed-v3"
