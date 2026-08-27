"use client"

import { cn } from "@/lib/utils"

import type { IsoDate } from "@/features/core/models"
import type { HolidayYearVM } from "@/features/planning/holidays/model/holiday-year-view-model"
import type { HolidayOpening } from "@/features/planning/holidays/model/holiday-schedule"

interface HolidayYearTableProps {
  readonly year: HolidayYearVM
  readonly onChangeOpening: (date: IsoDate, opening: HolidayOpening) => void
  readonly onChangeHours: (date: IsoDate, opensAt: string, closesAt: string) => void
}

const OPENINGS: readonly HolidayOpening[] = ["chome", "demi-chome", "travaille"]

/**
 * Les libellés RACCOURCIS de la colonne, et pourquoi ils ne sont pas les
 * libellés partagés.
 *
 * `HOLIDAY_OPENING_LABELS` dit « Jour chômé », « ½ jour chômé », « Jour
 * travaillé » — juste dans une phrase, trop long dans une colonne. Les trois
 * pastilles passaient à la ligne et chaque férié reprenait deux lignes de haut,
 * ce que ce tableau existe précisément pour éviter. En tête de colonne, le mot
 * « Le magasin » porte déjà le sujet : « chômé » suffit à finir la phrase.
 */
const SHORT_LABELS: Record<HolidayOpening, string> = {
  chome: "Chômé",
  "demi-chome": "½ chômé",
  travaille: "Travaillé",
}

/**
 * L'année entière, une ligne par férié.
 *
 * Chaque férié était une carte pleine largeur : deux tenaient à l'écran sur
 * onze, et l'essentiel de leur hauteur était du vide — un nom, une date, trois
 * boutons, puis un grand corps pour deux champs d'heure. On ne pouvait pas
 * comparer une année : il fallait la faire défiler et la retenir.
 *
 * Une ligne porte exactement ce qui appartient au JOUR : ce que le magasin en
 * fait, à quelles heures, et combien de personnes ont accepté d'y venir. Qui
 * sont ces personnes appartient aux GENS, et vit dans la matrice en dessous —
 * c'est ce déménagement qui fait tenir la ligne sur une ligne.
 */
export function HolidayYearTable({
  year,
  onChangeOpening,
  onChangeHours,
}: HolidayYearTableProps) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b bg-muted/30 text-left text-xs font-medium text-muted-foreground">
            <th className="px-3 py-2">Date</th>
            <th className="px-3 py-2">Férié</th>
            <th className="w-64 px-3 py-2">Le magasin</th>
            <th className="px-3 py-2">Horaires</th>
            <th className="px-3 py-2 text-right">Volontaires</th>
          </tr>
        </thead>
        <tbody>
          {year.days.map((day) => (
            <tr key={day.date} className="border-b last:border-0">
              <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                {day.dateLabel}
              </td>
              <td className="px-3 py-2">
                <span className="font-medium">{day.name}</span>
                {/* Un dimanche férié suit le second tableau de la
                    documentation : le signaler évite de le régler comme un
                    férié ordinaire. */}
                {day.sunday ? (
                  <span className="ml-2 rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
                    Dimanche
                  </span>
                ) : null}
              </td>
              <td className="px-3 py-2">
                <div className="flex gap-1">
                  {OPENINGS.map((opening) => (
                    <label
                      key={opening}
                      className={cn(
                        "cursor-pointer whitespace-nowrap rounded-md border px-2 py-0.5 text-xs transition",
                        day.opening === opening
                          ? "border-primary bg-primary/10 font-medium"
                          : "text-muted-foreground hover:bg-muted"
                      )}
                    >
                      <input
                        type="radio"
                        className="sr-only"
                        name={`opening_${day.date}`}
                        checked={day.opening === opening}
                        onChange={() => onChangeOpening(day.date, opening)}
                      />
                      {SHORT_LABELS[opening]}
                    </label>
                  ))}
                </div>
              </td>
              <td className="px-3 py-2">
                {day.acceptsVolunteers ? (
                  <div className="flex items-center gap-1">
                    <input
                      type="time"
                      aria-label={`Ouverture, ${day.name}`}
                      value={day.opensAt ?? ""}
                      onChange={(event) =>
                        onChangeHours(day.date, event.target.value, day.closesAt ?? "")
                      }
                      className="w-[7.5rem] rounded-md border bg-background px-1.5 py-1 text-xs tabular-nums"
                    />
                    <span className="text-muted-foreground">–</span>
                    <input
                      type="time"
                      aria-label={`Fermeture, ${day.name}`}
                      value={day.closesAt ?? ""}
                      onChange={(event) =>
                        onChangeHours(day.date, day.opensAt ?? "", event.target.value)
                      }
                      className="w-[7.5rem] rounded-md border bg-background px-1.5 py-1 text-xs tabular-nums"
                    />
                  </div>
                ) : (
                  // Un jour chômé n'a pas d'horaires : un tiret le dit sans
                  // proposer un champ qui ne serait lu par personne.
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                {day.acceptsVolunteers ? (
                  day.volunteerCountLabel
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
