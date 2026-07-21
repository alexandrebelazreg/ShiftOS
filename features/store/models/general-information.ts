import type { CurrencyCode, WeekStart } from "@/features/store/types/configuration.types"

/**
 * GeneralInformation — store identity and locale settings. Facts only; no
 * planning logic depends on these beyond display and week framing.
 */
export interface GeneralInformation {
  readonly name: string
  /** IANA timezone, e.g. "Europe/Paris". */
  readonly timezone: string
  /** Country label or ISO 3166 code. */
  readonly country: string
  readonly currency: CurrencyCode
  /** The weekday planning weeks start on. */
  readonly weekStart: WeekStart
}
