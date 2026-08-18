"use client"

import type { AbsenceMonth, AbsenceMonthCell } from "@/features/absences/calendar/absence-month"
import { WEEK_DAY_SHORT_LABELS } from "@/features/employees/utils/employee.labels"
import { cn } from "@/lib/utils"

/**
 * Le mois d'absences : un salarié par ligne, un jour par colonne.
 *
 * Chaque motif a sa couleur, et la légende est sous le tableau : sur trente
 * lignes, écrire « Maladie » dans chaque case rendrait la grille illisible,
 * alors que la couleur se lit sans être lue. Le nom du motif reste dans
 * l'infobulle de la case, pour qui doute.
 *
 * Une demi-journée se montre par un demi-fond, pas par un signe : c'est la
 * seule façon de voir d'un coup d'œil, sur un mois entier, qu'une personne
 * s'absente tous les jeudis après-midi.
 */

const MOTIVE_CLASSES: Record<string, string> = {
  sick_leave: "bg-rose-200 text-rose-950 dark:bg-rose-900 dark:text-rose-50",
  work_accident: "bg-red-300 text-red-950 dark:bg-red-900 dark:text-red-50",
  maternity: "bg-fuchsia-200 text-fuchsia-950 dark:bg-fuchsia-900 dark:text-fuchsia-50",
  parental_leave: "bg-purple-200 text-purple-950 dark:bg-purple-900 dark:text-purple-50",
  family_event: "bg-orange-200 text-orange-950 dark:bg-orange-900 dark:text-orange-50",
  unpaid_leave: "bg-stone-300 text-stone-950 dark:bg-stone-700 dark:text-stone-50",
  training: "bg-sky-200 text-sky-950 dark:bg-sky-900 dark:text-sky-50",
  delegation: "bg-teal-200 text-teal-950 dark:bg-teal-900 dark:text-teal-50",
  unjustified: "bg-zinc-800 text-zinc-50 dark:bg-zinc-200 dark:text-zinc-900",
  paid_leave: "bg-emerald-200 text-emerald-950 dark:bg-emerald-900 dark:text-emerald-50",
  other: "bg-amber-200 text-amber-950 dark:bg-amber-900 dark:text-amber-50",
}

export function AbsenceMonthGrid({
  month,
  onPick,
}: {
  readonly month: AbsenceMonth
  /** Ouvre le détail d'une absence. Les cases vides ne font rien : la saisie
      passe par le formulaire, où le motif et le justificatif se décident. */
  readonly onPick: (cell: AbsenceMonthCell) => void
}) {
  if (month.rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
        Aucun salarié actif : les absences se saisissent sur une équipe.
      </p>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 min-w-40 bg-background p-1 text-left font-medium">
              Salarié
            </th>
            {month.days.map((day) => (
              <th
                key={day.date}
                className={cn(
                  "w-7 p-1 text-center font-normal",
                  day.open ? "text-muted-foreground" : "bg-muted/60 text-muted-foreground/60"
                )}
              >
                <span className="block">{WEEK_DAY_SHORT_LABELS[day.weekDay].charAt(0)}</span>
                <span className="block font-medium">{day.label}</span>
              </th>
            ))}
            <th className="w-12 p-1 text-center font-medium">Jours</th>
          </tr>
        </thead>
        <tbody>
          {month.rows.map((row) => (
            <tr key={row.employeeId} className="border-t border-border">
              <td className="sticky left-0 z-10 truncate bg-background p-1 font-medium">
                {row.name}
              </td>
              {row.cells.map((cell, index) => (
                <Cell
                  key={cell.date}
                  cell={cell}
                  closed={!month.days[index].open}
                  onPick={onPick}
                />
              ))}
              <td className="p-1 text-center tabular-nums text-muted-foreground">
                {row.daysOff === 0 ? "" : row.daysOff}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Cell({
  cell,
  closed,
  onPick,
}: {
  readonly cell: AbsenceMonthCell
  readonly closed: boolean
  readonly onPick: (cell: AbsenceMonthCell) => void
}) {
  if (cell.absence === null) {
    return <td className={cn("h-7 border-l border-border/50", closed && "bg-muted/60")} />
  }

  const tone = MOTIVE_CLASSES[cell.absence.type] ?? MOTIVE_CLASSES.other
  const title = `${cell.motiveLabel}${cell.locked ? " — campagne de congés, non modifiable ici" : ""}`

  return (
    <td className="h-7 border-l border-border/50 p-0">
      <button
        type="button"
        onClick={() => onPick(cell)}
        title={title}
        aria-label={title}
        className={cn(
          "flex h-7 w-full items-center justify-center text-[10px] font-semibold",
          tone,
          // La moitié couverte se voit dans le fond : un demi-carré en haut pour
          // le matin, en bas pour l'après-midi.
          cell.half === "morning" && "bg-gradient-to-b from-current/25 to-transparent",
          cell.half === "afternoon" && "bg-gradient-to-t from-current/25 to-transparent",
          cell.locked && "opacity-70"
        )}
      >
        {cell.half === null ? "" : cell.half === "morning" ? "M" : "A"}
      </button>
    </td>
  )
}

/** La légende, sous le tableau : les couleurs présentes ce mois-ci, et elles seules. */
export function AbsenceLegend({ month }: { readonly month: AbsenceMonth }) {
  const present = new Map<string, string>()
  for (const row of month.rows) {
    for (const cell of row.cells) {
      if (cell.absence && cell.motiveLabel) present.set(cell.absence.type, cell.motiveLabel)
    }
  }
  if (present.size === 0) return null

  return (
    <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
      {[...present.entries()].map(([type, label]) => (
        <span key={type} className="flex items-center gap-1.5">
          <span
            className={cn("inline-block size-3 rounded-sm", MOTIVE_CLASSES[type] ?? MOTIVE_CLASSES.other)}
          />
          {label}
        </span>
      ))}
    </div>
  )
}
