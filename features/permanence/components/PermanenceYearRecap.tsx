"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { MONTH_LABELS } from "@/features/permanence/calendar/permanence-calendar"
import type { PermanenceYearRow } from "@/features/permanence/recap/permanence-recap"

/**
 * Le récapitulatif annuel : douze colonnes et un total, comme l'onglet du même
 * nom dans le classeur.
 *
 * Il existe pour une raison que le récapitulatif mensuel ne peut pas couvrir :
 * un mois peut être parfaitement équilibré douze fois de suite et l'année ne
 * l'être pas du tout, si c'est toujours la même personne qui hérite des
 * samedis. C'est aussi ce tableau que le générateur consulte avant de répartir
 * un nouveau mois.
 */
export function PermanenceYearRecap({
  rows,
  year,
}: {
  readonly rows: readonly PermanenceYearRow[]
  readonly year: number
}) {
  if (rows.length === 0) return null

  const monthTotals = MONTH_LABELS.map((_, index) =>
    rows.reduce((sum, row) => sum + row.closingsByMonth[index], 0)
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>Récapitulatif annuel des fermetures — {year}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Personne</th>
                {MONTH_LABELS.map((label) => (
                  <th key={label} className="py-2 pr-3 text-right font-normal">
                    {label.slice(0, 3)}
                  </th>
                ))}
                <th className="py-2 pl-3 text-right font-medium">Total</th>
                <th className="py-2 pl-3 text-right font-medium">dont samedis</th>
                <th className="py-2 pl-3 text-right font-medium">Dimanches</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.employeeId} className="border-b last:border-0">
                  <td className="py-2 pr-4">{row.name}</td>
                  {row.closingsByMonth.map((count, index) => (
                    <td
                      key={MONTH_LABELS[index]}
                      className="py-2 pr-3 text-right tabular-nums text-muted-foreground"
                    >
                      {count}
                    </td>
                  ))}
                  <td className="py-2 pl-3 text-right font-medium tabular-nums">{row.closings}</td>
                  <td className="py-2 pl-3 text-right tabular-nums">{row.saturdayClosings}</td>
                  <td className="py-2 pl-3 text-right tabular-nums">{row.sundays}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t font-medium">
                <td className="py-2 pr-4">Total</td>
                {monthTotals.map((total, index) => (
                  <td key={MONTH_LABELS[index]} className="py-2 pr-3 text-right tabular-nums">
                    {total}
                  </td>
                ))}
                <td className="py-2 pl-3 text-right tabular-nums">
                  {rows.reduce((sum, row) => sum + row.closings, 0)}
                </td>
                <td className="py-2 pl-3 text-right tabular-nums">
                  {rows.reduce((sum, row) => sum + row.saturdayClosings, 0)}
                </td>
                <td className="py-2 pl-3 text-right tabular-nums">
                  {rows.reduce((sum, row) => sum + row.sundays, 0)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}
