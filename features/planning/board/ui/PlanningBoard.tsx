"use client"

import { useEffect, useMemo, useState, type ReactNode } from "react"

import type { EmployeeId, IsoDate } from "@/features/core/models"
import type {
  PlanningBoardInput,
  PlanningBoardSelection,
} from "@/features/planning/board/model/board-input"
import { buildPlanningBoard } from "@/features/planning/board/model/board-view-model"
import {
  describeWeek,
  hasPlanningForWeek,
  needsWeekChangeConfirmation,
  primaryPlanningAction,
  resolveTargetWeek,
  resolveWeekChangeChoice,
  type WeekChangeRequest,
} from "@/features/planning/board/model/header-controls"
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
import { PlanningEmptyWeek } from "@/features/planning/board/ui/PlanningEmptyWeek"
import { PlanningEmployeeView } from "@/features/planning/board/ui/PlanningEmployeeView"
import { PlanningRegenerateDialog } from "@/features/planning/board/ui/PlanningRegenerateDialog"
import { PlanningSectorView } from "@/features/planning/board/ui/PlanningSectorView"
import { PlanningSummary } from "@/features/planning/board/ui/PlanningSummary"
import { PlanningToolbar } from "@/features/planning/board/ui/PlanningToolbar"
import { PlanningWeekChangeDialog } from "@/features/planning/board/ui/PlanningWeekChangeDialog"

