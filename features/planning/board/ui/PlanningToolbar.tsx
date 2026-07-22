import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

import type { IsoDate } from "@/features/core/models"
import type { BoardToolbarVM } from "@/features/planning/board/model/board-view-model"
import type { WeekLabel } from "@/features/planning/board/model/header-controls"
import { PlanningSectorMenu } from "@/features/planning/board/ui/PlanningSectorMenu"

const VIEW_LABELS = {
  sector: "Par secteur",
  day: "Par jour",
  employee: "Par employé",
} as const

interface PlanningToolbarProps {
  readonly toolbar: BoardToolbarVM
  /** The week to display, from the selected week. Falls back to the VM's own. */
  readonly weekLabel?: WeekLabel
  readonly onChangeView: (view: "sector" | "day" | "employee") => void
  readonly onToggleSector: (sectorId: string) => void
  readonly onToggleAllSectors: (selectAll: boolean) => void
  readonly onSelectDate: (date: IsoDate) => void
  readonly onPreviousWeek: () => void
  readonly onNextWeek: () => void
  /** The one primary action: Générer before a planning, Régénérer after. */
  readonly primaryAction?: ReactNode
  /** Enregistrer / Publier and the published-state actions. */
  readonly actions?: ReactNode
  /** "● Modifications non enregistrées", or null when everything is saved. */
  readonly unsavedLabel?: string | null
  /**
   * Whether the selected week has a planning to show. When it does not, the
   * sector, view and save controls have nothing to act on, so they are hidden —
   * only the week navigation and the "generate this week" action remain.
   */
  readonly hasPlanning?: boolean
}

/**
 * The single control bar.
 *
 * One row carries where the manager is looking — week, sectors, view — and the
 * actions. The week reads once (number and range), the sectors collapse into a
 * multiselect summary, and the view is a compact menu rather than three large
 * tabs, so the schedule itself is what fills the screen. Every control reports
 * an intent upward; none decides anything.
 */
export function PlanningToolbar({
  toolbar,
  weekLabel,
  onChangeView,
  onToggleSector,
  onToggleAllSectors,
  onSelectDate,
  onPreviousWeek,
  onNextWeek,
  primaryAction,
  actions,
  unsavedLabel,
  hasPlanning = true,
}: PlanningToolbarProps) {
  const weekTitle = weekLabel?.title ?? toolbar.weekTitle
  const weekRange = weekLabel?.range ?? toolbar.rangeLabel

  return (
    <div className="sticky top-0 z-20 space-y-2 border-b bg-background/95 pb-2 pt-1 backdrop-blur">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="text-xl font-semibold">Planning</h1>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onPreviousWeek}
            disabled={!toolbar.canGoPreviousWeek}
            className="rounded-md border px-2 py-1 text-xs leading-none transition hover:bg-muted disabled:opacity-40"
            aria-label="Semaine précédente"
          >
            ◀
          </button>
          <div className="min-w-40 text-center">
            <span className="block text-sm font-semibold leading-tight">{weekTitle}</span>
            <span className="block text-[11px] leading-tight text-muted-foreground">{weekRange}</span>
          </div>
          <button
            type="button"
            onClick={onNextWeek}
            disabled={!toolbar.canGoNextWeek}
            className="rounded-md border px-2 py-1 text-xs leading-none transition hover:bg-muted disabled:opacity-40"
            aria-label="Semaine suivante"
          >
            ▶
          </button>
        </div>

        {hasPlanning && toolbar.sectors.length > 0 ? (
          <PlanningSectorMenu
            sectors={toolbar.sectors}
            onToggleSector={onToggleSector}
            onToggleAll={onToggleAllSectors}
          />
        ) : null}

        {hasPlanning ? (
          <label className="flex items-center gap-1.5 text-sm">
            <span className="text-muted-foreground">Vue :</span>
            <select
              value={toolbar.view}
              onChange={(event) => onChangeView(event.target.value as "sector" | "day" | "employee")}
              className="rounded-md border bg-background px-2 py-1.5 text-sm font-medium"
              aria-label="Mode d'affichage"
            >
              {(["sector", "day", "employee"] as const).map((mode) => (
                <option key={mode} value={mode}>
                  {VIEW_LABELS[mode]}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {hasPlanning && unsavedLabel ? (
            <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
              {unsavedLabel}
            </span>
          ) : null}
          {primaryAction}
          {hasPlanning ? actions : null}
        </div>
      </div>

      {hasPlanning && toolbar.view === "day" ? (
        <div className="flex flex-wrap items-center gap-1">
          {toolbar.days.map((day) => (
            <button
              key={day.date}
              type="button"
              disabled={day.closed}
              onClick={() => onSelectDate(day.date)}
              className={cn(
                "rounded-md border px-2 py-0.5 text-xs transition",
                day.selected ? "border-primary bg-primary/10 font-semibold" : "hover:bg-muted",
                day.closed && "opacity-40"
              )}
            >
              {day.shortLabel}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
