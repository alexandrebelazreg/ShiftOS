import type {
  PlanningMode,
  SplitShiftPolicyKind,
  TimeGranularity,
  WeekDay,
} from "@/features/core/models"

/** Human-readable labels for each day of the week. */
export const WEEK_DAY_LABELS: Record<WeekDay, string> = {
  monday: "Lundi",
  tuesday: "Mardi",
  wednesday: "Mercredi",
  thursday: "Jeudi",
  friday: "Vendredi",
  saturday: "Samedi",
  sunday: "Dimanche",
}

export const PLANNING_MODE_OPTIONS: {
  value: PlanningMode
  label: string
  description: string
}[] = [
  {
    value: "shift_library",
    label: "Catalogue de services",
    description: "Construire le planning à partir de services définis à l’avance.",
  },
  {
    value: "dynamic",
    label: "Génération automatique",
    description: "Laisser ShiftOS créer les services dans les limites configurées.",
  },
]

export const SPLIT_SHIFT_POLICY_OPTIONS: {
  value: SplitShiftPolicyKind
  label: string
  description: string
}[] = [
  {
    value: "forbidden",
    label: "Interdites",
    description: "Une journée contient toujours une seule plage de travail.",
  },
  {
    value: "exceptional",
    label: "Exceptionnelles",
    description: "Possibles uniquement après une intervention manuelle.",
  },
  {
    value: "allowed",
    label: "Autorisées",
    description: "ShiftOS peut en proposer dans les limites indiquées.",
  },
  {
    value: "free",
    label: "Libres",
    description: "ShiftOS peut en proposer librement, dans les bornes indiquées.",
  },
]

export const TIME_GRANULARITY_OPTIONS: { value: TimeGranularity; label: string }[] =
  [
    { value: 15, label: "15 min" },
    { value: 30, label: "30 min" },
    { value: 60, label: "60 min" },
  ]

/**
 * Mocked reference data for the select inputs. Replace with a real source
 * (API / config) when the backend exists.
 */
export const COUNTRY_OPTIONS = [
  { value: "France", label: "France" },
  { value: "Belgium", label: "Belgique" },
  { value: "Spain", label: "Espagne" },
  { value: "Germany", label: "Allemagne" },
  { value: "United Kingdom", label: "Royaume-Uni" },
  { value: "United States", label: "États-Unis" },
] as const

export const TIMEZONE_OPTIONS = [
  { value: "Europe/Paris", label: "Paris — heure d’Europe centrale" },
  { value: "Europe/Brussels", label: "Bruxelles — heure d’Europe centrale" },
  { value: "Europe/Madrid", label: "Madrid — heure d’Europe centrale" },
  { value: "Europe/Berlin", label: "Berlin — heure d’Europe centrale" },
  { value: "Europe/London", label: "Londres — heure du Royaume-Uni" },
  { value: "America/New_York", label: "New York — heure de l’Est" },
] as const

export function countryLabel(value: string): string {
  return COUNTRY_OPTIONS.find((option) => option.value === value)?.label ?? value
}

export function timezoneLabel(value: string): string {
  return TIMEZONE_OPTIONS.find((option) => option.value === value)?.label ?? value
}

export function timeGranularityLabel(value: string | number): string {
  return (
    TIME_GRANULARITY_OPTIONS.find((option) => String(option.value) === String(value))
      ?.label ?? String(value)
  )
}

export function planningModeLabel(value: PlanningMode): string {
  return PLANNING_MODE_OPTIONS.find((option) => option.value === value)?.label ?? value
}

export function splitShiftPolicyLabel(value: SplitShiftPolicyKind): string {
  return SPLIT_SHIFT_POLICY_OPTIONS.find((option) => option.value === value)?.label ?? value
}
