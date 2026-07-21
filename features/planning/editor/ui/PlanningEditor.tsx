"use client"

import { useMemo, useState } from "react"

import type { EmployeeId, IsoDate, ShiftId, ShiftSegment } from "@/features/core/models"
import { weekDayOf } from "@/features/core/shared"
import { Button } from "@/components/ui/button"

import type { EditorInit, EditorState } from "@/features/planning/editor"
import {
  buildEmployeeSummary,
  buildSectorGrid,
  createEditorState,
  createShift,
  deleteShift,
  editShiftTime,
  evaluateEditor,
  listEmployees,
  moveShift,
  swapEmployees,
} from "@/features/planning/editor"
import { LiveIndicatorsBar } from "@/features/planning/editor/ui/LiveIndicatorsBar"
import { SectorView } from "@/features/planning/editor/ui/SectorView"
import { EmployeeView } from "@/features/planning/editor/ui/EmployeeView"

type EditorMode = "sector" | "employee"

interface PlanningEditorProps {
  readonly init?: EditorInit
  /** A fully restored persisted editor state takes precedence over generated input. */
  readonly initialState?: EditorState
  readonly readOnly?: boolean
  /** A blocked generator result is provisional and must never render green. */
  readonly diagnostic?: boolean
  /** Lets the application persistence boundary track unsaved editor changes. */
  readonly onStateChange?: (state: EditorState) => void
}

/**
 * PlanningEditor — the manager's workspace. It holds the ONE planning in state;
 * every edit produces a new state, and the live evaluation (constraints,
 * coverage, statistics, fairness, score) is recomputed in a `useMemo` — so all
 * views and indicators update instantly, with no reload and no regeneration.
 */
export function PlanningEditor({
  init,
  initialState,
  readOnly = false,
  diagnostic = false,
  onStateChange,
}: PlanningEditorProps) {
  const [state, setState] = useState<EditorState>(() => {
    if (initialState) return initialState
    if (init) return createEditorState(init)
    throw new Error("PlanningEditor requires an initial editor state.")
  })
  const [mode, setMode] = useState<EditorMode>("sector")
  const [selectedAssignmentId, setSelectedAssignmentId] = useState<string | null>(null)
  const employees = useMemo(() => listEmployees(state), [state])
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<EmployeeId | null>(
    () => (initialState ?? (init ? createEditorState(init) : null))?.coreInput.employees[0]?.id ?? null
  )

  // Single source of truth — recomputed on every state change (live).
  const liveEvaluation = useMemo(() => evaluateEditor(state), [state])
  const evaluation = useMemo(() => diagnostic ? { ...liveEvaluation, level: "red" as const, canPublish: false } : liveEvaluation, [diagnostic, liveEvaluation])
  const liveGrid = useMemo(() => buildSectorGrid(state, evaluation), [state, evaluation])
  const grid = useMemo(() => diagnostic ? { ...liveGrid, days: liveGrid.days.map((day) => ({ ...day, level: "red" as const })), rows: liveGrid.rows.map((row) => ({ ...row, level: "red" as const })) } : liveGrid, [diagnostic, liveGrid])
  const [selectedDate, setSelectedDate] = useState<IsoDate | null>(null)
  const activeDate = selectedDate ?? grid.days[0]?.date ?? null
  const summary = useMemo(
    () => { const value = selectedEmployeeId ? buildEmployeeSummary(state, evaluation, selectedEmployeeId) : null; return diagnostic && value ? { ...value, level: "red" as const, warnings: [...value.warnings, "Proposition de diagnostic : contrat ou règle bloquante non résolu."] } : value },
    [state, evaluation, selectedEmployeeId, diagnostic]
  )

  function apply(next: EditorState) {
    if (readOnly) return
    setState(next)
    onStateChange?.(next)
    setSelectedAssignmentId(null)
  }

  function handleCellClick(assignmentId: string) {
    if (readOnly) return
    if (selectedAssignmentId === null) {
      setSelectedAssignmentId(assignmentId)
    } else if (selectedAssignmentId === assignmentId) {
      setSelectedAssignmentId(null)
    } else {
      apply(swapEmployees(state, selectedAssignmentId, assignmentId)) // swap = 2 clicks
    }
  }

  function handleEmptyClick(employeeId: EmployeeId, date: IsoDate) {
    if (readOnly) return
    if (selectedAssignmentId !== null) {
      const selected = state.assignments.find((a) => a.id === selectedAssignmentId)
      if (selected && selected.employeeId === employeeId) {
        apply(moveShift(state, selected.shiftId, date)) // move within the same row
        return
      }
    }
    const segments = defaultSegments(state, date)
    if (segments.length === 0) return
    apply(createShift(state, { date, employeeId, segments }))
  }

  function handleEditShiftTime(shiftId: ShiftId, segment: Partial<ShiftSegment>) {
    apply(editShiftTime(state, shiftId, 0, segment))
  }

  function handleDeleteShift(shiftId: ShiftId) {
    apply(deleteShift(state, shiftId))
  }

  return (
    <div className="space-y-6">
      <LiveIndicatorsBar evaluation={evaluation} />

      <div className="flex items-center gap-2">
        <Button variant={mode === "sector" ? "default" : "outline"} size="sm" onClick={() => setMode("sector")}>
          Vue par secteur
        </Button>
        <Button
          variant={mode === "employee" ? "default" : "outline"}
          size="sm"
          onClick={() => setMode("employee")}
        >
          Vue par employé
        </Button>
        {selectedAssignmentId ? (
          <span className="ml-2 text-xs text-muted-foreground">
            Service sélectionné — cliquez sur un autre pour échanger, ou sur une case vide de la même ligne pour le déplacer.
          </span>
        ) : null}
      </div>

      {mode === "sector" ? (
        <SectorView
          grid={grid}
          selectedDate={activeDate}
          onSelectDate={setSelectedDate}
          selectedAssignmentId={selectedAssignmentId}
          readOnly={readOnly}
          onCellClick={handleCellClick}
          onEmptyClick={handleEmptyClick}
          onDeleteShift={handleDeleteShift}
        />
      ) : (
        <EmployeeView
          employees={employees}
          selectedEmployeeId={selectedEmployeeId ?? employees[0]?.id ?? null}
          readOnly={readOnly}
          onSelectEmployee={setSelectedEmployeeId}
          summary={summary}
          onEditShiftTime={handleEditShiftTime}
          onDeleteShift={handleDeleteShift}
        />
      )}
    </div>
  )
}

/** Default segment for a created shift: the store's opening window that day. */
function defaultSegments(state: EditorState, date: IsoDate): ShiftSegment[] {
  const weekDay = weekDayOf(date)
  const day = state.configuration.openingHours.find((d) => d.day === weekDay)
  const range = day && !day.closed ? day.ranges[0] : undefined
  return range ? [{ startTime: range.start, endTime: range.end }] : []
}
