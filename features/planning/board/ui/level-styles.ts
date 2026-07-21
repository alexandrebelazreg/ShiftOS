import type { BoardLevel, BoardShiftKind } from "@/features/planning/board/model/board-view-model"

/**
 * Level → colour. A lookup table, not a decision: the ViewModel already decided
 * which level applies, this only says what it looks like.
 */
export const LEVEL_SURFACE: Record<BoardLevel, string> = {
  ok: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900",
  over: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900",
  under: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900",
  neutral: "bg-muted/40 text-foreground border-border",
}

export const LEVEL_DOT: Record<BoardLevel, string> = {
  ok: "bg-emerald-500",
  over: "bg-amber-500",
  under: "bg-rose-500",
  neutral: "bg-muted-foreground/40",
}

export const LEVEL_TEXT: Record<BoardLevel, string> = {
  ok: "text-emerald-600 dark:text-emerald-400",
  over: "text-amber-600 dark:text-amber-400",
  under: "text-rose-600 dark:text-rose-400",
  neutral: "text-muted-foreground",
}

/**
 * Shift kind → colour.
 *
 * The point is a schedule readable at arm's length: green opens the day, violet
 * closes it, blue is everything in between. Where the openings and closings
 * fall across the week becomes visible without reading a single time.
 */
export const KIND_SURFACE: Record<BoardShiftKind, string> = {
  opening:
    "border-emerald-300 bg-emerald-100 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200",
  day: "border-sky-300 bg-sky-100 text-sky-900 dark:border-sky-800 dark:bg-sky-950/60 dark:text-sky-200",
  closing:
    "border-violet-300 bg-violet-100 text-violet-900 dark:border-violet-800 dark:bg-violet-950/60 dark:text-violet-200",
  split:
    "border-amber-300 bg-amber-100 text-amber-900 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-200",
}

export const KIND_DOT: Record<BoardShiftKind, string> = {
  opening: "bg-emerald-500",
  day: "bg-sky-500",
  closing: "bg-violet-500",
  split: "bg-amber-500",
}

/** The legend, in reading order. A rest day has no shift, hence no kind. */
export const KIND_LEGEND: readonly { readonly kind: BoardShiftKind; readonly label: string }[] = [
  { kind: "opening", label: "Ouverture" },
  { kind: "day", label: "Journée" },
  { kind: "closing", label: "Fermeture" },
  { kind: "split", label: "Coupure" },
]
