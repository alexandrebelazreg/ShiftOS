/**
 * Shape of a constraint's configurable parameters. This describes the
 * configuration surface (types, defaults, bounds) — it carries no business
 * values; concrete values are supplied by tenants/packs at build time.
 */
export const PARAMETER_TYPES = [
  "number",
  "boolean",
  "string",
  "time",
  "enum",
] as const
export type ParameterType = (typeof PARAMETER_TYPES)[number]

/** Metadata describing a single configurable parameter of a constraint. */
export interface ParameterDefinition {
  /** Config key, e.g. "minimumEmployees". */
  readonly key: string
  readonly label: string
  readonly type: ParameterType
  readonly required: boolean
  /** Structural default (not a business value). */
  readonly defaultValue?: unknown
  readonly description?: string
  /** Allowed values for `enum` parameters. */
  readonly options?: readonly string[]
  /** Bounds for `number` parameters. */
  readonly min?: number
  readonly max?: number
}

/** Runtime configuration values for a constraint (parameter key → value). */
export type ConstraintConfig = Record<string, unknown>
