import { cn } from "@/lib/utils"

import type { PublicationGridPageVM } from "@/features/planning/publication/model/publication-document"
import { PlanningPublicationSlot } from "@/features/planning/publication/ui/PlanningPublicationSlot"

interface PlanningPublicationGridProps {
  readonly page: PublicationGridPageVM
}

/**
 * La semaine en grille : un salarié par ligne, un jour par colonne.
 *
 * Les mises en page « par rayons » et « par employés » partagent ce composant
 * parce qu'elles ne diffèrent pas sur le papier — elles diffèrent sur ce que le
 * ViewModel a mis dedans. Une deuxième grille pour la même forme serait deux
 * tableaux à corriger le jour où l'un se décale.
 */
export function PlanningPublicationGrid({ page }: PlanningPublicationGridProps) {
  if (page.emptyLabel) {
    return (
      <p className="border border-dashed border-neutral-400 p-8 text-center text-sm text-neutral-500">
        {page.emptyLabel}
      </p>
    )
  }

  return (
    <table className="w-full table-fixed border-collapse">
      <colgroup>
        <col className="w-[42mm]" />
        {page.columns.map((column) => (
          <col key={column.date} />
        ))}
      </colgroup>
      <thead>
        <tr>
          <th className="border border-neutral-400 bg-neutral-100 px-2 py-1.5 text-left text-[11px] font-bold uppercase tracking-wide">
            Salarié
          </th>
          {page.columns.map((column) => (
            <th
              key={column.date}
              className={cn(
                "border border-neutral-400 px-1 py-1.5 text-center",
                column.closed ? "bg-neutral-200 text-neutral-500" : "bg-neutral-100"
              )}
            >
              <span className="block text-[12px] font-bold uppercase">{column.dayLabel}</span>
              <span className="block text-[9px] font-normal tabular-nums text-neutral-600">
                {column.dateLabel}
              </span>
              {/* Le nom du férié en tête de colonne : une colonne pleine de
                  « Jour férié » ne dit pas DE QUEL férié il s'agit. */}
              {column.holidayName ? (
                <span className="block truncate text-[9px] font-semibold uppercase tracking-wide text-neutral-700">
                  {column.holidayName}
                </span>
              ) : null}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {page.rows.map((row) => (
          // Une ligne ne se coupe jamais entre deux pages : la moitié d'un
          // salarié en bas d'une feuille est illisible et se lit de travers.
          <tr key={row.key} className="break-inside-avoid">
            {/* Les heures de la semaine sous le nom, et non dans une colonne
                de bout de ligne : c'est là que l'œil est déjà quand il demande
                « qui est-ce, et combien fait-il ? », et la colonne coûtait une
                largeur de jour pour ne porter qu'un nombre par ligne. */}
            <th className="border border-neutral-400 px-2 py-1 text-left align-middle">
              <span className="block truncate text-[13px] font-semibold">{row.name}</span>
              {row.totalLabel ? (
                <span className="block text-[10px] font-medium tabular-nums text-neutral-500">
                  {row.totalLabel}
                </span>
              ) : null}
            </th>
            {row.cells.map((cell) => (
              <td
                key={cell.date}
                className={cn(
                  "border border-neutral-400 p-1 align-top",
                  cell.emptyLabel === "Fermé" && "bg-neutral-200"
                )}
              >
                {cell.emptyLabel ? (
                  // Un férié se distingue d'un repos ordinaire à l'œil : plus
                  // sombre et non en capitales, parce que c'est une phrase et
                  // non une étiquette.
                  <p
                    className={cn(
                      "py-2 text-center",
                      cell.holiday
                        ? "text-[10px] font-semibold leading-tight text-neutral-800"
                        : "text-[10px] uppercase tracking-wide text-neutral-500"
                    )}
                  >
                    {cell.emptyLabel}
                  </p>
                ) : (
                  <div className="space-y-1">
                    {cell.slots.map((slot) => (
                      <PlanningPublicationSlot key={slot.key} slot={slot} />
                    ))}
                  </div>
                )}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
      {page.totals ? (
        <tfoot>
          <tr className="break-inside-avoid">
            <th className="border border-neutral-400 bg-neutral-100 px-2 py-1 text-left text-[10px] font-bold uppercase tracking-wide">
              Total du jour
            </th>
            {page.totals.map((total, index) => (
              <td
                key={page.columns[index].date}
                className="border border-neutral-400 bg-neutral-100 px-1 py-1 text-center text-[12px] font-bold tabular-nums"
              >
                {total ?? "—"}
              </td>
            ))}
          </tr>
        </tfoot>
      ) : null}
    </table>
  )
}
