"use client"

import { cn } from "@/lib/utils"

import type { IsoDate } from "@/features/core/models"
import type { HolidayVolunteerMatrixVM } from "@/features/planning/holidays/model/holiday-volunteer-matrix"

interface HolidayVolunteerMatrixProps {
  readonly matrix: HolidayVolunteerMatrixVM
  readonly onToggle: (date: IsoDate, employeeId: string) => void
}

/**
 * Qui accepte quel férié — toute l'année, en une seule lecture.
 *
 * Le volontariat se recueillait dans onze listes dépliables, une par jour. On
 * pouvait donc régler l'année entière sans jamais voir que la même personne
 * avait dit oui à tout et une autre à rien : la question se posait, et l'écran
 * n'y répondait nulle part.
 *
 * La colonne de droite est ce qui manquait. Elle ne coûte rien à calculer et
 * change ce que cet écran permet de décider — de « ce jour-là, qui vient ? » à
 * « qui porte les fériés de cette maison ? ».
 *
 * Une case se coche ICI et nulle part ailleurs. Deux endroits pour la même
 * donnée finiraient par se contredire, et c'est ce déménagement qui a permis de
 * réduire chaque férié à une ligne.
 */
export function HolidayVolunteerMatrix({ matrix, onToggle }: HolidayVolunteerMatrixProps) {
  if (matrix.empty) {
    return (
      <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        Aucun férié ouvert cette année : il n’y a pas de volontaire à recueillir.
      </p>
    )
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b bg-muted/30">
            <th className="sticky left-0 z-10 bg-muted/30 px-3 py-2 text-left text-xs font-medium text-muted-foreground">
              Salarié
            </th>
            {matrix.columns.map((column) => (
              <th key={column.date} className="px-2 py-2 text-center">
                <span className="block whitespace-nowrap text-xs font-medium tabular-nums">
                  {column.shortLabel}
                </span>
                <span className="block whitespace-nowrap text-[10px] font-normal text-muted-foreground">
                  {column.openingLabel}
                </span>
              </th>
            ))}
            <th className="px-2 py-2 text-center text-xs font-medium text-muted-foreground">
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {matrix.rows.map((row) => (
            <tr key={row.employeeId} className="border-b last:border-0">
              <th className="sticky left-0 z-10 bg-background px-3 py-1 text-left font-normal">
                <span className="block truncate">{row.name}</span>
              </th>
              {row.cells.map((cell) => (
                <td key={cell.date} className="p-0 text-center">
                  {/* Toute la case se clique, pas seulement le carré de treize
                      pixels : vingt-quatre lignes sur huit colonnes font deux
                      cents cibles, et viser une case entière se fait sans
                      regarder. */}
                  <label className="flex cursor-pointer items-center justify-center px-2 py-1.5 transition hover:bg-muted">
                    <input
                      type="checkbox"
                      checked={cell.volunteer}
                      onChange={() => onToggle(cell.date, row.employeeId)}
                      aria-label={`${row.name}, volontaire le ${cell.date}`}
                    />
                  </label>
                </td>
              ))}
              <td
                className={cn(
                  "px-2 py-1.5 text-center tabular-nums",
                  row.total === 0 ? "text-muted-foreground" : "font-medium"
                )}
              >
                {row.total}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t bg-muted/30">
            <th className="sticky left-0 z-10 bg-muted/30 px-3 py-2 text-left text-xs font-medium text-muted-foreground">
              Volontaires
            </th>
            {matrix.columns.map((column) => (
              <td
                key={column.date}
                className={cn(
                  "px-2 py-2 text-center text-sm tabular-nums",
                  // Zéro volontaire sur un jour ouvert est un problème, pas un
                  // chiffre : le générateur n'aura personne à retenir.
                  column.volunteerCount === 0 ? "font-medium text-destructive" : "font-medium"
                )}
              >
                {column.volunteerCount}
              </td>
            ))}
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
