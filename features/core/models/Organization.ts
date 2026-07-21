import type { OrganizationId, Timestamps } from "@/features/core/models/common"

/**
 * Organization — the top-level tenant that owns one or more Stores.
 *
 * Relationships:
 * - has many Stores (see `Store.organizationId`).
 *
 * There is no authentication yet, so ownership/membership of an organization
 * is not modelled here.
 */
export interface Organization extends Timestamps {
  id: OrganizationId
  name: string
  // TODO: billing plan, subscription status, locale/defaults once defined.
}
