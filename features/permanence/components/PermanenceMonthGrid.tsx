"use client"

import { X } from "lucide-react"

import type { IsoDate } from "@/features/core/models"
import { WEEK_DAY_LABELS } from "@/features/employees/utils/employee.labels"
import type {
  PermanenceCalendar,
  PermanenceDay,
} from "@/features/permanence/calendar/permanence-calendar"
import type { PermanenceMember } from "@/features/permanence/domain/permanence-roster"
import { weekSlotsOf } from "@/features/permanence/persistence/permanence-repository"
import {
  PERMANENCE_ROLE_LABELS,
  permanenceSlotKey,
  type PermanenceMonth,
  type PermanenceRole,
} from "@/features/permanence/models/permanence-month"
import { cn } from "@/lib/utils"

/**
 * La feuille de permanence, telle qu'elle était dans le classeur : une bande
 * par semaine, les jours en colonnes, les congés et l'astreinte à droite.
 *
 * La forme est reprise telle quelle parce qu'elle est LUE telle quelle — cette
 * feuille finit imprimée et punaisée, et une équipe qui la déchiffre depuis des
 * années n'a rien à gagner à ce qu'on la réinvente. Ce qui change tient en deux
 * points : les journées se choisissent dans une liste plutôt que de se taper,
 * et le dimanche a une colonne quand le magasin ouvre.
 *
 * Une case fermée ne se remplit pas. C'est la seule règle que la grille
 * applique elle-même : le reste — qui, combien de fois — appartient au
 * générateur et au récapitulatif.
 */
