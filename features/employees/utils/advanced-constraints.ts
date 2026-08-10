import { WEEK_DAYS, type WeekDay } from "@/features/core/models"
import { WEEK_DAY_LABELS } from "@/features/employees/utils/employee.labels"

/**
 * The « Contraintes avancées » section, as data.
 *
 * The section is a fold in the employee card, and a fold hides things: a
 * manager who closed it must still be able to tell, without opening it, that
 * this employee is not on the house rules. That is what the summary is for, and
 * why it is computed here rather than inside the component — it is a reading of
 * the employee's configuration, not a rendering concern, and it has to be
 * testable without a DOM.
 *
 * Every entry is stated only when it DEPARTS from the default. An employee who
 * may open, may close, has no weekly cap, no hour bound and no split produces an
 * empty summary, which is exactly the case where the closed section says nothing.
 */

/**
 * The section starts closed. Advanced settings are the exception, so the card
 * must not open on them; a manager reaches for them deliberately.
 */
export const ADVANCED_CONSTRAINTS_OPEN_BY_DEFAULT = false

/**
 * The house rules an employee is measured against.
 *
 * Opening and closing are ordinary duties, granted until withdrawn. A split
 * shift is the opposite: it fragments someone's day, so it has to be granted.
 */
export const ADVANCED_CONSTRAINTS_DEFAULTS = {
  canOpen: true,
  canClose: true,
  splitShiftAllowed: false,
} as const

/**
 * Accepts both shapes the application holds: the persisted `EmployeeRecord`
 * (numbers, nullable) and the React Hook Form values (strings, empty when
 * unset). Both mean the same thing, and duplicating this reading for each would
 * guarantee the two drift.
 */
export interface AdvancedConstraintsInput {
  readonly canOpen: boolean
  readonly canClose: boolean
  readonly splitShiftAllowed: boolean
  readonly maxOpenings?: number | string | null
  readonly maxClosings?: number | string | null
  readonly earliestStartTime?: string | null
  readonly latestEndTime?: string | null
  readonly startTimeIsExact?: boolean
  readonly endTimeIsExact?: boolean
  readonly openingDays?: readonly WeekDay[] | null
  readonly closingDays?: readonly WeekDay[] | null
}

/** `null` for "not set"; an explicit 0 is a real cap and survives. */
function count(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  const trimmed = value.trim()
  if (trimmed === "") return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

/** `null` for "not set". Never "00:00", which would be a real bound. */
function time(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed === "" ? null : trimmed
}

/** `[]` for "not set". Ordered as the week runs, not as the manager clicked. */
function days(value: readonly WeekDay[] | null | undefined): readonly WeekDay[] {
  if (!Array.isArray(value)) return []
  return WEEK_DAYS.filter((day) => value.includes(day))
}

/** « lundi, mardi et samedi » — le résumé est une phrase, pas une liste. */
function listDays(value: readonly WeekDay[]): string {
  const labels = value.map((day) => WEEK_DAY_LABELS[day].toLowerCase())
  if (labels.length === 1) return labels[0]
  return `${labels.slice(0, -1).join(", ")} et ${labels[labels.length - 1]}`
}

function plural(value: number, singular: string, many: string): string {
  return value <= 1 ? singular : many
}

/**
 * One short sentence per active advanced constraint, in the order the fields
 * appear in the section. Empty when the employee follows the house rules.
 */
export function advancedConstraintsSummary(
  input: AdvancedConstraintsInput
): readonly string[] {
  const summary: string[] = []

  // « Commence à 9 h » et « pas avant 9 h » se saisissent au même endroit et
  // n'engagent pas la même chose ; le résumé doit les distinguer, sinon le
  // repli fermé fait passer une heure imposée pour une simple borne.
  const earliest = time(input.earliestStartTime)
  if (earliest !== null) {
    summary.push(input.startTimeIsExact === true ? `Commence à ${earliest}` : `Ne commence pas avant ${earliest}`)
  }

  const latest = time(input.latestEndTime)
  if (latest !== null) {
    summary.push(input.endTimeIsExact === true ? `Finit à ${latest}` : `Ne finit pas après ${latest}`)
  }

  if (input.canOpen !== ADVANCED_CONSTRAINTS_DEFAULTS.canOpen) summary.push("Ne peut pas ouvrir")
  if (input.canClose !== ADVANCED_CONSTRAINTS_DEFAULTS.canClose) summary.push("Ne peut pas fermer")

  // Le droit retiré l'emporte sur le devoir : quelqu'un qui ne peut pas ouvrir
  // n'a pas de jour d'ouverture, et l'annoncer serait un mensonge.
  const openingDays = input.canOpen === false ? [] : days(input.openingDays)
  if (openingDays.length > 0) summary.push(`Ouvre le ${listDays(openingDays)}`)

  const closingDays = input.canClose === false ? [] : days(input.closingDays)
  if (closingDays.length > 0) summary.push(`Ferme le ${listDays(closingDays)}`)

  const maxOpenings = count(input.maxOpenings)
  if (maxOpenings !== null) {
    summary.push(`${maxOpenings} ${plural(maxOpenings, "ouverture", "ouvertures")}/semaine max`)
  }

  const maxClosings = count(input.maxClosings)
  if (maxClosings !== null) {
    summary.push(`${maxClosings} ${plural(maxClosings, "fermeture", "fermetures")}/semaine max`)
  }

  if (input.splitShiftAllowed !== ADVANCED_CONSTRAINTS_DEFAULTS.splitShiftAllowed) {
    summary.push("Coupure autorisée")
  }

  return summary
}

/** True when at least one advanced constraint departs from the house rules. */
export function hasAdvancedConstraints(input: AdvancedConstraintsInput): boolean {
  return advancedConstraintsSummary(input).length > 0
}
