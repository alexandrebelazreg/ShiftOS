import type { BoardDeficitRowVM } from "@/features/planning/board/model/board-view-model"

interface PlanningDeficitTableProps {
  readonly deficits: readonly BoardDeficitRowVM[]
}

/**
 * Under-covered slots as a table rather than a paragraph each.
 *
 * "Couverture dégradée 2026-07-21 de 16:00 à 17:00 : 2 salarié(s) demandé(s),
 * 1 planifié(s), déficit 1" is a sentence a manager has to parse. Four columns
 * they can scan answers the same question in a second, and the rows stay
 * comparable to each other.
 */
export function PlanningDeficitTable({ deficits }: PlanningDeficitTableProps) {
  if (deficits.length === 0) return null

  return (
    <div className="overflow-hidden rounded-md border bg-background">
      <table className="w-full text-sm">
        <caption className="border-b bg-muted/40 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Créneaux sous-couverts
        </caption>
        <thead>
          <tr className="border-b text-xs text-muted-foreground">
            <th className="px-3 py-2 text-left font-medium">Jour</th>
            <th className="px-3 py-2 text-left font-medium">Heure</th>
            <th className="px-3 py-2 text-right font-medium">Besoin</th>
            <th className="px-3 py-2 text-right font-medium">Présents</th>
          </tr>
        </thead>
        <tbody>
          {deficits.map((row) => (
            <tr key={row.key} className="border-b last:border-0">
              <td className="px-3 py-2">{row.dayLabel}</td>
              <td className="px-3 py-2 tabular-nums">{row.hourLabel}</td>
              <td className="px-3 py-2 text-right tabular-nums">{row.required}</td>
              <td className="px-3 py-2 text-right font-semibold tabular-nums text-rose-600 dark:text-rose-400">
                {row.present}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
