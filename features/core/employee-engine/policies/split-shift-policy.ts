import type {
  PolicyContext,
  PolicyDecision,
} from "@/features/core/employee-engine/types"

/**
 * SplitShiftPolicy — decides whether an employee may work a split shift in a
 * given context. Business policy; contract only (no implementation).
 *
 * NOTE: this is a POLICY (a decision behaviour). It is distinct from the core
 * `SplitShiftPolicy` value object (`core/models/Store.ts`), which is the store's
 * split-shift CONFIGURATION this policy would read. See the technical-debt note
 * in the sprint report about renaming the core value object.
 */
export interface SplitShiftPolicy {
  allowsSplitShift(context: PolicyContext): PolicyDecision
}