export function PermanenceMonthGrid({
  calendar,
  month,
  roster,
  paidLeaveByWeek,
  onAssign,
  onToggleRest,
  onOnCall,
}: {
  readonly calendar: PermanenceCalendar
  readonly month: PermanenceMonth
  readonly roster: readonly PermanenceMember[]
  /** Qui est en congés validés, semaine par semaine — lu, jamais saisi. */
  readonly paidLeaveByWeek: ReadonlyMap<string, readonly string[]>
  readonly onAssign: (date: IsoDate, role: PermanenceRole, employeeId: string | null) => void
  readonly onToggleRest: (date: IsoDate, employeeId: string) => void
  readonly onOnCall: (weekKey: string, employeeId: string | null) => void
}) {
  return (
    <div className="space-y-4">
      {calendar.weeks.map((week) => {
        const slots = weekSlotsOf(month, week.key)
        const onLeave = (paidLeaveByWeek.get(week.key) ?? []).filter((employeeId) =>
          roster.some((member) => member.employeeId === employeeId)
        )
        return (
          <div key={week.key} className="overflow-x-auto rounded-lg border">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="w-24 border-b border-r bg-muted p-2 text-left font-semibold">
                    S{week.number}
                  </th>
                  {week.days.map((day) => (
                    <DayHeader key={day.date} day={day} />
                  ))}
                  <th className="w-32 border-b border-l bg-muted p-2 text-center font-semibold">
                    CP
                  </th>
                  <th className="w-32 border-b border-l bg-muted p-2 text-center font-semibold">
                    Astreinte
                  </th>
                </tr>
              </thead>
              <tbody>
                {(["opening", "closing"] as const).map((role) => (
                  <tr key={role}>
                    <th className="border-b border-r bg-muted/40 p-2 text-left font-medium">
                      {PERMANENCE_ROLE_LABELS[role]}
                    </th>
                    {week.days.map((day) => (
                      <td
                        key={day.date}
                        className={cn("border-b border-r p-1 last:border-r-0", closedCellClass(day))}
                      >
                        {day.open ? (
                          <PersonSelect
                            roster={roster}
                            value={month.assignments[permanenceSlotKey(day.date, role)] ?? null}
                            onChange={(employeeId) => onAssign(day.date, role, employeeId)}
                            ariaLabel={`${PERMANENCE_ROLE_LABELS[role]} du ${day.label}`}
                          />
                        ) : (
                          <ClosedCell day={day} />
                        )}
                      </td>
                    ))}
                    {role === "opening" ? (
                      <>
                        <td rowSpan={3} className="border-b border-l p-1 align-top">
                          <PaidLeaveCell roster={roster} onLeave={onLeave} />
                        </td>
                        <td rowSpan={3} className="border-b border-l p-1 align-top">
                          <PersonSelect
                            roster={roster}
                            value={slots.onCallEmployeeId}
                            onChange={(employeeId) => onOnCall(week.key, employeeId)}
                            ariaLabel={`Astreinte de la semaine ${week.number}`}
                          />
                        </td>
                      </>
                    ) : null}
                  </tr>
                ))}

                <tr>
                  <th className="border-r bg-muted/40 p-2 text-left font-medium">Repos</th>
                  {week.days.map((day) => (
                    <td
                      key={day.date}
                      className={cn(
                        "border-r p-1 align-top last:border-r-0",
                        day.inMonth ? null : "bg-muted/60"
                      )}
                    >
                      {day.inMonth ? (
                        <RestCell
                          roster={roster}
                          resting={month.rest[day.date] ?? []}
                          onToggle={(employeeId) => onToggleRest(day.date, employeeId)}
                          dayLabel={day.label}
                        />
                      ) : null}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        )
      })}
    </div>
  )
}

/** Le jour, sa date, et son férié s'il en a un — comme en tête de colonne de la feuille. */
function DayHeader({ day }: { readonly day: PermanenceDay }) {
  const weekend = day.weekDay === "saturday" || day.weekDay === "sunday"
  return (
    <th
      scope="col"
      className={cn(
        "min-w-32 border-b border-r p-2 text-center font-medium last:border-r-0",
        !day.inMonth
          ? "bg-muted/60 text-muted-foreground"
          : day.holidayName
            ? "bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
            : weekend
              ? "bg-orange-100 text-orange-900 dark:bg-orange-950/40 dark:text-orange-100"
              : "bg-muted/40"
      )}
    >
      <span className="block">{WEEK_DAY_LABELS[day.weekDay]}</span>
      <span className="block text-xs font-normal tabular-nums">
        {day.inMonth ? day.label : "—"}
      </span>
      {day.holidayName ? (
        <span className="block text-xs font-normal">{day.holidayName}</span>
      ) : null}
    </th>
  )
}

function ClosedCell({ day }: { readonly day: PermanenceDay }) {
  return (
    <p className="px-2 py-1.5 text-center text-xs font-medium text-muted-foreground">
      {day.closedLabel}
    </p>
  )
}

function closedCellClass(day: PermanenceDay): string | null {
  if (!day.inMonth) return "bg-muted/60"
  return day.open ? null : "bg-muted"
}

/**
 * Les congés de la semaine : une lecture, pas une saisie.
 *
 * Les noms viennent des campagnes de congés validées. Rien ne se clique ici —
 * un congé se décide dans l'écran des congés, et pouvoir le contredire depuis
 * la feuille de permanence aurait fait exister deux réponses à la même question.
 */
function PaidLeaveCell({
  roster,
  onLeave,
}: {
  readonly roster: readonly PermanenceMember[]
  readonly onLeave: readonly string[]
}) {
  if (onLeave.length === 0) {
    return <p className="px-1.5 py-1 text-center text-xs text-muted-foreground">—</p>
  }

  return (
    <ul className="flex flex-wrap gap-1">
      {onLeave.map((employeeId) => (
        <li
          key={employeeId}
          className="rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100"
        >
          {roster.find((member) => member.employeeId === employeeId)?.shortName ?? "Hors tour"}
        </li>
      ))}
    </ul>
  )
}

/**
 * Le choix d'une personne, en liste déroulante native.
 *
 * Native, et non le composant `Select` de l'application : une feuille de mois
 * compte plus de cent cases, et cent listes déroulantes montées en React
 * rendent le défilement poussif pour un gain d'apparence nul dans une case de
 * huit millimètres.
 */
function PersonSelect({
  roster,
  value,
  onChange,
  ariaLabel,
}: {
  readonly roster: readonly PermanenceMember[]
  readonly value: string | null
  readonly onChange: (employeeId: string | null) => void
  readonly ariaLabel: string
}) {
  // Une personne retirée du tour laisse son nom dans les feuilles déjà faites ;
  // la case le montre plutôt que de paraître vide et de fausser la relecture.
  const orphan = value !== null && !roster.some((member) => member.employeeId === value)

  return (
    <select
      aria-label={ariaLabel}
      value={value ?? ""}
      onChange={(event) => onChange(event.target.value === "" ? null : event.target.value)}
      className={cn(
        "h-8 w-full rounded-md border border-input bg-transparent px-1.5 text-sm",
        value === null ? "text-muted-foreground" : "font-medium"
      )}
    >
      <option value="">—</option>
      {roster.map((member) => (
        <option key={member.employeeId} value={member.employeeId}>
          {member.shortName}
        </option>
      ))}
      {orphan ? <option value={value}>Hors tour</option> : null}
    </select>
  )
}

/**
 * Les repos d'une journée : plusieurs personnes, donc des pastilles et non une
 * liste déroulante — c'est le seul endroit de la feuille où une case porte
 * plusieurs noms, et forcer un choix unique aurait obligé à en cacher.
 */
function RestCell({
  roster,
  resting,
  onToggle,
  dayLabel,
}: {
  readonly roster: readonly PermanenceMember[]
  readonly resting: readonly string[]
  readonly onToggle: (employeeId: string) => void
  readonly dayLabel: string
}) {
  const available = roster.filter((member) => !resting.includes(member.employeeId))

  return (
    <div className="space-y-1">
      {resting.length > 0 ? (
        <ul className="flex flex-wrap gap-1">
          {resting.map((employeeId) => {
            const member = roster.find((entry) => entry.employeeId === employeeId)
            return (
              <li key={employeeId}>
                <button
                  type="button"
                  onClick={() => onToggle(employeeId)}
                  className="flex items-center gap-1 rounded-full border bg-muted/60 px-2 py-0.5 text-xs hover:bg-muted"
                  aria-label={`Retirer ${member?.shortName ?? "cette personne"} des repos du ${dayLabel}`}
                >
                  {member?.shortName ?? "Hors tour"}
                  <X className="size-3" aria-hidden />
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}
      {available.length > 0 ? (
        <select
          aria-label={`Ajouter un repos le ${dayLabel}`}
          value=""
          onChange={(event) => {
            if (event.target.value !== "") onToggle(event.target.value)
          }}
          className="h-7 w-full rounded-md border border-dashed border-input bg-transparent px-1.5 text-xs text-muted-foreground"
        >
          <option value="">+ repos</option>
          {available.map((member) => (
            <option key={member.employeeId} value={member.employeeId}>
              {member.shortName}
            </option>
          ))}
        </select>
      ) : null}
    </div>
  )
}
