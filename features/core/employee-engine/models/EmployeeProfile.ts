import type {
  CapabilityKey,
  Constraint,
  Contract,
  Employee,
  Preference,
} from "@/features/core/models"

import type { EmployeeAvailability } from "@/features/core/employee-engine/models/EmployeeAvailability"
import type { EmployeeScore } from "@/features/core/employee-engine/models/EmployeeScore"

/**
 * EmployeeProfile — the aggregate read-model the planning layer consumes:
 * everything about one employee in a single object.
 *
 * It COMPOSES the single-source-of-truth core models (identity, contract,
 * capabilities, constraints, preferences) with the engine-computed views
 * (availability, statistics, score). It duplicates none of them.
 *
 * Concept mapping (reuse, not redefinition):
 * - EmployeeProfile identity/status → core `Employee`
 * - EmployeeContract               → core `Contract`
 * - EmployeeCapability             → core `Capability` (referenced by key)
 * - EmployeeConstraint             → core `Constraint` (persisted record)
 * - EmployeePreference             → core `Preference`
 * - EmployeeStatus                 → core `EmployeeStatus` (on `employee`)
 */
export interface EmployeeProfile {
  /** Core identity + status — the source of truth. */
  readonly employee: Employee
  /** One-to-one contract; null until defined. */
  readonly contract: Contract | null
  /** Granted capability keys. */
  readonly capabilities: readonly CapabilityKey[]
  /** Persisted employee-constraint records (fixed days off, limits, …). */
  readonly constraints: readonly Constraint[]
  /** Soft preferences. */
  readonly preferences: readonly Preference[]

  /** Engine-computed availability for the profile's period. */
  readonly availability: EmployeeAvailability
  /** Engine-computed scoring; null when not yet computed. */
  readonly score: EmployeeScore | null

  // Statistics live in the dedicated statistics engine
  // (`@/features/core/statistics-engine`), the single source of truth, and are
  // no longer embedded here.
}
