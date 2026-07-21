/**
 * Codes for the ways a mapping can fail. Facts about the INPUT, never a
 * judgement about the planning — the bridge detects data problems, it does not
 * evaluate or score.
 */
export const MAPPING_ERROR_CODES = [
  "missing_required",
  "invalid_value",
  "invalid_reference",
  "unknown_capability",
  "invalid_date",
] as const
export type MappingErrorCode = (typeof MAPPING_ERROR_CODES)[number]

/**
 * MappingError — one structured problem found while translating app data. `path`
 * locates it in the input (e.g. `employees[2].weeklyHours`) so a caller can
 * surface it precisely.
 */
export interface MappingError {
  readonly code: MappingErrorCode
  readonly path: string
  readonly message: string
  /** The kind of entity concerned, e.g. "employee", "store", "demand". */
  readonly entity?: string
  /** The offending id, when known. */
  readonly id?: string
}

/**
 * MappingResult — either the successfully mapped value, or the list of errors
 * that prevented mapping. A discriminated union so callers must handle both.
 */
export type MappingResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly MappingError[] }
