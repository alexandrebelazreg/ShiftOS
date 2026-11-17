"use client"

import { X } from "lucide-react"

import type { IsoDate } from "@/features/core/models"
import { WEEK_DAY_LABELS } from "@/features/employees/utils/employee.labels"
import type {
  PermanenceCalendar,
  PermanenceDay,
} from "@/features/permanence/calendar/permanence-calendar"
import type { PermanenceMember } from "@/features/permanence/domain/permanence-roster"
import type { PermanenceTraining } from "@/features/permanence/domain/permanence-training"
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
  trainingByDate,
  onAssign,
  onToggleRest,
  onOnCall,
  onAddTraining,
  onRemoveTraining,
}: {
  readonly calendar: PermanenceCalendar
  readonly month: PermanenceMonth
  readonly roster: readonly PermanenceMember[]
  /** Qui est en congés validés, semaine par semaine — lu, jamais saisi. */
  readonly paidLeaveByWeek: ReadonlyMap<string, readonly string[]>
  /** Qui est en formation, jour par jour — des absences, lues et écrites comme telles. */
  readonly trainingByDate: ReadonlyMap<IsoDate, readonly PermanenceTraining[]>
  readonly onAssign: (date: IsoDate, role: PermanenceRole, employeeId: string | null) => void
  readonly onToggleRest: (date: IsoDate, employeeId: string) => void
  readonly onOnCall: (weekKey: string, employeeId: string | null) => void
  readonly onAddTraining: (date: IsoDate, employeeId: string) => void
  readonly onRemoveTraining: (absenceId: string) => void
}) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      {/* LA LARGEUR NE DÉPEND PLUS DU CONTENU.
          Un tableau en disposition automatique laisse la case la plus large
          décider de sa colonne : deux repos posés sur un mardi élargissaient le
          mardi de tout le mois, et les six semaines se décalaient sous les
          yeux — au moment précis où l'on venait d'en changer une seule. La
          largeur est donc répartie ici une fois pour toutes, et c'est au
          contenu de s'y tenir : les pastilles de repos se replient. */}
      <table className="w-full table-fixed border-collapse text-sm">
        <colgroup>
          <col className="w-20" />
          {calendar.weeks[0]?.days.map((day) => <col key={day.weekDay} />)}
          <col className="w-24" />
          <col className="w-24" />
        </colgroup>
        {/* L'EN-TÊTE EST ÉCRIT UNE FOIS.
            Chaque semaine était son propre tableau, dans son propre cadre :
            « Lundi Mardi Mercredi Jeudi Vendredi Samedi · CP · Astreinte »
            réimprimé six fois pour un mois, mille quatre cents pixels pour ce
            qui en demande la moitié. Les semaines sont maintenant des BANDES
            d'un même tableau, et le mois se lit d'un seul coup — ce qui fait
            apparaître ce que six cadres séparés cachaient : la semaine du 3 et
            celle du 17 sont identiques poste pour poste. */}
        <thead>
          <tr>
            <th className="border-b border-r bg-muted p-2 text-left font-semibold">
              Sem.
            </th>
            {calendar.weeks[0]?.days.map((day) => (
              <th
                key={day.weekDay}
                scope="col"
                className={cn(
                  "border-b border-r p-2 text-center font-medium last:border-r-0",
                  day.weekDay === "saturday" || day.weekDay === "sunday"
                    ? "bg-orange-100 text-orange-900 dark:bg-orange-950/40 dark:text-orange-100"
                    : "bg-muted/40"
                )}
              >
                {WEEK_DAY_LABELS[day.weekDay]}
              </th>
            ))}
            <th className="border-b border-l bg-muted p-2 text-center font-semibold">CP</th>
            <th className="border-b border-l bg-muted p-2 text-center font-semibold">
              Astreinte
            </th>
          </tr>
        </thead>

        {calendar.weeks.map((week) => {
          const slots = weekSlotsOf(month, week.key)
          const onLeave = (paidLeaveByWeek.get(week.key) ?? []).filter((employeeId) =>
            roster.some((member) => member.employeeId === employeeId)
          )
          return (
            <tbody key={week.key} className="border-t-2">
              {/* LES DATES APPARTIENNENT À LA SEMAINE, pas à l'en-tête.
                  Un en-tête unique ne peut pas porter « Lundi 3 » — le lundi
                  change de date d'une bande à l'autre. Cette ligne fine les
                  donne, et c'est aussi elle qui nomme un férié : sans elle,
                  l'Assomption du samedi 15 aurait disparu de la feuille. */}
              <tr className="bg-muted/20">
                <th className="border-b border-r p-1.5 text-left align-middle font-semibold">
                  S{week.number}
                </th>
                {week.days.map((day) => (
                  <DayDateCell key={day.date} day={day} />
                ))}
                <td className="border-b border-l" colSpan={2} />
              </tr>

              {(["opening", "closing"] as const).map((role) => (
                <tr key={role}>
                  <th className="border-b border-r bg-muted/40 px-2 py-0.5 text-left text-xs font-medium">
                    {PERMANENCE_ROLE_LABELS[role]}
                  </th>
                  {week.days.map((day) => (
                    <td
                      key={day.date}
                      className={cn("border-b border-r p-0.5 last:border-r-0", closedCellClass(day))}
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
                      <td rowSpan={4} className="border-b border-l p-0.5 align-top">
                        <PaidLeaveCell roster={roster} onLeave={onLeave} />
                      </td>
                      <td rowSpan={4} className="border-b border-l p-0.5 align-top">
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
                <th className="border-b border-r bg-muted/40 px-2 py-0.5 text-left text-xs font-medium">Repos</th>
                {week.days.map((day) => (
                  <td
                    key={day.date}
                    className={cn(
                      "border-b border-r p-0.5 align-top last:border-r-0",
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

              {/* LA FORMATION SUIT LE REPOS : les deux disent « pas aux clés ce
                  jour-là », mais pour deux raisons que la paie ne confond pas —
                  une formation est du travail effectif, un repos non. */}
              <tr>
                <th className="border-b border-r bg-muted/40 px-2 py-0.5 text-left text-xs font-medium">Formation</th>
                {week.days.map((day) => (
                  <td
                    key={day.date}
                    className={cn(
                      "border-b border-r p-0.5 align-top last:border-r-0",
                      day.inMonth ? null : "bg-muted/60"
                    )}
                  >
                    {day.inMonth ? (
                      <TrainingCell
                        roster={roster}
                        trainings={(trainingByDate.get(day.date) ?? []).filter((training) =>
                          roster.some((member) => member.employeeId === training.employeeId)
                        )}
                        onAdd={(employeeId) => onAddTraining(day.date, employeeId)}
                        onRemove={onRemoveTraining}
                        dayLabel={day.label}
                      />
                    ) : null}
                  </td>
                ))}
              </tr>
            </tbody>
          )
        })}
      </table>
    </div>
  )
}

/**
 * La date du jour dans cette semaine-là, et son férié s'il en a un.
 *
 * Le NOM du jour n'est plus ici : il est dans l'en-tête unique, en haut du
 * tableau. Ne reste que ce qui change d'une bande à l'autre — le quantième, et
 * le nom du férié quand il y en a un.
 */
function DayDateCell({ day }: { readonly day: PermanenceDay }) {
  const weekend = day.weekDay === "saturday" || day.weekDay === "sunday"
  return (
    <td
      className={cn(
        "border-b border-r p-1 text-center text-xs font-medium tabular-nums last:border-r-0",
        !day.inMonth
          ? "bg-muted/60 text-muted-foreground"
          : day.holidayName
            ? "bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
            : weekend
              ? "bg-orange-100 text-orange-900 dark:bg-orange-950/40 dark:text-orange-100"
              : null
      )}
    >
      {day.inMonth ? day.label : "—"}
      {day.holidayName ? (
        <span className="ml-1 font-normal">· {day.holidayName}</span>
      ) : null}
    </td>
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
        "h-7 w-full rounded-md border border-input bg-transparent px-1.5 text-xs",
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
                  className="flex max-w-full items-center gap-1 rounded-full border bg-muted/60 px-2 py-0.5 text-xs hover:bg-muted"
                  aria-label={`Retirer ${member?.shortName ?? "cette personne"} des repos du ${dayLabel}`}
                >
                  <span className="min-w-0 truncate">{member?.shortName ?? "Hors tour"}</span>
                  <X className="size-3 shrink-0" aria-hidden />
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

/**
 * Les formations d'une journée : des pastilles, comme les repos, mais chacune
 * est une ABSENCE enregistrée — l'ajouter l'écrit dans l'écran des absences,
 * et la retirer l'y annule.
 *
 * Une formation de plusieurs jours n'a pas de croix : la retirer d'ici
 * annulerait aussi les autres journées, qu'on ne voit pas depuis cette case.
 */
function TrainingCell({
  roster,
  trainings,
  onAdd,
  onRemove,
  dayLabel,
}: {
  readonly roster: readonly PermanenceMember[]
  readonly trainings: readonly PermanenceTraining[]
  readonly onAdd: (employeeId: string) => void
  readonly onRemove: (absenceId: string) => void
  readonly dayLabel: string
}) {
  const available = roster.filter(
    (member) => !trainings.some((training) => training.employeeId === member.employeeId)
  )
  const pill =
    "flex max-w-full items-center gap-1 rounded-full border border-sky-300 bg-sky-50 px-2 py-0.5 text-xs text-sky-950 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-50"

  return (
    <div className="space-y-1">
      {trainings.length > 0 ? (
        <ul className="flex flex-wrap gap-1">
          {trainings.map((training) => {
            const name =
              roster.find((entry) => entry.employeeId === training.employeeId)?.shortName ??
              "Hors tour"
            return (
              <li key={training.absenceId}>
                {training.removable ? (
                  <button
                    type="button"
                    onClick={() => onRemove(training.absenceId)}
                    className={cn(pill, "hover:bg-sky-100 dark:hover:bg-sky-900/60")}
                    aria-label={`Retirer la formation de ${name} le ${dayLabel}`}
                  >
                    <span className="min-w-0 truncate">{name}</span>
                    <X className="size-3 shrink-0" aria-hidden />
                  </button>
                ) : (
                  <span
                    className={pill}
                    title="Formation de plusieurs jours : elle se corrige dans l’écran Absences."
                  >
                    <span className="min-w-0 truncate">{name}</span>
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      ) : null}
      {available.length > 0 ? (
        <select
          aria-label={`Ajouter une formation le ${dayLabel}`}
          value=""
          onChange={(event) => {
            if (event.target.value !== "") onAdd(event.target.value)
          }}
          className="h-7 w-full rounded-md border border-dashed border-input bg-transparent px-1.5 text-xs text-muted-foreground"
        >
          <option value="">+ formation</option>
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
