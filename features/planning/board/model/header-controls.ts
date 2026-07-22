import { isoWeekNumber, mondayOf, shiftWeeks, weekPeriod } from "@/features/planning/board/model/week"

/**
 * The pure decisions behind the planning header.
 *
 * The header is presentational; every choice it looks like it makes — how to
 * name a sector selection, whether a week change needs a warning, which Monday
 * a navigation lands on, whether the primary action generates or regenerates —
 * is decided here, outside React, so each rule can be tested without a DOM and
 * reused by any control that needs it.
 */

// ── Sector selection ─────────────────────────────────────────────────────────

export interface SectorChoice {
  readonly id: string
  readonly name: string
  readonly selected: boolean
}

/**
 * The closed-label of the sector multiselect.
 *
 * Nothing is hard-coded: the combinations are read off the selection. "All"
 * wins over listing names, one or two selections show their names, and beyond
 * two it falls back to a count so the label never grows unbounded.
 */
export function summarizeSectorSelection(sectors: readonly SectorChoice[]): string {
  const selected = sectors.filter((sector) => sector.selected)
  const total = sectors.length
  if (selected.length === 0) return "Aucun secteur"
  if (total > 0 && selected.length === total) return "Tous les secteurs"
  if (selected.length === 1) return selected[0].name
  if (selected.length === 2) return `${selected[0].name} + ${selected[1].name}`
  return `${selected.length} secteurs`
}

// ── Primary action ───────────────────────────────────────────────────────────

export type PlanningPrimaryAction = "generate" | "regenerate"

/**
 * Whether the week the manager is *looking at* actually has a planning to show.
 *
 * This is deliberately not "does any planning exist": the generated planning
 * belongs to one specific week, and once the manager navigates away from it that
 * week no longer has anything displayable. Comparing the two weeks is what stops
 * a S30 grid appearing under a S31 header.
 */
export function hasPlanningForWeek(
  selectedWeek: string,
  generatedPlanningWeek: string | null
): boolean {
  return generatedPlanningWeek !== null && selectedWeek === generatedPlanningWeek
}

/**
 * The primary action for the selected week: regenerate the week that already
 * has a planning, generate the one that does not. Fed the week-specific answer
 * from {@link hasPlanningForWeek}, never a global "some planning exists".
 */
export function primaryPlanningAction(hasPlanningForSelectedWeek: boolean): PlanningPrimaryAction {
  return hasPlanningForSelectedWeek ? "regenerate" : "generate"
}

// ── Week navigation ──────────────────────────────────────────────────────────

export type WeekChangeRequest =
  | { readonly type: "previous" }
  | { readonly type: "next" }
  | { readonly type: "select"; readonly week: string }

/**
 * The Monday a navigation should land on.
 *
 * Snaps to the ISO Monday in every case, so a direct selection of any day in a
 * week behaves exactly like stepping to it with the arrows — the target is
 * always a canonical week start.
 */
export function resolveTargetWeek(currentWeek: string, request: WeekChangeRequest): string {
  switch (request.type) {
    case "previous":
      return shiftWeeks(currentWeek, -1)
    case "next":
      return shiftWeeks(currentWeek, 1)
    case "select":
      return mondayOf(request.week)
  }
}

/**
 * Whether changing week must ask first. Trivial today — it is exactly "are there
 * unsaved changes" — but naming it keeps the guard in one place, so the arrows
 * and any future week picker cannot disagree about when to warn.
 */
export function needsWeekChangeConfirmation(hasUnsavedChanges: boolean): boolean {
  return hasUnsavedChanges
}

export type WeekChangeChoice = "cancel" | "discard" | "save"

export interface WeekChangeOutcome {
  /** Whether to actually move to the target week. */
  readonly changeWeek: boolean
  /** Whether to drop the local edits and locks. */
  readonly discardLocalEdits: boolean
}

/**
 * What each answer to the unsaved-changes dialog does.
 *
 * Cancel keeps everything. Discard leaves and throws the local work away. Save
 * leaves — and discards — only if the save actually succeeded, so a failed save
 * never silently loses the week the manager was on.
 */
export function resolveWeekChangeChoice(
  choice: WeekChangeChoice,
  saveSucceeded: boolean
): WeekChangeOutcome {
  switch (choice) {
    case "cancel":
      return { changeWeek: false, discardLocalEdits: false }
    case "discard":
      return { changeWeek: true, discardLocalEdits: true }
    case "save":
      return { changeWeek: saveSucceeded, discardLocalEdits: saveSucceeded }
  }
}

// ── Week label ───────────────────────────────────────────────────────────────

const MONTHS = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
]

function longDate(date: string): string {
  const [, month, day] = date.split("-")
  return `${Number(day)} ${MONTHS[Number(month) - 1]}`
}

export interface WeekLabel {
  readonly title: string
  readonly range: string
}

/** "Semaine 30" and "20 juillet → 26 juillet" for the header's single week line. */
export function describeWeek(monday: string): WeekLabel {
  const period = weekPeriod(monday)
  return {
    title: `Semaine ${isoWeekNumber(monday)}`,
    range: `${longDate(period.start)} → ${longDate(period.end)}`,
  }
}
