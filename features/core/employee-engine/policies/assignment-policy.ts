import type {
  PolicyContext,
  PolicyDecision,
} from "@/features/core/employee-engine/types"

/**
 * AssignmentPolicy — the general decision of whether an employee may be
 * assigned to a shift in a given context. Business policy; contract only.
 */
export interface AssignmentPolicy {
  canAssign(context: PolicyContext): PolicyDecision
}
