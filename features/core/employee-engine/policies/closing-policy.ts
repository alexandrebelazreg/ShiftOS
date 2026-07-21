import type {
  PolicyContext,
  PolicyDecision,
} from "@/features/core/employee-engine/types"

/**
 * ClosingPolicy — decides whether an employee may take a closing shift in a
 * given context. Business policy; contract only (no implementation).
 */
export interface ClosingPolicy {
  canClose(context: PolicyContext): PolicyDecision
}
