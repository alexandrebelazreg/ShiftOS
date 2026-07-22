"use client"

import { useEffect, useMemo, useState, type ReactNode } from "react"

import type { EmployeeId, IsoDate } from "@/features/core/models"
import type {
  PlanningBoardInput,
  PlanningBoardSelection,
} from "@/features/planning/board/model/board-input"
import type { WeekOption } from "@/features/planning/board/model/week"
import { buildPlanningBoard } from "@/features/planning/board/model/board-view-model"
import type { DragBounds, EditableShift } from "@/features/planning/board/model/shift-edit"
import {
  applyShiftEdit,
  applyShiftEdits,
  canUndo,
  EMPTY_EDIT_STATE,
  hasEdits,
  hasLocalChanges,
  isShiftLocked,
  resetShiftEdits,
  toggleShiftLock,
  undoShiftEdit,
  type ShiftEditState,
} from "@/features/planning/board/model/shift-edit-state"
import {
  assessDayEdits,
  dayEmployeeDeltas,
  describeLastEdit,
  editsBlockPersistence,
} from "@/features/planning/board/model/shift-edit-diff"
import {
  DEFAULT_REGENERATION_OPTIONS,
  summarizeLocalWork,
  type RegenerationOptions,
} from "@/features/planning/board/model/regeneration-request"
import { PlanningDayView } from "@/features/planning/board/ui/PlanningDayView"
import { PlanningEmployeeView } from "@/features/planning/board/ui/PlanningEmployeeView"
import { PlanningRegenerateDialog } from "@/features/planning/board/ui/PlanningRegenerateDialog"
import { PlanningSectorView } from "@/features/planning/board/ui/PlanningSectorView"
import { PlanningSummary } from "@/features/planning/board/ui/PlanningSummary"
import { PlanningToolbar } from "@/features/planning/board/ui/PlanningToolbar"

interface PlanningBoardProps {
  readonly input: PlanningBoardInput
  /** Week navigation belongs to whoever owns the data, not to the board. */
  readonly onPreviousWeek?: () => void
  readonly onNextWeek?: () => void
  readonly weekOptions?: readonly WeekOption[]
  readonly selectedWeek?: string
  readonly onSelectWeek?: (monday: string) => void
  /** Générer / Enregistrer / Publier, rendered inside the control bar. */
  readonly actions?: ReactNode
  /**
   * Raised when the local edits reach — or leave — a state that must not be
   * saved or published (impossible schedule, or a broken contract). The owner
   * of the persist buttons disables them accordingly; the board never touches
   * them itself.
   */
  readonly onPersistenceBlockChange?: (blocked: boolean) => void
}

/**
 * The board container.
 *
 * It holds two kinds of state — what the user is looking at, and the manager's
 * local edits — and hands the edited input to `buildPlanningBoard`. The edits
 * are overrides layered on top of the generated schedule, never a mutation of
 * it: `applyShiftEdits` rebuilds the input, so the generated planning is always
 * exactly recoverable by clearing them, which is what "Réinitialiser" does.
 *
 * Every calculation stays in the pure modules — snapping and clamping in
 * `shift-edit`, the override stack in `shift-edit-state`, the badges and verdict
 * in `shift-edit-diff`. This component only routes their results.
 */
