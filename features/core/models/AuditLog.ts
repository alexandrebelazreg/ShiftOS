import type {
  AuditLogId,
  IsoDateTime,
  OrganizationId,
  StoreId,
} from "@/features/core/models/common"

/**
 * The kind of entity an audit entry targets. Open set so new entity types are
 * auditable without changing this model.
 */
export const AUDIT_TARGET_TYPES = [
  "organization",
  "store",
  "employee",
  "contract",
  "planning",
  "assignment",
  "shift",
  "shift_template",
] as const
export type KnownAuditTargetType = (typeof AUDIT_TARGET_TYPES)[number]
export type AuditTargetType = KnownAuditTargetType | (string & {})

/**
 * AuditLog — an immutable record of a change in the system.
 *
 * Relationships:
 * - scoped to an Organization and (optionally) a Store.
 * - points at any entity generically via `targetType` + `targetId`.
 *
 * Authentication is not implemented yet, so the acting user is not modelled.
 */
export interface AuditLog {
  id: AuditLogId
  organizationId: OrganizationId
  storeId: StoreId | null

  occurredAt: IsoDateTime
  /** Verb describing what happened, e.g. "employee.disabled". Open string. */
  action: string
  targetType: AuditTargetType
  /** Id of the affected entity (kept as a plain string across entity types). */
  targetId: string
  /** Arbitrary structured context (before/after, fields changed, …). */
  metadata?: Record<string, unknown>

  // TODO: actor (acting user) once authentication exists.
}
