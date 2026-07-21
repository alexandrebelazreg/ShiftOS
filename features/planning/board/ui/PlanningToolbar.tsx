import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

import type { IsoDate } from "@/features/core/models"
import type { BoardToolbarVM } from "@/features/planning/board/model/board-view-model"
import type { WeekOption } from "@/features/planning/board/model/week"

const VIEW_LABELS = {
  sector: "Par secteur",
  day: "Par jour",
  employee: "Par employé",
} as const

interface PlanningToolbarProps {
  readonly toolbar: BoardToolbarVM
  readonly onChangeView: (view: "sector" | "day" | "employee") => void
  readonly onSelectSector: (sectorId: string) => void
  readonly onSelectDate: (date: IsoDate) => void
  readonly onPreviousWeek: () => void
  readonly onNextWeek: () => void
  /** Weeks offered for generation. Omitted hides the picker. */
  readonly weekOptions?: readonly WeekOption[]
  readonly selectedWeek?: IsoDate
  readonly onSelectWeek?: (monday: IsoDate) => void
  /** Générer / Enregistrer / Publier, supplied by whoever owns the data. */
  readonly actions?: ReactNode
}

/**
 * The single control bar.
 *
 * Everything a manager reaches for before looking at the schedule lives here:
 * which week, which sector, which view, and the three actions. These used to be
 * spread over four stacked cards, so the planning — the reason the page exists
 * — only appeared after a scroll. It sticks to the top so the controls stay
 * reachable while reading a long roster.
 *
 * Every control reports an intent upward; none of them decides anything.
 */
export function PlanningToolbar({
  toolbar,
  onChangeView,
  onSelectSector,
  onSelectDate,
  onPreviousWeek,
  onNextWeek,
  weekOptions,
  selectedWeek,
  onSelectWeek,
  actions,
}: PlanningToolbarProps) {
  return (
    <div className="sticky top-0 z-20 space-y-2 border-b bg-background/95 pb-2 pt-1 backdrop-blur">
      {/* Row one: where am I looking. Row two: what am I doing about it. */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
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
            <span className="block text-sm font-semibold leading-tight">{toolbar.weekTitle}</span>
            <span className="block text-[11px] leading-tight text-muted-foreground">
              {toolbar.rangeLabel}
            </span>
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

        <div role="tablist" aria-label="Mode d'affichage" className="flex rounded-lg bg-muted p-1">
          {(["sector", "day", "employee"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              role="tab"
              aria-selected={toolbar.view === mode}
              onClick={() => onChangeView(mode)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm transition",
                toolbar.view === mode
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "hover:bg-background/60"
              )}
            >
              {VIEW_LABELS[mode]}
            </button>
          ))}
        </div>

        {toolbar.sectors.length > 0 ? (
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Secteur</span>
            <select
              value={toolbar.sectors.find((sector) => sector.selected)?.id ?? ""}
              onChange={(event) => onSelectSector(event.target.value)}
              className="rounded-md border bg-background px-2 py-1.5 text-sm"
            >
              {toolbar.sectors.map((sector) => (
                <option key={sector.id} value={sector.id}>
                  {sector.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      {weekOptions && weekOptions.length > 0 && onSelectWeek ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Semaine</span>
            <select
              value={selectedWeek ?? weekOptions[0].value}
              onChange={(event) => onSelectWeek(event.target.value)}
              className="rounded-md border bg-background px-2 py-1.5 text-sm"
            >
              {weekOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {actions}
        </div>
      ) : actions ? (
        <div className="flex flex-wrap items-center justify-end gap-2">{actions}</div>
      ) : null}

      {toolbar.view === "day" ? (
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
