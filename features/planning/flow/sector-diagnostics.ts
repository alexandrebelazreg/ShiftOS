import { WEEK_DAYS, type WeekDay } from "@/features/core/models"
import { validateSectorDemand } from "@/features/sectors"
import type { SectorDemandConfiguration } from "@/features/sectors"
import type { EmployeeRecord } from "@/features/employees/types/employee.types"
import type { StoreConfig } from "@/features/store/schemas/store.schema"

/**
 * Why a sector cannot be planned — said precisely, before any engine is asked.
 *
 * Both engines already refuse a configuration they cannot handle, and both do
 * it correctly. What was missing is the sentence a manager can act on. V2
 * reported its refusal into a list of pipeline issues that the screen filtered
 * out before rendering, so a blocked run looked like a run that simply produced
 * a bad week. V3 reported a build error code. Neither told anyone which sector,
 * or what to change.
 *
 * This module answers that, once, for both engines — a configuration problem
 * belongs to the configuration, not to whichever solver happened to notice it.
 * It never repairs anything and never drops a sector: an incomplete sector
 * produces an error, not a quietly smaller planning.
 *
 * It diagnoses exactly the sectors it is given, and says nothing about any
 * other. Deciding WHICH sectors are in scope is `resolveGenerationScope`'s job,
 * and the separation is what stops an unselected sector from having an opinion
 * about a selected one.
 */

export interface SectorProblem {
  /** Null when the problem is about the selection as a whole. */
  readonly sectorId: string | null
  readonly sectorName: string
  readonly code: string
  /** Ready to display. Names the sector and what to change. */
  readonly message: string
}

const DAY_NAMES: Readonly<Record<WeekDay, string>> = {
  monday: "lundi",
  tuesday: "mardi",
  wednesday: "mercredi",
  thursday: "jeudi",
  friday: "vendredi",
  saturday: "samedi",
  sunday: "dimanche",
}

/** "lundi, mardi et mercredi" — a list a human reads, not an array dump. */
function listDays(days: readonly WeekDay[]): string {
  const names = days.map((day) => DAY_NAMES[day])
  if (names.length <= 1) return names.join("")
  return `${names.slice(0, -1).join(", ")} et ${names[names.length - 1]}`
}

export interface SectorDiagnosticsInput {
  readonly store: StoreConfig | null
  readonly sectors: readonly SectorDemandConfiguration[]
  readonly employees: readonly EmployeeRecord[]
}

export function diagnoseSectorConfiguration(
  input: SectorDiagnosticsInput
): readonly SectorProblem[] {
  const problems: SectorProblem[] = []
  const active = input.sectors.filter((sector) => sector.status === "active")

  if (active.length === 0) {
    return [
      {
        sectorId: null,
        sectorName: "",
        code: "no_active_sector",
        message:
          "Aucun secteur actif : activez le secteur à planifier avant de générer un planning.",
      },
    ]
  }

  // Every sector in scope is diagnosed, not just the first faulty one: someone
  // fixing their configuration should see everything at once rather than
  // discover the next problem after each correction.
  for (const sector of active) {
    problems.push(...diagnoseOneSector(sector, input))
  }

  return problems
}

function diagnoseOneSector(
  sector: SectorDemandConfiguration,
  input: SectorDiagnosticsInput
): readonly SectorProblem[] {
  const problems: SectorProblem[] = []
  const name = sector.name.trim() || "sans nom"
  const add = (code: string, message: string): void => {
    problems.push({ sectorId: sector.id, sectorName: name, code, message })
  }

  const openDays = WEEK_DAYS.filter((day) => {
    const hours = sector.hours.find((entry) => entry.day === day)
    return hours !== undefined && !hours.closed
  })

  if (openDays.length === 0) {
    add(
      "no_open_day",
      `Le secteur « ${name} » ne peut pas être planifié : aucun jour d'ouverture n'est configuré.`
    )
    // Everything below is measured per open day, so there is nothing further to
    // say — and saying "no budget on no days" would be noise.
    return problems
  }

  // Budget: an open day with a 0 % share receives no minutes at all, so the
  // day is open with nobody to staff it. This is the single most common way a
  // freshly created sector is incomplete.
  const withoutBudget = openDays.filter((day) => (sector.weeklyDistribution[day] ?? 0) <= 0)
  if (withoutBudget.length > 0) {
    add(
      "missing_daily_budget",
      `Le secteur « ${name} » ne peut pas être planifié : budget journalier manquant ${
        withoutBudget.length === openDays.length ? "sur tous les jours d'ouverture" : `les ${listDays(withoutBudget)}`
      }.`
    )
  }

  const withoutDemand = openDays.filter((day) => (sector.coverage.profiles[day] ?? []).length === 0)
  if (withoutDemand.length > 0) {
    add(
      "missing_demand",
      `Le secteur « ${name} » ne peut pas être planifié : aucun besoin en personnel ${
        withoutDemand.length === openDays.length ? "sur les jours d'ouverture" : `les ${listDays(withoutDemand)}`
      }.`
    )
  }

  const staffed = input.employees.filter(
    (employee) => employee.status === "active" && employee.sectors?.includes(sector.name)
  )
  if (staffed.length === 0) {
    add(
      "no_eligible_employee",
      `Aucun salarié n'est affecté au secteur « ${name} » : affectez-lui au moins un salarié actif.`
    )
  }

  // Whatever the sector editor itself considers invalid, reported with its own
  // wording rather than re-derived here — one definition of a valid sector.
  for (const issue of validateSectorDemand(sector, input.store)) {
    // Budget and demand already have a per-day message above; repeating the
    // generic one under a different wording would read as two problems.
    if (issue.path === "weeklyDistribution" && withoutBudget.length > 0) continue
    if (issue.path.startsWith("coverage.") && withoutDemand.length > 0) continue
    add(`invalid:${issue.path}`, `Secteur « ${name} » — ${issue.message}`)
  }

  return problems
}

/** True when nothing at all can be generated from this configuration. */
export function blocksGeneration(problems: readonly SectorProblem[]): boolean {
  return problems.length > 0
}
