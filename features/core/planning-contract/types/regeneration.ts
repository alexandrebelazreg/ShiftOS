/**
 * The manager's intent for a regeneration, captured as plain data.
 *
 * This shape used to live next to the board, because the board is what produces
 * it. It moved here — unchanged, and still re-exported from its old path — the
 * moment a *solver-facing* contract needed to name it: a request the engine
 * receives may not be typed by a module that sits inside the UI feature tree.
 *
 * It imports no solver — not V2, not DFS V3, not CP-SAT — on purpose, and it
 * imports no UI either. It is data both sides can name without depending on
 * each other.
 */

/** One shift the manager moved or resized by hand. */
export interface RegeneratedShiftEdit {
  readonly shiftId: string
  readonly startMinute: number
  readonly endMinute: number
}

export interface PlanningRegenerationRequest {
  /** Keep pinned shifts exactly where they are. */
  readonly preserveLockedShifts: boolean
  /** Keep the manager's manual moves and resizes. */
  readonly preserveManualEdits: boolean
  /** Ask the solver to disturb the untouched rest of the week as little as it can. */
  readonly minimizeOtherChanges: boolean
  readonly lockedShiftIds: readonly string[]
  readonly editedShifts: readonly RegeneratedShiftEdit[]
}
