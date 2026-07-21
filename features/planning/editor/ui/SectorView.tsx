import { cn } from "@/lib/utils"

import type { EmployeeId, IsoDate, ShiftId } from "@/features/core/models"
import { WEEK_DAY_LABELS } from "@/features/store/lib/constants"
import type { SectorGrid } from "@/features/planning/editor"
import { LevelBadge, LevelDot } from "@/features/planning/editor/ui/level-badge"

interface SectorViewProps {
  readonly grid: SectorGrid
  readonly selectedDate: IsoDate | null
  readonly onSelectDate: (date: IsoDate) => void
  readonly selectedAssignmentId: string | null
  readonly onCellClick: (assignmentId: string) => void
  readonly onEmptyClick: (employeeId: EmployeeId, date: IsoDate) => void
  readonly onDeleteShift: (shiftId: ShiftId) => void
  readonly readOnly?: boolean
}

/**
 * Vue secteur (par défaut) — un seul jour à la fois pour garder une lecture
 * confortable. Chaque ligne représente un employé et l'indicateur de
 * couverture reste visible au-dessus de la journée.
 */
export function SectorView({
  grid,
  selectedDate,
  onSelectDate,
  selectedAssignmentId,
  onCellClick,
  onEmptyClick,
  onDeleteShift,
  readOnly = false,
}: SectorViewProps) {
  const selectedDay = grid.days.find((day) => day.date === selectedDate) ?? grid.days[0]
  const dayIndex = selectedDay ? grid.days.indexOf(selectedDay) : -1
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          className="text-sm underline disabled:opacity-50"
          disabled={dayIndex <= 0}
          onClick={() => onSelectDate(grid.days[dayIndex - 1].date)}
        >
          Jour précédent
        </button>
        <div className="text-center">
          <p className="font-medium">{selectedDay ? WEEK_DAY_LABELS[selectedDay.weekDay] : "Jour"}</p>
          <p className="text-xs text-muted-foreground">{selectedDay?.date}</p>
        </div>
        <button
          type="button"
          className="text-sm underline disabled:opacity-50"
          disabled={dayIndex < 0 || dayIndex >= grid.days.length - 1}
          onClick={() => onSelectDate(grid.days[dayIndex + 1].date)}
        >
          Jour suivant
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b bg-muted/40">
            <th className="sticky left-0 z-10 bg-muted/40 p-3 text-left font-medium">Employé</th>
            {selectedDay ? (
              <th key={selectedDay.date} className="min-w-[8rem] p-2 text-center font-medium">
                <div className="flex flex-col items-center gap-1">
                  <span>{WEEK_DAY_LABELS[selectedDay.weekDay]}</span>
                  <span className="text-xs text-muted-foreground">{selectedDay.date.slice(5)}</span>
                  <LevelBadge level={selectedDay.level}>
                    <LevelDot level={selectedDay.level} /> {Math.round(selectedDay.coverageRate * 100)}%
                  </LevelBadge>
                </div>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {grid.rows.map((row) => (
            <tr key={row.employeeId} className="border-b last:border-0">
              <td className="sticky left-0 z-10 bg-background p-3">
                <div className="flex items-center gap-2">
                  <LevelDot level={row.level} />
                  <div>
                    <p className="font-medium">{row.name}</p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {hoursMinutes(row.plannedHours)} / {hoursMinutes(row.contractHours)}
                    </p>
                  </div>
                </div>
              </td>
              {selectedDay ? (() => { const day = selectedDay
                const cells = (row.cellsByDate[day.date] ?? []).slice(0, 2)
                return (
                  <td key={day.date} className="p-1 align-top">
                    {cells.length === 0 ? (
                      <button
                        type="button"
                        disabled={readOnly}
                        onClick={() => onEmptyClick(row.employeeId, day.date)}
                        className="h-full min-h-[3rem] w-full rounded border border-dashed border-transparent text-muted-foreground/40 transition hover:border-border hover:text-muted-foreground"
                        aria-label={`Ajouter un service pour ${row.name} le ${day.date}`}
                      >
                        +
                      </button>
                    ) : (
                      cells.map((cell) => {
                        const selected = cell.assignmentId === selectedAssignmentId
                        return (
                          <div
                            key={cell.assignmentId}
                            className={cn(
                              "group relative mb-1 rounded border px-2 py-1 text-xs transition cursor-pointer",
                              selected
                                ? "border-primary bg-primary/10 ring-1 ring-primary"
                                : "border-border bg-muted/40 hover:bg-muted"
                            )}
                            onClick={() => onCellClick(cell.assignmentId)}
                            role={readOnly ? undefined : "button"}
                            tabIndex={readOnly ? -1 : 0}
                          >
                            <span className="font-medium tabular-nums">
                              {cell.start}–{cell.end}
                            </span>
                            {cell.isSplit ? (
                              <span className="ml-1 text-muted-foreground">(coupure)</span>
                            ) : null}
                            <button
                              type="button"
                              disabled={readOnly}
                              onClick={(event) => {
                                event.stopPropagation()
                                onDeleteShift(cell.shiftId as ShiftId)
                              }}
                              className="absolute right-1 top-1 hidden text-muted-foreground hover:text-destructive group-hover:block"
                              aria-label="Supprimer le service"
                            >
                              ×
                            </button>
                          </div>
                        )
                      })
                    )}
                  </td>
                )
              })() : null}
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  )
}

function hoursMinutes(value: number) { const minutes = Math.round(value * 60), hours = Math.floor(minutes / 60), remainder = minutes % 60; return `${hours} h${remainder ? ` ${String(remainder).padStart(2, "0")}` : ""}` }
