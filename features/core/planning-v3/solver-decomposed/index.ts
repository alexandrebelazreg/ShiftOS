/**
 * The decomposed Planning V3 engine — public surface.
 *
 * One entry point, `solveDecomposed`, plus the types a caller needs to read its
 * answer. The phase modules are deliberately NOT re-exported: they are an
 * implementation of a pipeline, not a toolkit, and a caller that reached for
 * `generateAllocations` on its own would be running half an engine.
 *
 * This module imports the V3 types, the shared minute primitives and the pure
 * problem fingerprint. It imports NO validator, no V2 pipeline, no CP-SAT
 * internals, no React and no Next.js — a rule enforced by
 * `__tests__/import-boundaries.test.ts`, which reads these sources.
 */
export { solveDecomposed } from "@/features/core/planning-v3/solver-decomposed/solve"
export type {
  DecomposedRun,
  DecomposedRunReport,
} from "@/features/core/planning-v3/solver-decomposed/solve"
export type {
  DecomposedOptions,
  DecomposedPhase,
  DecomposedStopCause,
} from "@/features/core/planning-v3/solver-decomposed/types"
export { DECOMPOSED_PHASES } from "@/features/core/planning-v3/solver-decomposed/types"
export {
  DECOMPOSED_OBJECTIVE_COMPONENTS,
  compareObjective,
  describeObjective,
} from "@/features/core/planning-v3/solver-decomposed/objective/objective"
export { MAXIMUM_DRIFT_MINUTES } from "@/features/core/planning-v3/solver-decomposed/repair/repair"
