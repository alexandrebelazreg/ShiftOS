import { cn } from "@/lib/utils"

import type { EmployeeId } from "@/features/core/models"
import type { BoardSectorViewVM } from "@/features/planning/board/model/board-view-model"
import { KIND_DOT, KIND_LEGEND, KIND_SURFACE, LEVEL_TEXT } from "@/features/planning/board/ui/level-styles"

interface PlanningSectorViewProps {
  readonly sectorView: BoardSectorViewVM
  readonly onSelectEmployee: (employeeId: EmployeeId) => void
}

/**
 * The week grid: one row per employee, one column per day, each shift a card.
 * Planned versus contracted hours sit next to the name so the gap is readable
 * without opening the panel.
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
            <th className="w-36 bg-muted/30 px-3 py-2.5 text-left font-medium">Heures</th>
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
                  <span className="truncate text-sm font-medium">{row.name}</span>
                </button>
              </td>
              {/* On target shows a tick rather than "0h": a zero gap is not a
                  number a manager needs to read, only a state to confirm. */}
              <td className="px-3 py-1.5">
                <span className="flex items-center gap-1.5 text-sm tabular-nums">
                  {row.hoursLabel}
                  {row.onTarget ? (
                    <span className="text-emerald-600 dark:text-emerald-400" aria-label="conforme">
                      ✓
                    </span>
                  ) : (
                    <span className={cn("font-medium", LEVEL_TEXT[row.level])}>
                      {row.deviationLabel}
                    </span>
                  )}
                </span>
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
                      shifts.map((shift) => (
                        <button
                          key={shift.id}
                          type="button"
                          onClick={() => onSelectEmployee(row.employeeId)}
                          className={cn(
                            "mb-1 block w-full rounded-md border px-2 py-1.5 text-xs font-medium leading-tight transition hover:brightness-95",
                            KIND_SURFACE[shift.kind]
                          )}
                          title={shift.kindLabel}
                        >
                          <span className="block tabular-nums">
                            {shift.startLabel} – {shift.endLabel}
                          </span>
                          <span className="block text-[11px] font-normal opacity-70 tabular-nums">
                            {shift.durationLabel}
                          </span>
                        </button>
                      ))
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </div>
  )
}
