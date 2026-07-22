/**
 * The arithmetic of dragging a shift, decided outside React.
 *
 * A drag is three numbers — where the pointer is, where it grabbed, what the
 * shift was — and one rule per mode. Keeping that here rather than inside a
 * `onPointerMove` handler is what makes it testable without a DOM: the
 * component's whole job becomes converting pixels into a minute and handing it
 * over.
 *
 * Every time is minutes since midnight, like the rest of the board.
 */

/** The grid the manager works on. Fifteen minutes is the store's unit. */
export const SNAP_MINUTES = 15

/** No shift may be shortened below this. Also the resize floor. */
export const MIN_SHIFT_MINUTES = 15

export type ShiftDragMode = "move" | "resize-start" | "resize-end"

export interface EditableSegment {
  readonly startMinutes: number
  readonly endMinutes: number
}

/** The part of a shift a drag actually changes. */
export interface EditableShift {
  readonly startMinutes: number
  readonly endMinutes: number
  readonly segments: readonly EditableSegment[]
}

export interface DragBounds {
  /** The day's opening minute — nothing may start before it. */
  readonly openMinutes: number
  /** The day's closing minute — nothing may end after it. */
  readonly closeMinutes: number
  readonly stepMinutes?: number
  readonly minDurationMinutes?: number
}

/** Round to the nearest step. Halves round up, so the grid feels predictable. */
export function snapMinutes(minutes: number, step: number = SNAP_MINUTES): number {
  if (step <= 0) return Math.round(minutes)
  return Math.round(minutes / step) * step
}

function clamp(value: number, min: number, max: number): number {
  // A degenerate window (min > max) means there is no room at all: the lower
  // bound wins, because the day's opening is never negotiable.
  if (max < min) return min
  return Math.min(Math.max(value, min), max)
}

/** Where in the day a pointer sits, given its position across the lane. */
export function minutesFromRatio(ratio: number, bounds: DragBounds): number {
  const span = bounds.closeMinutes - bounds.openMinutes
  return bounds.openMinutes + clamp(ratio, 0, 1) * span
}

/** The inverse, for placing a preview back on the lane. */
export function ratioFromMinutes(minutes: number, bounds: DragBounds): number {
  const span = bounds.closeMinutes - bounds.openMinutes
  if (span <= 0) return 0
  return clamp((minutes - bounds.openMinutes) / span, 0, 1)
}

export function durationOf(shift: EditableShift): number {
  return shift.segments.reduce((sum, segment) => sum + (segment.endMinutes - segment.startMinutes), 0)
}

/**
 * Where each segment sits on the lane, as percentages of the open window.
 *
 * The same geometry the ViewModel produces for a static bar, but computed from
 * raw minutes so a bar being dragged can be redrawn on every pointer move
 * without going back through `buildPlanningBoard`. `open..close` maps to
 * `0..100 %`, exactly like `toShiftVM`, so a preview lands where the committed
 * bar will.
 */
export function segmentGeometry(
  shift: EditableShift,
  bounds: DragBounds
): readonly { readonly leftPercent: number; readonly widthPercent: number }[] {
  const span = bounds.closeMinutes - bounds.openMinutes
  return shift.segments.map((segment) =>
    span <= 0
      ? { leftPercent: 0, widthPercent: 0 }
      : {
          leftPercent: ((segment.startMinutes - bounds.openMinutes) / span) * 100,
          widthPercent: ((segment.endMinutes - segment.startMinutes) / span) * 100,
        }
  )
}

function translate(shift: EditableShift, delta: number): EditableShift {
  return {
    startMinutes: shift.startMinutes + delta,
    endMinutes: shift.endMinutes + delta,
    segments: shift.segments.map((segment) => ({
      startMinutes: segment.startMinutes + delta,
      endMinutes: segment.endMinutes + delta,
    })),
  }
}

/**
 * Move the whole shift, keeping its duration.
 *
 * The delta is snapped, then clamped so the span stays inside the day. Clamping
 * the delta rather than each end is what preserves the duration: a shift pushed
 * against the closing hour stops there instead of being squashed against it.
 * The clamp is applied after the snap, so a shift that was not on the grid can
 * still reach the exact opening or closing minute.
 */
function moveShift(origin: EditableShift, pointer: number, grab: number, bounds: DragBounds): EditableShift {
  const step = bounds.stepMinutes ?? SNAP_MINUTES
  const snapped = snapMinutes(pointer - grab, step)
  const delta = clamp(
    snapped,
    bounds.openMinutes - origin.startMinutes,
    bounds.closeMinutes - origin.endMinutes
  )
  return delta === 0 ? origin : translate(origin, delta)
}

/**
 * Move the start only. The end never moves, so the duration changes — that is
 * the difference between resizing and moving, and the reason they are two
 * separate handles rather than one clever one.
 */
function resizeStart(origin: EditableShift, pointer: number, bounds: DragBounds): EditableShift {
  const step = bounds.stepMinutes ?? SNAP_MINUTES
  const floor = bounds.minDurationMinutes ?? MIN_SHIFT_MINUTES
  const first = origin.segments[0]
  if (!first) return origin
  // A split shift resizes against its OWN first block, not against the far end
  // of the shift: dragging the left handle must never swallow the break.
  const start = clamp(snapMinutes(pointer, step), bounds.openMinutes, first.endMinutes - floor)
  const segments = origin.segments.map((segment, index) =>
    index === 0 ? { startMinutes: start, endMinutes: segment.endMinutes } : segment
  )
  return { startMinutes: start, endMinutes: origin.endMinutes, segments }
}

/** Move the end only. Mirror of `resizeStart`, against the last block. */
function resizeEnd(origin: EditableShift, pointer: number, bounds: DragBounds): EditableShift {
  const step = bounds.stepMinutes ?? SNAP_MINUTES
  const floor = bounds.minDurationMinutes ?? MIN_SHIFT_MINUTES
  const lastIndex = origin.segments.length - 1
  const last = origin.segments[lastIndex]
  if (!last) return origin
  const end = clamp(snapMinutes(pointer, step), last.startMinutes + floor, bounds.closeMinutes)
  const segments = origin.segments.map((segment, index) =>
    index === lastIndex ? { startMinutes: segment.startMinutes, endMinutes: end } : segment
  )
  return { startMinutes: origin.startMinutes, endMinutes: end, segments }
}

/**
 * Apply a drag in progress and return what the shift would become.
 *
 * Pure and total: it always returns a shift inside the day, on the grid, and
 * never shorter than the floor. The caller can therefore render the result
 * directly on every pointer move without guarding anything, and dropping is
 * just "keep the last result".
 *
 * `grabMinutes` is where inside the day the pointer went down. Only `move`
 * reads it — that is what stops the bar from jumping so its start snaps under
 * the cursor when someone grabs it by the middle.
 */
export function applyShiftDrag(
  origin: EditableShift,
  mode: ShiftDragMode,
  pointerMinutes: number,
  grabMinutes: number,
  bounds: DragBounds
): EditableShift {
  switch (mode) {
    case "move":
      return moveShift(origin, pointerMinutes, grabMinutes, bounds)
    case "resize-start":
      return resizeStart(origin, pointerMinutes, bounds)
    case "resize-end":
      return resizeEnd(origin, pointerMinutes, bounds)
  }
}
