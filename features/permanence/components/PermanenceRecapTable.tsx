"use client"

import type { WeekDay } from "@/features/core/models"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { WEEK_DAY_SHORT_LABELS } from "@/features/employees/utils/employee.labels"
import type { PermanenceRecap } from "@/features/permanence/recap/permanence-recap"
import { cn } from "@/lib/utils"

/**
 * Le récapitulatif des fermetures — la pièce qui rend le tour discutable.
 *
 * Les trois chiffres qui se contestent tiennent les trois premières colonnes :
 * combien de fermetures, dont combien de samedis, et combien de dimanches. Le
 * détail par jour de la semaine suit, en gris, parce qu'il sert à expliquer un
 * déséquilibre, pas à le constater.
 *
 * L'ÉCART est écrit en clair au-dessus du tableau. Un tableau de chiffres ne
 * dit pas s'il est juste : il faut le lire en entier et faire la soustraction
 * de tête. La faire ici, c'est la seule façon qu'un déséquilibre se remarque
 * sans être cherché.
 */
export function PermanenceRecapTable({
  recap,
  weekDays,
  title,
}: {
  readonly recap: PermanenceRecap
  /** Les jours à détailler — le dimanche n'a de colonne que s'il en a une dans la grille. */
  readonly weekDays: readonly WeekDay[]
  readonly title: string
}) {
  const balanced = recap.closingSpread <= 1 && recap.saturdaySpread <= 1

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {recap.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Personne ne participe encore aux permanences. Cochez « Participe aux permanences » dans
            l’onglet Permanence d’une fiche employé.
          </p>
        ) : (
          <>
            <p
              className={cn(
                "rounded-lg border p-3 text-sm",
                balanced
                  ? "border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30"
                  : "border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30"
              )}
            >
              {balanced ? (
                <>
                  Le tour est équilibré : {gapSentence(recap.closingSpread, "fermeture")} et{" "}
                  {gapSentence(recap.saturdaySpread, "samedi")} entre la personne la plus chargée et
                  la moins chargée.
                </>
              ) : (
                <>
                  Écart de <strong>{recap.closingSpread}</strong> fermeture
                  {recap.closingSpread > 1 ? "s" : ""} et de{" "}
                  <strong>{recap.saturdaySpread}</strong> samedi
                  {recap.saturdaySpread > 1 ? "s" : ""} entre la personne la plus chargée et la
                  moins chargée.
                </>
              )}
            </p>

            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">Personne</th>
                    <th className="py-2 pr-4 text-right font-medium">Fermetures</th>
                    <th className="py-2 pr-4 text-right font-medium">dont samedis</th>
                    <th className="py-2 pr-4 text-right font-medium">Dimanches</th>
                    <th className="py-2 pr-4 text-right font-medium">Ouvertures</th>
                    {weekDays.map((day) => (
                      <th key={day} className="py-2 pr-3 text-right font-normal">
                        {WEEK_DAY_SHORT_LABELS[day]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {recap.rows.map((row) => (
                    <tr key={row.employeeId} className="border-b last:border-0">
                      <td className="py-2 pr-4">{row.name}</td>
                      <td className="py-2 pr-4 text-right font-medium tabular-nums">
                        {row.load.closings}
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums">
                        {row.load.saturdayClosings}
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums">{row.load.sundays}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{row.load.openings}</td>
                      {weekDays.map((day) => (
                        <td
                          key={day}
                          className="py-2 pr-3 text-right tabular-nums text-muted-foreground"
                        >
                          {row.load.closingsByDay[day]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t font-medium">
                    <td className="py-2 pr-4">Total</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{recap.totals.closings}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {recap.totals.saturdayClosings}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">{recap.totals.sundays}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{recap.totals.openings}</td>
                    {weekDays.map((day) => (
                      <td key={day} className="py-2 pr-3 text-right tabular-nums">
                        {recap.totals.closingsByDay[day]}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

/** « aucun écart » / « un samedi d'écart » — un chiffre nul mérite un mot, pas un zéro. */
function gapSentence(spread: number, noun: string): string {
  if (spread === 0) return `aucun écart de ${noun}`
  return `${spread} ${noun}${spread > 1 ? "s" : ""} d’écart`
}
