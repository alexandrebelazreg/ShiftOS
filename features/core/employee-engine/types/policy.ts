import type {
  Employee,
  IsoDateTime,
  Planning,
  Shift,
  Store,
} from "@/features/core/models"

/**
 * The verdict of a business policy. Carries an optional human-readable `reason`
 * so decisions can always be explained (a founding Planiteo principle).
 */
export interface PolicyDecision {
  readonly allowed: boolean
  readonly reason?: string
}

/**
 * Read-only inputs a policy reasons about. Composed from core domain models —
 * never redefined here. `shift` / `planning` are optional so the same context
 * type serves day-level and assignment-level policies.
 */
export interface PolicyContext {
  readonly now: IsoDateTime
  readonly store: Store
  readonly employee: Employee
  readonly shift?: Shift
  readonly planning?: Planning
}
