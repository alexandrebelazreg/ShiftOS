import type { DayEditTone, ShiftDeltaKind } from "@/features/planning/board/model/shift-edit-diff"

/**
 * Colours for the local-edit layer, kept out of the pure model.
 *
 * The badges carry their own meaning now that the legend is gone: green for
 * more time, red for less, blue for a move that keeps the hours, grey for no
 * change. One map, so a colour means the same thing everywhere it appears.
 */
export const DELTA_STYLE: Record<ShiftDeltaKind, string> = {
  unchanged: "border-border bg-muted/40 text-muted-foreground",
  extended:
    "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  reduced:
    "border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300",
  shifted:
    "border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300",
}

/** The verdict dot next to "Amélioration" / "Écart contractuel" / … */
export const VERDICT_DOT: Record<DayEditTone, string> = {
  ok: "bg-emerald-500",
  improve: "bg-emerald-500",
  warn: "bg-amber-500",
  block: "bg-red-500",
}

export const VERDICT_TEXT: Record<DayEditTone, string> = {
  ok: "text-foreground",
  improve: "text-emerald-700 dark:text-emerald-400",
  warn: "text-amber-700 dark:text-amber-400",
  block: "text-red-700 dark:text-red-400",
}