interface PlanningBoardProps {
  readonly input: PlanningBoardInput
  /** The week the header shows and navigates from. Owned by whoever has the data. */
  readonly selectedWeek?: string
  /** Land on this Monday. The board asks first if there is unsaved work. */
  readonly onChangeWeek?: (monday: string) => void
  /** Persist the current planning; resolves true on success. For "save then change". */
  readonly onSaveRequest?: () => Promise<boolean>
  /** Run the active engine (V2) for the selected week — generate or regenerate. */
  readonly onGenerate?: () => void
  /** Whether a generation is currently running, to disable the trigger. */
  readonly generating?: boolean
  /** Unsaved editor state, ORed with the board's own local edits/locks. */
  readonly dirty?: boolean
  /** Enregistrer / Publier and the published-state actions. */
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
  selectedWeek,
  onChangeWeek,
  onSaveRequest,
  onGenerate,
  generating = false,
  dirty = false,
  actions,
  onPersistenceBlockChange,
}: PlanningBoardProps) {
  const [selection, setSelection] = useState<PlanningBoardSelection>(() => ({
    view: "sector",
    // All sectors visible by default: the multiselect starts inclusive, and the
    // manager narrows down rather than having to opt every sector back in.
    sectorIds: input.sectors.map((sector) => sector.id),
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
  // The week the navigation wants to land on while unsaved work is in the way,
  // and whether a save-then-change is currently running.
  const [pendingWeek, setPendingWeek] = useState<string | null>(null)
  const [weekChangeBusy, setWeekChangeBusy] = useState(false)

  // A new generation replaces the schedule wholesale, so local edits made
  // against the previous one must not survive it.
  useEffect(() => {
    setEditState(EMPTY_EDIT_STATE)
    setSelectedShiftId(null)
    setLastEditedShiftId(null)
    setModifiedAt(null)
    setRegenerateOpen(false)
    setRegenerateOptions(DEFAULT_REGENERATION_OPTIONS)
    setPendingWeek(null)
    // Show every sector of the freshly generated planning.
    setSelection((current) => ({ ...current, sectorIds: input.sectors.map((sector) => sector.id) }))
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

  // The week the header shows versus the week the loaded planning belongs to.
  // They diverge the moment the manager navigates away without generating, and
  // that divergence — not a global "any planning exists" — decides everything:
  // the primary action, whether the grid renders, whether save/publish appear.
  const currentWeek = selectedWeek ?? input.periodStart
  const generatedPlanningWeek = input.periodStart
  const hasPlanning = hasPlanningForWeek(currentWeek, generatedPlanningWeek)
  const weekLabel = describeWeek(currentWeek)
  // Unsaved only means anything while the loaded planning is on screen.
  const unsaved = hasPlanning && (dirty || hasLocalChanges(editState))

  const clearLocalEdits = () => {
    setEditState(EMPTY_EDIT_STATE)
    setSelectedShiftId(null)
    setLastEditedShiftId(null)
    setModifiedAt(null)
  }

  const requestWeekChange = (request: WeekChangeRequest) => {
    const target = resolveTargetWeek(currentWeek, request)
    if (target === currentWeek) return
    if (needsWeekChangeConfirmation(unsaved)) setPendingWeek(target)
    else onChangeWeek?.(target)
  }

  const toggleSector = (sectorId: string) =>
    setSelection((current) => {
      const next = new Set(current.sectorIds)
      if (next.has(sectorId)) next.delete(sectorId)
      else next.add(sectorId)
      return { ...current, sectorIds: [...next] }
    })

  const toggleAllSectors = (selectAll: boolean) =>
    update({ sectorIds: selectAll ? input.sectors.map((sector) => sector.id) : [] })

  const applyWeekChange = (outcome: ReturnType<typeof resolveWeekChangeChoice>, target: string) => {
    if (outcome.discardLocalEdits) clearLocalEdits()
    if (outcome.changeWeek) onChangeWeek?.(target)
  }

  const confirmDiscardAndChange = () => {
    const target = pendingWeek
    setPendingWeek(null)
    if (target === null) return
    applyWeekChange(resolveWeekChangeChoice("discard", true), target)
  }

  const confirmSaveAndChange = async () => {
    const target = pendingWeek
    if (target === null) return
    setWeekChangeBusy(true)
    const saved = onSaveRequest ? await onSaveRequest() : true
    setWeekChangeBusy(false)
    setPendingWeek(null)
    // Change (and discard) only if the save actually succeeded; otherwise stay
    // put and let the owner surface the error.
    applyWeekChange(resolveWeekChangeChoice("save", saved), target)
  }

  return (
    <div className="space-y-4">
      <PlanningToolbar
        toolbar={board.toolbar}
        weekLabel={weekLabel}
        onChangeView={(view) => update({ view })}
        onToggleSector={toggleSector}
        onToggleAllSectors={toggleAllSectors}
        onSelectDate={(date: IsoDate) => update({ date })}
        onPreviousWeek={() => requestWeekChange({ type: "previous" })}
        onNextWeek={() => requestWeekChange({ type: "next" })}
        hasPlanning={hasPlanning}
        unsavedLabel={unsaved ? "● Modifications non enregistrées" : null}
        primaryAction={
          primaryPlanningAction(hasPlanning) === "regenerate" ? (
            <button
              type="button"
              onClick={() => setRegenerateOpen(true)}
              disabled={generating}
              className="rounded-md border px-3 py-1.5 text-sm font-medium transition hover:bg-muted disabled:opacity-50"
            >
              Régénérer
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onGenerate?.()}
              disabled={generating}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition hover:brightness-110 disabled:opacity-50"
            >
              {generating ? "Génération…" : "Générer cette semaine"}
            </button>
          )
        }
        actions={actions}
      />

      {/* The loaded planning belongs to one week; showing it under any other
          would be a lie. A different week gets an honest empty state instead. */}
      {!hasPlanning ? (
        <PlanningEmptyWeek
          weekTitle={weekLabel.title}
          onGenerate={() => onGenerate?.()}
          disabled={generating}
        />
      ) : board.toolbar.view === "sector" ? (
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
      {hasPlanning ? <PlanningSummary summary={board.summary} /> : null}

      {/* Régénérer runs the active engine now; the V3 lock-respecting variant is
          previewed but clearly marked as future — never a dead-end. */}
      <PlanningRegenerateDialog
        open={regenerateOpen}
        summary={localWork}
        options={regenerateOptions}
        onChangeOptions={setRegenerateOptions}
        onCancel={() => setRegenerateOpen(false)}
        onRegenerateNow={() => {
          setRegenerateOpen(false)
          onGenerate?.()
        }}
        busy={generating}
      />

      <PlanningWeekChangeDialog
        open={pendingWeek !== null}
        busy={weekChangeBusy}
        onCancel={() => setPendingWeek(null)}
        onDiscardAndChange={confirmDiscardAndChange}
        onSaveAndChange={() => void confirmSaveAndChange()}
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
