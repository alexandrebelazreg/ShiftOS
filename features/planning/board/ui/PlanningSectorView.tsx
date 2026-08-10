import { cn } from "@/lib/utils"

import type { EmployeeId } from "@/features/core/models"
import type { BoardSectorViewVM } from "@/features/planning/board/model/board-view-model"
import { sectorBarsOf } from "@/features/planning/board/model/sector-paint"
import { KIND_DOT, KIND_LEGEND, KIND_SURFACE, LEVEL_TEXT } from "@/features/planning/board/ui/level-styles"

interface PlanningSectorViewProps {
  readonly sectorView: BoardSectorViewVM
  readonly onSelectEmployee: (employeeId: EmployeeId) => void
}

/**
 * The week grid: one row per employee, one column per day, each shift a card.
 *
 * Planned versus contracted hours sit UNDER the name rather than in a column of
 * their own. The column cost a seventh of the table's width to carry one line
 * per row, squeezing the days it was meant to help read; under the name it is
 * where the eye already is when it asks "who is this and are they at their
 * hours?".
 *
 * The footer adds the one figure no row can give: everyone's hours per day.
 * Each employee's week can be individually correct while the whole team leans
 * on Friday, and that is only visible as a column total.
 */
export function PlanningSectorView({ sectorView, onSelectEmployee }: PlanningSectorViewProps) {
  return (
    <div className="space-y-3">
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {KIND_LEGEND.map((entry) => (
          <li key={entry.kind} className="flex items-center gap-1.5">
            <span className={cn("size-2.5 rounded-full", KIND_DOT[entry.kind])} aria-hidden />
            {entry.label}
          </li>
        ))}
        <li className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full border border-border bg-background" aria-hidden />
          Repos
        </li>
      </ul>

    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b bg-muted/30">
            <th className="sticky left-0 z-10 w-48 bg-muted/30 px-3 py-2.5 text-left font-medium">
              Salarié
            </th>
            {sectorView.columns.map((column) => (
              <th key={column.date} className="min-w-[7rem] px-1 py-2.5 text-center font-medium">
                <span className="block">{column.shortLabel}</span>
                <span className="block text-xs font-normal text-muted-foreground">
                  {column.dateLabel}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sectorView.rows.map((row) => (
            <tr
              key={row.employeeId}
              className={cn("border-b last:border-0", row.selected && "bg-primary/5")}
            >
              <td className="sticky left-0 z-10 bg-background px-3 py-1.5">
                <button
                  type="button"
                  onClick={() => onSelectEmployee(row.employeeId)}
                  className="flex w-full items-center gap-2 text-left"
                >
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground">
                    {row.initials}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{row.name}</span>
                    {/* The label says whether the target is the whole contract
                        or only this sector's allocation; the tick therefore
                        cannot turn a sector quota into a fake contract. */}
                    <span className="flex items-center gap-1.5 text-xs tabular-nums text-muted-foreground">
                      {row.hoursLabel}
                      {!row.comparisonAvailable ? null : row.onTarget ? (
                        <span
                          className="text-emerald-600 dark:text-emerald-400"
                          aria-label={
                            row.targetKind === "contract"
                              ? "contrat respecté"
                              : "objectif du rayon atteint"
                          }
                        >
                          {row.targetKind === "contract" ? "✓" : "objectif atteint"}
                        </span>
                      ) : (
                        <span className={cn("font-medium", LEVEL_TEXT[row.level])}>
                          {row.deviationLabel}
                        </span>
                      )}
                    </span>
                  </span>
                </button>
              </td>
              {sectorView.columns.map((column) => {
                const shifts = row.shiftsByDate[column.date] ?? []
                return (
                  <td key={column.date} className="px-1 py-1 align-top">
                    {column.closed ? (
                      <span className="block py-2 text-center text-xs text-muted-foreground/60">—</span>
                    ) : shifts.length === 0 ? (
                      <span className="block py-2 text-center text-xs italic text-muted-foreground/60">
                        Repos
                      </span>
                    ) : (
                      // UNE BARRE PAR RAYON, pas une par journée.
                      //
                      // La grille de la semaine est l'écran que l'on regarde en
                      // premier, et elle ne disait pas qui allait où : une seule
                      // barre par personne, colorée par le rôle, sans le nom du
                      // comptoir. Dans une zone marché où quelqu'un passe de la
                      // charcuterie au poisson dans la même journée, cela cachait
                      // précisément ce qu'on venait y chercher.
                      shifts.map((shift) =>
                        sectorBarsOf(shift).map((bar) => (
                          <button
                            key={`${shift.id}-${bar.key}`}
                            type="button"
                            onClick={() => onSelectEmployee(row.employeeId)}
                            style={bar.paint ?? undefined}
                            className={cn(
                              "mb-1 block w-full rounded-md border px-2 py-1.5 text-xs font-medium leading-tight transition hover:brightness-95",
                              bar.paint ? "border" : KIND_SURFACE[shift.kind]
                            )}
                            title={bar.title}
                          >
                            {bar.sectorName ? (
                              <span className="block truncate text-[11px] font-semibold uppercase tracking-wide opacity-80">
                                {bar.sectorName}
                              </span>
                            ) : null}
                            <span className="block tabular-nums">
                              {bar.startLabel} – {bar.endLabel}
                            </span>
                            <span className="block text-[11px] font-normal opacity-70 tabular-nums">
                              {bar.durationLabel}
                            </span>
                          </button>
                        ))
                      )
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t bg-muted/30">
            <th className="sticky left-0 z-10 bg-muted/30 px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Total du jour
            </th>
            {sectorView.columns.map((column) => (
              <td key={column.date} className="px-1 py-2 text-center text-sm font-medium tabular-nums">
                {column.totalLabel ?? (
                  <span className="text-xs font-normal text-muted-foreground/60">—</span>
                )}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
    </div>
  )
}
