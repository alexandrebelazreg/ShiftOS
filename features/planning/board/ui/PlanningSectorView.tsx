import { cn } from "@/lib/utils"

import type { EmployeeId } from "@/features/core/models"
import type { BoardSectorViewVM } from "@/features/planning/board/model/board-view-model"
import { sectorBarsOf } from "@/features/planning/board/model/sector-paint"
import { KIND_DOT, KIND_LEGEND, KIND_SURFACE, LEVEL_TEXT } from "@/features/planning/board/ui/level-styles"

interface PlanningSectorViewProps {
  readonly sectorView: BoardSectorViewVM
  readonly onSelectEmployee: (employeeId: EmployeeId) => void
}

/**
 * The week grid: one row per employee, one column per day, each shift a card.
 *
 * Planned versus contracted hours sit UNDER the name rather than in a column of
 * their own. The column cost a seventh of the table's width to carry one line
 * per row, squeezing the days it was meant to help read; under the name it is
 * where the eye already is when it asks "who is this and are they at their
 * hours?".
 *
 * The footer adds the one figure no row can give: everyone's hours per day.
 * Each employee's week can be individually correct while the whole team leans
 * on Friday, and that is only visible as a column total.
 */
export function PlanningSectorView({ sectorView, onSelectEmployee }: PlanningSectorViewProps) {
  return (
    <div className="space-y-3">
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {KIND_LEGEND.map((entry) => (
          <li key={entry.kind} className="flex items-center gap-1.5">
            <span className={cn("size-2.5 rounded-full", KIND_DOT[entry.kind])} aria-hidden />
            {entry.label}
          </li>
        ))}
        <li className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full border border-border bg-background" aria-hidden />
          Repos
        </li>
      </ul>

    {/* LES SEPT JOURS TIENNENT, ou rien ne tient.
        Les colonnes se dimensionnaient sur leur contenu : un « FRUITS &
        LÉGUMES » suffisait à les élargir, et le dimanche partait hors champ
        sur une semaine de zone marché — le jour qu'on vérifie en premier
        quand on cherche qui travaille le week-end.
        `table-fixed` renverse la décision : la largeur est répartie, et c'est
        au contenu de s'y tenir. La largeur minimale garde le défilement comme
        filet sur une fenêtre étroite, plutôt que d'écraser les pastilles. */}
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[58rem] table-fixed border-collapse text-sm">
        <thead>
          <tr className="border-b bg-muted/30">
            <th className="sticky left-0 z-10 w-44 bg-muted/30 px-3 py-2.5 text-left font-medium">
              Salarié
            </th>
            {sectorView.columns.map((column) => (
              <th key={column.date} className="px-0.5 py-2.5 text-center font-medium">
                <span className="block">{column.shortLabel}</span>
                <span className="block text-xs font-normal text-muted-foreground">
                  {column.dateLabel}
                </span>
                {/* Le nom du férié en tête de colonne : sans lui, une journée
                    pleine de « Jour férié » ne dit pas DE QUEL férié il s'agit. */}
                {column.holidayName ? (
                  <span className="mt-0.5 block truncate text-[10px] font-medium text-amber-700 dark:text-amber-400">
                    {column.holidayName}
                  </span>
                ) : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sectorView.rows.map((row) => (
            <tr
              key={row.employeeId}
              className={cn("border-b last:border-0", row.selected && "bg-primary/5")}
            >
              <td className="sticky left-0 z-10 bg-background px-2 py-1.5">
                <button
                  type="button"
                  onClick={() => onSelectEmployee(row.employeeId)}
                  className="flex w-full items-center gap-2 text-left"
                >
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
                    {row.initials}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{row.name}</span>
                    {/* SEUL L'ÉCART PARLE. Le ✓ vert se répétait sous chaque
                        nom d'une semaine réussie — vingt confirmations pour
                        zéro information, et l'œil finissait par ne plus voir
                        la ligne où il manquait. Le silence dit désormais que
                        le compte est bon ; ce qui s'affiche est ce qui cloche.
                        `deviationLabel` est déjà nul à l'équilibre ET quand la
                        comparaison n'a pas de sens. */}
                    <span className="flex items-center gap-1.5 text-[11px] tabular-nums text-muted-foreground">
                      {row.hoursLabel}
                      {row.deviationLabel ? (
                        <span className={cn("font-medium", LEVEL_TEXT[row.level])}>
                          {row.deviationLabel}
                        </span>
                      ) : null}
                    </span>
                  </span>
                </button>
              </td>
              {sectorView.columns.map((column) => {
                const shifts = row.shiftsByDate[column.date] ?? []
                const holiday = row.holidayLabelByDate[column.date] ?? null
                return (
                  <td key={column.date} className="px-0.5 py-1 align-top">
                    {column.closed ? (
                      <span className="block py-2 text-center text-xs text-muted-foreground/60">—</span>
                    ) : shifts.length === 0 ? (
                      // Un férié dit POURQUOI la journée est vide, en toutes
                      // lettres. « Repos » ne distingue pas un jour de congé
                      // d'un férié que le magasin a décidé de ne pas ouvrir.
                      <span
                        className={cn(
                          "block py-2 text-center text-xs",
                          holiday
                            ? "font-medium text-amber-700 dark:text-amber-400"
                            : "italic text-muted-foreground/60"
                        )}
                      >
                        {holiday ?? "Repos"}
                      </span>
                    ) : (
                      // UNE BARRE PAR RAYON, pas une par journée.
                      //
                      // La grille de la semaine est l'écran que l'on regarde en
                      // premier, et elle ne disait pas qui allait où : une seule
                      // barre par personne, colorée par le rôle, sans le nom du
                      // comptoir. Dans une zone marché où quelqu'un passe de la
                      // charcuterie au poisson dans la même journée, cela cachait
                      // précisément ce qu'on venait y chercher.
                      shifts.map((shift) =>
                        sectorBarsOf(shift).map((bar) => (
                          <button
                            key={`${shift.id}-${bar.key}`}
                            type="button"
                            onClick={() => onSelectEmployee(row.employeeId)}
                            style={bar.paint ?? undefined}
                            className={cn(
                              "mb-1 block w-full rounded-md border px-1 py-1 text-[10px] font-medium leading-tight transition hover:brightness-95",
                              bar.paint ? "border" : KIND_SURFACE[shift.kind]
                            )}
                            title={bar.title}
                          >
                            {/* Un cran plus petit sur les trois lignes. La
                                pastille est un repère, pas un texte : on y lit
                                une plage horaire d'un coup d'œil, et la taille
                                d'avant volait la largeur des jours voisins. */}
                            {bar.sectorName ? (
                              <span className="block truncate text-[10px] font-semibold opacity-80">
                                {bar.sectorName}
                              </span>
                            ) : null}
                            <span className="block tabular-nums">
                              {bar.startLabel} – {bar.endLabel}
                            </span>
                            <span className="block text-[10px] font-normal opacity-70 tabular-nums">
                              {bar.durationLabel}
                            </span>
                          </button>
                        ))
                      )
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t bg-muted/30">
            <th className="sticky left-0 z-10 bg-muted/30 px-2 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Total du jour
            </th>
            {sectorView.columns.map((column) => (
              <td key={column.date} className="px-0.5 py-2 text-center text-sm font-medium tabular-nums">
                {column.totalLabel ?? (
                  <span className="text-xs font-normal text-muted-foreground/60">—</span>
                )}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
    </div>
  )
}
