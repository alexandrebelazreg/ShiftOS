import { cn } from "@/lib/utils"

import type { EmployeeId } from "@/features/core/models"
import type { BoardDayViewVM } from "@/features/planning/board/model/board-view-model"
import type { DayEditVerdictVM, ShiftDeltaVM } from "@/features/planning/board/model/shift-edit-diff"
import type { DragBounds, EditableShift } from "@/features/planning/board/model/shift-edit"
import { VERDICT_DOT, VERDICT_TEXT } from "@/features/planning/board/ui/edit-delta-styles"
import { PlanningTimeline } from "@/features/planning/board/ui/PlanningTimeline"

interface PlanningDayViewProps {
  readonly dayView: BoardDayViewVM
  readonly onSelectEmployee: (employeeId: EmployeeId) => void
  /** Editing wiring, supplied by the board only for an open day. */
  readonly editableById?: ReadonlyMap<string, EditableShift>
  readonly bounds?: DragBounds
  readonly selectedShiftId?: string | null
  readonly onSelectShift?: (shiftId: string, employeeId: EmployeeId) => void
  readonly onEditShift?: (shiftId: string, next: EditableShift) => void
  readonly deltasByEmployee?: ReadonlyMap<EmployeeId, ShiftDeltaVM>
  /** Local-edit controls and read-outs. Shown once a shift has been touched. */
  readonly verdict?: DayEditVerdictVM | null
  readonly canUndo?: boolean
  readonly hasEdits?: boolean
  readonly onUndo?: () => void
  readonly onReset?: () => void
  /** "20/07/2025 10:32" and "Luca Zanuso (+30 min, fin à 13:15)". */
  readonly modifiedAtLabel?: string | null
  readonly lastEditLabel?: string | null
}

/** One full day, hour by hour, with in-place shift editing. */
export function PlanningDayView({
  dayView,
  onSelectEmployee,
  editableById,
  bounds,
  selectedShiftId,
  onSelectShift,
  onEditShift,
  deltasByEmployee,
  verdict,
  canUndo = false,
  hasEdits = false,
  onUndo,
  onReset,
  modifiedAtLabel,
  lastEditLabel,
}: PlanningDayViewProps) {
  if (dayView.closed || dayView.hours.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
        {dayView.dateLabel ? `${dayView.dateLabel} — jour fermé.` : "Aucun jour sélectionné."}
      </div>
    )
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">{dayView.dateLabel}</h2>
        <div className="flex flex-wrap items-center gap-3">
          {hasEdits && verdict ? (
            <div className="rounded-lg border px-3 py-1.5" role="status">
              <div className="flex items-center gap-2">
                <span className={cn("size-2.5 shrink-0 rounded-full", VERDICT_DOT[verdict.tone])} aria-hidden />
                <span className="leading-tight">
                  <span className={cn("block text-sm font-semibold", VERDICT_TEXT[verdict.tone])}>
                    {verdict.label}
                  </span>
                  {verdict.detail ? (
                    <span className="block text-xs text-muted-foreground">{verdict.detail}</span>
                  ) : null}
                </span>
              </div>
              {verdict.deviations.length > 1 ? (
                <details className="mt-1.5">
                  <summary className="cursor-pointer text-xs text-muted-foreground underline underline-offset-2">
                    Voir les salariés concernés
                  </summary>
                  <ul className="mt-1 space-y-0.5">
                    {verdict.deviations.map((deviation) => (
                      <li key={deviation.name} className="text-xs">
                        {deviation.name} : {deviation.label} par rapport au contrat
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
          ) : null}
          <button
            type="button"
            onClick={onUndo}
            disabled={!canUndo}
            className="rounded-md border px-2.5 py-1 text-left text-xs leading-tight transition hover:bg-muted disabled:opacity-50"
          >
            <span className="block font-medium">Annuler la dernière modification</span>
            <span className="block text-muted-foreground">Revient à l’état précédent</span>
          </button>
          <button
            type="button"
            onClick={onReset}
            disabled={!hasEdits}
            className="rounded-md border px-2.5 py-1 text-left text-xs leading-tight transition hover:bg-muted disabled:opacity-50"
          >
            <span className="block font-medium">Réinitialiser les modifications</span>
            <span className="block text-muted-foreground">Supprime toutes les modifications</span>
          </button>
        </div>
      </div>

      <PlanningTimeline
        dayView={dayView}
        onSelectEmployee={onSelectEmployee}
        editableById={editableById}
        bounds={bounds}
        selectedShiftId={selectedShiftId}
        onSelectShift={onSelectShift}
        onEditShift={onEditShift}
        deltasByEmployee={hasEdits ? deltasByEmployee : undefined}
      />

      {hasEdits ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3 text-xs text-muted-foreground">
          <span>{modifiedAtLabel ? `Modifié le : ${modifiedAtLabel}` : null}</span>
          <span>{lastEditLabel ? `Dernière modification : ${lastEditLabel}` : null}</span>
          <button
            type="button"
            onClick={onUndo}
            disabled={!canUndo}
            className="flex items-center gap-1.5 rounded-md border px-2.5 py-1 transition hover:bg-muted disabled:opacity-50"
          >
            <span aria-hidden>↶</span>
            Annuler
            <kbd className="rounded border bg-muted px-1 font-mono text-[10px]">Ctrl+Z</kbd>
          </button>
        </div>
      ) : null}
    </div>
  )
}
