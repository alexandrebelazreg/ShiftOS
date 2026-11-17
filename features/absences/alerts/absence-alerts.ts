import type { IsoDate } from "@/features/core/models"
import type { PlanningSummary } from "@/features/planning/persistence/planning-record"
import { absenceOverlaps, isCancelled } from "@/features/absences/models/absence-period"
import {
  DEFAULT_ABSENCE_RULES,
  resolveMotive,
  type AbsenceRules,
} from "@/features/absences/models/absence-rules"
import type { AbsenceRecord } from "@/features/absences/types/absence-record"

/**
 * Les deux seules choses que cet écran réclame à quelqu'un.
 *
 * Elles s'affichent en bandeau, et le bandeau n'existe QUE s'il a quelque chose
 * à dire : un en-tête permanent qui répète « rien à signaler » devient un
 * en-tête qu'on ne lit plus, et le jour où il signale vraiment quelque chose il
 * ressemble à la veille.
 */

export interface AbsenceAlerts {
  /** Les absences tombant sur une période déjà planifiée. */
  readonly onPlannedWeeks: readonly PlannedCollision[]
  /** Les justificatifs qui devaient être arrivés. */
  readonly lateProofs: readonly LateProof[]
}

export interface PlannedCollision {
  readonly absence: AbsenceRecord
  readonly employeeName: string
  /**
   * Les périodes planifiées touchées, UNE fois chacune.
   *
   * Par période et non par planning : un brouillon et sa version affichée
   * couvrent la même semaine, et les énumérer tous deux disait deux fois la
   * même chose — « Market · 2026-09-07 → 2026-09-13 » trois fois de suite pour
   * une seule semaine à revoir.
   */
  readonly weeks: readonly PlannedWeek[]
}

export interface PlannedWeek {
  readonly periodStart: IsoDate
  readonly periodEnd: IsoDate
  /** Au moins un planning de cette période est déjà affiché au magasin. */
  readonly published: boolean
}

export interface LateProof {
  readonly absence: AbsenceRecord
  readonly employeeName: string
  readonly proofLabel: string
  readonly dueOn: IsoDate
  /** Jours de retard, à partir de la date à laquelle le papier était attendu. */
  readonly lateDays: number
}

export function buildAbsenceAlerts({
  today,
  absences,
  plannings,
  employeeNames,
  rules = DEFAULT_ABSENCE_RULES,
}: {
  readonly today: IsoDate
  readonly absences: readonly AbsenceRecord[]
  readonly plannings: readonly PlanningSummary[]
  readonly employeeNames: ReadonlyMap<string, string>
  /** Les règles en vigueur : le nom du papier réclamé peut avoir été changé. */
  readonly rules?: AbsenceRules
}): AbsenceAlerts {
  const live = absences.filter((absence) => !isCancelled(absence))

  return {
    onPlannedWeeks: live.flatMap((absence) => {
      // Un planning archivé, ou dont la semaine est TERMINÉE, est du passé : le
      // signaler ne demanderait aucune action, et noierait ceux sur lesquels on
      // peut encore agir. Sans cette seconde règle, le bandeau ressortait chaque
      // arrêt de septembre en novembre.
      const touched = plannings.filter(
        (planning) =>
          planning.status !== "archived" &&
          planning.periodEnd >= today &&
          absenceOverlaps(absence, planning.periodStart as IsoDate, planning.periodEnd as IsoDate)
      )
      if (touched.length === 0) return []
      return [
        {
          absence,
          employeeName: nameOf(employeeNames, absence.employeeId),
          weeks: plannedWeeks(touched),
        },
      ]
    }),

    lateProofs: live.flatMap((absence) => {
      if (absence.proofDueOn === undefined) return []
      if (absence.proofReceivedOn !== undefined) return []
      if (absence.proofDueOn >= today) return []
      const proof = resolveMotive(rules, absence.type).proof
      return [
        {
          absence,
          employeeName: nameOf(employeeNames, absence.employeeId),
          proofLabel: proof?.label ?? "Justificatif",
          dueOn: absence.proofDueOn as IsoDate,
          lateDays: daysBetween(absence.proofDueOn, today),
        },
      ]
    }),
  }
}

export function hasAlerts(alerts: AbsenceAlerts): boolean {
  return alerts.onPlannedWeeks.length > 0 || alerts.lateProofs.length > 0
}

/** Une ligne par période, la plus proche d'abord. */
function plannedWeeks(plannings: readonly PlanningSummary[]): readonly PlannedWeek[] {
  const byPeriod = new Map<string, PlannedWeek>()
  for (const planning of plannings) {
    const key = `${planning.periodStart}_${planning.periodEnd}`
    const published = planning.status === "published"
    const known = byPeriod.get(key)
    byPeriod.set(key, {
      periodStart: planning.periodStart as IsoDate,
      periodEnd: planning.periodEnd as IsoDate,
      published: published || (known?.published ?? false),
    })
  }
  return [...byPeriod.values()].sort((left, right) =>
    left.periodStart.localeCompare(right.periodStart)
  )
}

/** Le nombre de lignes que le bandeau a à dire. */
export function alertCount(alerts: AbsenceAlerts): number {
  return alerts.onPlannedWeeks.length + alerts.lateProofs.length
}

function nameOf(names: ReadonlyMap<string, string>, employeeId: string): string {
  return names.get(employeeId) ?? "Employé non renseigné"
}

function daysBetween(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`)
  const end = Date.parse(`${to}T00:00:00Z`)
  return Math.round((end - start) / 86_400_000)
}
