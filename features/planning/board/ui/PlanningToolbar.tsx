import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

import type { IsoDate } from "@/features/core/models"
import type { BoardToolbarVM } from "@/features/planning/board/model/board-view-model"
import type { SectorChoice, WeekLabel } from "@/features/planning/board/model/header-controls"
import type { WeekOption } from "@/features/planning/board/model/week"
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
  readonly onToggleMarketZone?: (selectAll: boolean) => void
  readonly sectorChoices?: readonly SectorChoice[]
  readonly onSelectDate: (date: IsoDate) => void
  readonly onPreviousWeek: () => void
  readonly onNextWeek: () => void
  /**
   * Le saut direct à une semaine, à côté des flèches plutôt qu'à leur place.
   *
   * Les deux servent à des choses différentes — la flèche pour la semaine
   * d'après, la liste pour celle d'un mois plus loin — et n'avoir que l'une des
   * deux selon qu'un planning existe ou non faisait changer de commande au
   * milieu de la navigation. Absente, la semaine reste un simple titre.
   */
  readonly weekValue?: string
  readonly weekOptions?: readonly WeekOption[]
  readonly onSelectWeek?: (monday: string) => void
  /** The one primary action: Générer before a planning, Régénérer after. */
  readonly primaryAction?: ReactNode
  /** Enregistrer / Publier and the published-state actions. */
  readonly actions?: ReactNode
  /** "● Non enregistré", or null when everything is saved. */
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
  onToggleMarketZone,
  sectorChoices,
  onSelectDate,
  onPreviousWeek,
  onNextWeek,
  weekValue,
  weekOptions,
  onSelectWeek,
  primaryAction,
  actions,
  unsavedLabel,
  hasPlanning = true,
}: PlanningToolbarProps) {
  const weekTitle = weekLabel?.title ?? toolbar.weekTitle
  const weekRange = weekLabel?.range ?? toolbar.rangeLabel

  return (
    <div className="sticky top-0 z-20 space-y-2 border-b bg-background/95 pb-2 pt-1 backdrop-blur">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {/* Le titre reste pour qui navigue au clavier ou au lecteur d'écran,
            et disparaît de l'œil : le menu latéral porte déjà « Planning » en
            surbrillance. Écrit deux fois, il coûtait la centaine de pixels qui
            manquait pour que la barre tienne sur UNE ligne — les actions
            partaient sur une seconde, collées à la grille. */}
        <h1 className="sr-only">Planning</h1>

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
            {weekValue && weekOptions && onSelectWeek ? (
              <select
                value={weekValue}
                onChange={(event) => onSelectWeek(event.target.value)}
                className="block w-full cursor-pointer rounded-md border-0 bg-transparent text-center text-sm font-semibold leading-tight hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Semaine affichée"
              >
                {weekOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    Semaine {option.weekNumber}
                  </option>
                ))}
              </select>
            ) : (
              <span className="block text-sm font-semibold leading-tight">{weekTitle}</span>
            )}
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

        {/* Choisir le rayon est ce qu'on fait AVANT de générer.
            La condition exigeait un planning existant, si bien que le menu
            disparaissait sur une semaine vide — au moment précis où il faut
            désigner ce qu'on veut générer. Sans planning, `toolbar.sectors` est
            vide lui aussi : c'est donc la liste transmise qui décide. */}
        {(sectorChoices ?? toolbar.sectors).length > 0 ? (
          <PlanningSectorMenu
            sectors={sectorChoices ?? toolbar.sectors}
            onToggleSector={onToggleSector}
            onToggleAll={onToggleAllSectors}
            onToggleMarketZone={onToggleMarketZone}
          />
        ) : null}

        {hasPlanning ? (
          // Le mot « Vue : » disparaît, pas la commande : ses options se
          // nomment « Par secteur », « Par jour », « Par employé » — elles
          // disent déjà de quoi il s'agit. Les quarante pixels qu'il coûtait
          // sont ceux qui manquaient pour que la barre tienne sur une ligne
          // quand le bandeau « non enregistré » s'y ajoute.
          <label className="flex items-center gap-1.5 text-sm">
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
