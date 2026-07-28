import type { PlanningDemandSlotV3 } from "@/features/core/planning-v3/types/problem"

/**
 * Atomic coverage on a fixed grid whose cell is the problem's time step.
 *
 * The grid is EXACT, not an approximation, and the reason is narrow: Phase 1
 * refuses any problem whose slot boundaries are off-step, and every candidate
 * this engine generates starts and ends on a step multiple. With both facts in
 * hand, nobody's presence can change strictly inside a cell — which is the
 * definition of an atomic piece. Counting per cell and counting per true atomic
 * interval therefore give the same numbers, and the shared `atomicCoverage`
 * helper agrees with this module on every problem either will ever see.
 *
 * What the grid buys is speed. The weekly search evaluates a day's coverage
 * tens of thousands of times; rebuilding sorted breakpoint sets that often
 * dominates the whole run, while incrementing a small integer array does not.
 * A Drive day spans 06:00–20:00, which is fifty-six cells.
 *
 * Presence is measured as the MINIMUM over a slot's cells, never an average and
 * never a per-shift containment test: a window staffed throughout except for
 * one cell is a window with a hole in it.
 */

export interface DayGrid {
  readonly startMinutes: number
  readonly step: number
  readonly cellCount: number
  /** Per slot: its cell range and its two thresholds. */
  readonly slots: readonly GridSlot[]
}

export interface GridSlot {
  readonly id: string
  readonly firstCell: number
  readonly lastCell: number
  readonly required: number
  /** Undefined when the problem declares no floor for this slot. */
  readonly hardMinimum: number | undefined
}

export function buildDayGrid(
  slots: readonly PlanningDemandSlotV3[],
  opensAtMinutes: number,
  closesAtMinutes: number,
  step: number
): DayGrid {
  let start = opensAtMinutes
  let end = closesAtMinutes
  for (const slot of slots) {
    start = Math.min(start, slot.startMinutes)
    end = Math.max(end, slot.endMinutes)
  }
  const cellCount = Math.max(0, Math.ceil((end - start) / step))

  return {
    startMinutes: start,
    step,
    cellCount,
    slots: slots.map((slot) => ({
      id: slot.id,
      firstCell: (slot.startMinutes - start) / step,
      lastCell: (slot.endMinutes - start) / step - 1,
      required: slot.requiredEmployees,
      hardMinimum: slot.hardMinimumEmployees,
    })),
  }
}

/** Add one employee's worked segments to a presence counter. */
export function addPresence(
  counts: Int32Array,
  grid: DayGrid,
  segments: readonly { readonly startMinutes: number; readonly endMinutes: number }[]
): void {
  for (const segment of segments) {
    const first = (segment.startMinutes - grid.startMinutes) / grid.step
    const last = (segment.endMinutes - grid.startMinutes) / grid.step - 1
    for (let cell = Math.max(0, first); cell <= Math.min(grid.cellCount - 1, last); cell++) {
      counts[cell]++
    }
  }
}

/** Remove one employee's worked segments again, for backtracking. */
export function removePresence(
  counts: Int32Array,
  grid: DayGrid,
  segments: readonly { readonly startMinutes: number; readonly endMinutes: number }[]
): void {
  for (const segment of segments) {
    const first = (segment.startMinutes - grid.startMinutes) / grid.step
    const last = (segment.endMinutes - grid.startMinutes) / grid.step - 1
    for (let cell = Math.max(0, first); cell <= Math.min(grid.cellCount - 1, last); cell++) {
      counts[cell]--
    }
  }
}

export interface DayCoverage {
  readonly underCoveredSlots: number
  readonly deficitMinutes: number
  /** True when at least one declared floor is broken. Never a degradation. */
  readonly breaksHardFloor: boolean
}

export function measureCoverage(counts: Int32Array, grid: DayGrid): DayCoverage {
  let underCoveredSlots = 0
  let deficitMinutes = 0
  let breaksHardFloor = false

  for (const slot of grid.slots) {
    let minimum = Number.POSITIVE_INFINITY
    let missing = 0
    for (let cell = slot.firstCell; cell <= slot.lastCell; cell++) {
      const present = counts[cell] ?? 0
      if (present < minimum) minimum = present
      if (present < slot.required) missing += (slot.required - present) * grid.step
    }
    if (minimum === Number.POSITIVE_INFINITY) minimum = 0

    if (slot.hardMinimum !== undefined && minimum < slot.hardMinimum) breaksHardFloor = true
    if (minimum < slot.required) {
      underCoveredSlots++
      deficitMinutes += missing
    }
  }

  return { underCoveredSlots, deficitMinutes, breaksHardFloor }
}