export function PlanningBoard({
  input,
  onPreviousWeek,
  onNextWeek,
  weekOptions,
  selectedWeek,
  onSelectWeek,
  actions,
  onPersistenceBlockChange,
}: PlanningBoardProps) {
  const [selection, setSelection] = useState<PlanningBoardSelection>(() => ({
    view: "sector",
    sectorId: input.sectors[0]?.id ?? null,
    date: input.days.find((day) => !day.closed)?.date ?? null,
    employeeId: null,
  }))
  const [editState, setEditState] = useState<ShiftEditState>(EMPTY_EDIT_STATE)
  const [selectedShiftId, setSelectedShiftId] = useState<string | null>(null)
  // Just enough to describe "the last edit" in the footer, without persisting
  // anything: which shift moved last, and when.
  const [lastEditedShiftId, setLastEditedShiftId] = useState<string | null>(null)
  const [modifiedAt, setModifiedAt] = useState<Date | null>(null)
  // The regeneration intent dialog: its open flag and the three toggles. This
  // sprint the intent is collected and shown, never sent to any solver.
  const [regenerateOpen, setRegenerateOpen] = useState(false)
  const [regenerateOptions, setRegenerateOptions] = useState<RegenerationOptions>(
    DEFAULT_REGENERATION_OPTIONS
  )

  // A new generation replaces the schedule wholesale, so local edits made
  // against the previous one must not survive it.
  useEffect(() => {
    setEditState(EMPTY_EDIT_STATE)
    setSelectedShiftId(null)
    setLastEditedShiftId(null)
    setModifiedAt(null)
    setRegenerateOpen(false)
    setRegenerateOptions(DEFAULT_REGENERATION_OPTIONS)
  }, [input])

  const editedInput = useMemo(() => applyShiftEdits(input, editState), [input, editState])
  const board = useMemo(() => buildPlanningBoard(editedInput, selection), [editedInput, selection])

  // Raw minutes per shift, so a bar can be dragged without going back through
  // the ViewModel. Rebuilt with the edits, so it always matches the grid.
  const editableById = useMemo(() => {
    const map = new Map<string, EditableShift>()
    for (const shift of editedInput.shifts) {
      map.set(shift.id, {
        startMinutes: shift.startMinutes,
        endMinutes: shift.endMinutes,
        segments: shift.segments.map((segment) => ({ ...segment })),
      })
    }
    return map
  }, [editedInput])

  // The day window the drag is clamped to: the selected open day, or nothing.
  const bounds = useMemo<DragBounds | undefined>(() => {
    const day = editedInput.days.find((item) => item.date === board.dayView.date)
    if (!day || day.closed || day.opensAtMinutes === null || day.closesAtMinutes === null) {
      return undefined
    }
    return { openMinutes: day.opensAtMinutes, closeMinutes: day.closesAtMinutes }
  }, [editedInput, board.dayView.date])

  // The three edit read-outs, all measured against the generated `input`:
  // per-employee badges, the day's coverage verdict, and the footer's last-edit
  // line. Each is pure and recomputed from the two inputs, never stored.
  const edited = hasEdits(editState)
  const deltasByEmployee = useMemo(
    () => dayEmployeeDeltas(input, editedInput, board.dayView.date),
    [input, editedInput, board.dayView.date]
  )
  const verdict = useMemo(
    () => (edited ? assessDayEdits(input, editedInput, board.dayView.date) : null),
    [edited, input, editedInput, board.dayView.date]
  )
  const lastEditLabel = useMemo(
    () => describeLastEdit(input, editedInput, lastEditedShiftId),
    [input, editedInput, lastEditedShiftId]
  )

  // Tell the owner of the persist buttons whether these edits may be saved or
  // published, so a contract-breaking or impossible edit cannot be committed.
  const blocksPersistence = verdict !== null && editsBlockPersistence(verdict)
  useEffect(() => {
    onPersistenceBlockChange?.(blocksPersistence)
  }, [blocksPersistence, onPersistenceBlockChange])

  const undo = () => setEditState((current) => undoShiftEdit(current))

  // Ctrl/Cmd+Z steps back one edit, the same as the header button.
  useEffect(() => {
    if (!edited) return
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault()
        undo()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [edited])

  const update = (patch: Partial<PlanningBoardSelection>) =>
    setSelection((current) => ({ ...current, ...patch }))

  // The counts the regeneration dialog shows. Cheap, read straight off the state.
  const localWork = summarizeLocalWork(editState)

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setRegenerateOpen(true)}
          className="rounded-md border px-3 py-1.5 text-sm font-medium transition hover:bg-muted"
        >
          Régénérer
        </button>
      </div>

      <PlanningToolbar
        toolbar={board.toolbar}
        onChangeView={(view) => update({ view })}
        onSelectSector={(sectorId) => update({ sectorId })}
        onSelectDate={(date: IsoDate) => update({ date })}
        onPreviousWeek={() => onPreviousWeek?.()}
        onNextWeek={() => onNextWeek?.()}
        weekOptions={weekOptions}
        selectedWeek={selectedWeek}
        onSelectWeek={onSelectWeek}
        actions={actions}
      />

      {/* No fixed side panel: the grid gets the full width, and per-employee
          detail lives in its own view where it has room to breathe. Selecting
          someone here switches to it rather than shrinking the schedule. */}
      {board.toolbar.view === "sector" ? (
        <PlanningSectorView
          sectorView={board.sectorView}
          onSelectEmployee={(employeeId: EmployeeId) =>
            update({ employeeId, view: "employee" })
          }
        />
      ) : board.toolbar.view === "day" ? (
        <PlanningDayView
          dayView={board.dayView}
          onSelectEmployee={(employeeId: EmployeeId) =>
            update({ employeeId, view: "employee" })
          }
          editableById={bounds ? editableById : undefined}
          bounds={bounds}
          selectedShiftId={selectedShiftId}
          onSelectShift={(shiftId) => setSelectedShiftId(shiftId)}
          onEditShift={(shiftId, next) => {
            setEditState((current) => applyShiftEdit(current, shiftId, next))
            setLastEditedShiftId(shiftId)
            setModifiedAt(new Date())
          }}
          deltasByEmployee={deltasByEmployee}
          lockedShiftIds={editState.lockedShiftIds}
          selectedShiftLocked={selectedShiftId ? isShiftLocked(editState, selectedShiftId) : false}
          onToggleLock={(shiftId) =>
            setEditState((current) => toggleShiftLock(current, shiftId))
          }
          verdict={verdict}
          canUndo={canUndo(editState)}
          hasEdits={edited}
          canReset={hasLocalChanges(editState)}
          onUndo={undo}
          onReset={() => {
            setEditState(resetShiftEdits())
            setSelectedShiftId(null)
            setLastEditedShiftId(null)
            setModifiedAt(null)
          }}
          modifiedAtLabel={formatModifiedAt(modifiedAt)}
          lastEditLabel={lastEditLabel}
        />
      ) : (
        <PlanningEmployeeView
          employeeView={board.employeeView}
          onSelectEmployee={(employeeId: EmployeeId) => update({ employeeId })}
        />
      )}

      {/* The verdict reads AFTER the schedule: a manager looks at the week
          first, then at what to check before publishing it. */}
      <PlanningSummary summary={board.summary} />

      {/* Regeneration is intent-only this sprint: the dialog collects the
          preferences and states plainly that honouring them needs V3. */}
      <PlanningRegenerateDialog
        open={regenerateOpen}
        summary={localWork}
        options={regenerateOptions}
        onChangeOptions={setRegenerateOptions}
        onCancel={() => setRegenerateOpen(false)}
      />
    </div>
  )
}

/** "20/07/2025 10:32" — the footer's edit timestamp. */
function formatModifiedAt(date: Date | null): string | null {
  if (!date) return null
  const pad = (value: number) => String(value).padStart(2, "0")
  return (
    `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}
