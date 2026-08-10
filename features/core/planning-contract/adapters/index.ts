/**
 * The engine adapters — the ONLY modules allowed to name a solver.
 *
 * Kept out of the contract barrel on purpose. Importing a type from
 * `@/features/core/planning-contract` must never drag a search engine into the
 * bundle, and the composition layer that picks an engine must have to say so
 * explicitly, in one place, by importing this file.
 *
 * `v3-highs-fast` is deliberately NOT exported here. It reaches
 * `node:child_process` to run its model in a subprocess, which cannot be
 * bundled for a browser, so a single re-export from this barrel would break
 * every UI module that only wanted a type. It lives at
 * `@/features/core/planning-contract/adapters/highs-fast` and is imported on
 * purpose, from a server module.
 *
 * Since the other engines were deleted there is exactly one adapter, and this
 * barrel carries only the response translation every engine shares. The
 * `PlanningSolveAdapter` interface is kept even so: it is what stops the solve
 * route from reaching into the engine's internals, and it is the seam a second
 * engine would arrive through.
 */
export type { EnginePreservationSupport } from "@/features/core/planning-contract/adapters/from-audited-v3"
export { toSolvePlanningResponse } from "@/features/core/planning-contract/adapters/from-audited-v3"
