import type { IsoDateTime, OrganizationId, StoreId } from "@/features/core/models"

import type { StoreConfiguration } from "@/features/store/models"
import type { EmployeeRecord } from "@/features/employees/types/employee.types"

/**
 * The application-side data the bridge translates. These are the shapes the App
 * (Store module, Employee module, and future Leave / Absence modules) provides —
 * NOT core domain entities. The bridge is the only place they become core.
 *
 * Existing app types are reused (`StoreConfiguration`, `EmployeeRecord`) so no
 * shape is duplicated. Future modules contribute the plain DTOs below until they
 * exist.
 */

/** Store-module data: the configuration plus the identity fields it does not hold. */
export interface StoreInput {
  readonly storeId: StoreId
  readonly organizationId: OrganizationId
  readonly configuration: StoreConfiguration
  readonly address?: string
  readonly city?: string
  readonly postalCode?: string
}

/** Future Absence module — a plain absence record. */
export interface AbsenceInput {
  readonly id: string
  readonly employeeId: string
  readonly type?: string
  readonly start: string
  readonly end: string
  readonly note?: string
}

/** Future Leave / Availability module — a plain availability statement. */
export interface AvailabilityRuleInput {
  readonly id: string
  readonly employeeId: string
  readonly effect: string
  readonly kind: string
  readonly weekDay?: string | null
  readonly date?: string | null
  readonly range?: { readonly start: string; readonly end: string } | null
  readonly window?: {
    readonly start: string
    readonly end: string
    readonly endDayOffset?: number
  } | null
}

/** One demand window as the app expresses it. */
export interface DemandRequirementInput {
  readonly id: string
  readonly date: string
  readonly start: string
  readonly end: string
  readonly endDayOffset?: number
  readonly minEmployees: number
  readonly maxEmployees?: number | null
  readonly requiredCapabilities?: readonly string[]
  readonly priority?: string
}

/** The app's demand for a store over a period. */
export interface DemandInput {
  readonly id: string
  readonly requirements: readonly DemandRequirementInput[]
}

/** The run scope the app supplies for a planning (identity + horizon + clock). */
export interface PlanningScopeInput {
  readonly planningId: string
  readonly period: { readonly start: string; readonly end: string }
  readonly now: IsoDateTime
}

/**
 * BridgeInput — the complete application payload handed to the bridge. Employees
 * are the existing `EmployeeRecord`s; everything else is module DTOs.
 */
export interface BridgeInput {
  readonly store: StoreInput
  readonly employees: readonly EmployeeRecord[]
  readonly demand?: DemandInput
  readonly absences?: readonly AbsenceInput[]
  readonly availabilityRules?: readonly AvailabilityRuleInput[]
  readonly scope: PlanningScopeInput
}
