/**
 * Types of lifecycle events recorded in an employee's history. OPEN set so new
 * event kinds can be added as data without changing the model.
 */
export const EMPLOYEE_LIFECYCLE_EVENT_TYPES = [
  "hired",
  "activated",
  "deactivated",
  "contract_changed",
  "capability_granted",
  "capability_revoked",
] as const
export type KnownEmployeeLifecycleEventType =
  (typeof EMPLOYEE_LIFECYCLE_EVENT_TYPES)[number]
export type EmployeeLifecycleEventType =
  | KnownEmployeeLifecycleEventType
  | (string & {})
