import type {
  PolicyContext,
  PolicyDecision,
} from "@/features/core/employee-engine/types"

/**
 * OpeningPolicy — decides whether an employee may take an opening shift in a
 * given context. Business policy; contract only (no implementation).
 */
export interface OpeningPolicy {
  canOpen(context: PolicyContext): PolicyDecision
}
