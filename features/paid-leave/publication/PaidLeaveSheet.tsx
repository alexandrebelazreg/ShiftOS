import { cn } from "@/lib/utils"

import { sectorBarPaint } from "@/features/planning/board/model/sector-paint"
import type { LeaveSheetGroup, LeaveSheetVM } from "@/features/paid-leave/publication/leave-sheet"

/**
 * La feuille des congés, A3 PAYSAGE.
 *
 * Le format n'est pas un goût : vingt-six semaines contraignent la LARGEUR, et
 * l'A3 paysage offre quatre cents millimètres utiles — de quoi loger la colonne
 * des noms et les vingt-six colonnes à onze millimètres, plus une trentaine de
 * lignes. Toute la campagne tient donc sur UNE feuille, ce qui est précisément
 * ce qu'on punaise. En A4 paysage les colonnes tombent à neuf millimètres et la
 * feuille se coupe en deux ; en A3 portrait on gagne des lignes dont on n'a pas
 * besoin et on perd la largeur dont on a besoin.
 *
 * `data-publication-document` est l'ancre que les règles d'impression cherchent
 * pour effacer tout le reste de l'application. La renommer sortirait la barre
 * latérale sur le papier.
 */
export function PaidLeaveSheet({ sheet }: { readonly sheet: LeaveSheetVM }) {
  const columnCount = sheet.columns.length

  return (
    <div data-publication-document className="flex flex-col items-center gap-6 print:gap-0">
      <article className="leave-sheet flex w-[400mm] min-h-[277mm] flex-col bg-white p-[8mm] text-black shadow-sm print:shadow-none">
        <header className="flex items-start justify-between gap-6 border-b-2 border-black pb-2">
          <div className="min-w-0">
            <p className="truncate text-lg font-bold uppercase tracking-wide">{sheet.storeName}</p>
            <p className="text-xs text-neutral-600">{sheet.periodLabel}</p>
          </div>
          <div className="text-center">
            <p className="text-xl font-bold">Congés payés · {sheet.campaignName}</p>
            {/* Une proposition ressemble trait pour trait à un planning validé :
                sans ce bandeau, une feuille de travail finit au mur. */}
            {sheet.draft ? (
              <p className="mt-0.5 inline-block border-2 border-black px-2 py-0.5 text-xs font-bold uppercase tracking-widest">
                Proposition — ne pas afficher
              </p>
            ) : null}
          </div>
          <div className="shrink-0 text-right text-xs text-neutral-600">
            <p className="font-semibold text-black">{sheet.statusLabel}</p>
            <p>{sheet.grantedTotal} semaines accordées</p>
          </div>
        </header>

        <div className="mt-2 flex-1">
          <table className="w-full table-fixed border-collapse">
            <colgroup>
              <col className="w-[46mm]" />
              {sheet.columns.map((column) => (
                <col key={column.weekId} />
              ))}
            </colgroup>

            <thead>
              {/* Le bandeau des mois : sur vingt-six colonnes, sans lui on
                  compte les semaines pour savoir où l'on est. */}
              <tr>
                <th className="border border-neutral-400 bg-neutral-100" />
                {sheet.months.map((month) => (
                  <th
                    key={month.label}
                    colSpan={month.span}
                    className="border border-neutral-400 bg-neutral-200 px-1 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                  >
                    {month.label}
                  </th>
                ))}
              </tr>
              <tr>
                <th className="border border-neutral-400 bg-neutral-100 px-2 py-1 text-left text-[10px] font-bold uppercase tracking-wide">
                  Salarié
                </th>
                {sheet.columns.map((column) => (
                  <th
                    key={column.weekId}
                    title={column.rangeLabel}
                    className="border border-neutral-400 bg-neutral-100 px-0.5 py-1 text-center text-[10px] font-bold tabular-nums"
                  >
                    {column.weekNumber}
                  </th>
                ))}
              </tr>
            </thead>

            {sheet.groups.map((group) => (
              <SectorGroup key={group.sectorId} group={group} columnCount={columnCount} />
            ))}
          </table>

          {sheet.groups.length === 0 ? (
            <p className="border border-dashed border-neutral-400 p-8 text-center text-sm text-neutral-500">
              Aucun salarié actif à afficher.
            </p>
          ) : null}
        </div>

        <footer className="mt-2 flex items-baseline justify-between border-t border-neutral-300 pt-1.5 text-[9px] text-neutral-500">
          <span>{sheet.printedAtLabel}</span>
          <span>Case colorée = semaine de congé</span>
          <span>Congés payés · {sheet.campaignName}</span>
        </footer>
      </article>
    </div>
  )
}

function SectorGroup({
  group,
  columnCount,
}: {
  readonly group: LeaveSheetGroup
  readonly columnCount: number
}) {
  // La teinte du rayon, calculée par le même utilitaire que les barres du
  // planning : un rayon garde sa couleur partout dans l'application.
  const paint = sectorBarPaint(group.color, { opens: false, closes: false })

  return (
    <tbody className="break-inside-avoid">
      <tr>
        <th
          colSpan={columnCount + 1}
          style={paint ?? undefined}
          className={cn(
            "border border-neutral-400 px-2 py-1 text-left text-[11px] font-bold uppercase tracking-wide",
            !paint && "bg-neutral-100"
          )}
        >
          {group.sectorName}
          <span className="ml-2 text-[10px] font-medium normal-case opacity-75">
            {group.rows.length} salarié{group.rows.length > 1 ? "s" : ""}
          </span>
        </th>
      </tr>

      {group.rows.map((row) => (
        <tr key={row.employeeId} className="break-inside-avoid">
          <th className="border border-neutral-400 px-2 py-0.5 text-left align-middle">
            <span className="block truncate text-[11px] font-semibold">{row.name}</span>
            {/* Accordé sur demandé : le seul chiffre qu'une personne cherche
                sur sa propre ligne, après ses semaines. */}
            <span className="block text-[9px] font-medium tabular-nums text-neutral-500">
              {row.grantedCount} / {row.requestedCount} semaine
              {row.requestedCount > 1 ? "s" : ""}
            </span>
          </th>
          {/* La case pleine, sans texte. Le rang du vœu est une information de
              PILOTAGE : celui qui cherche son nom au mur veut savoir quelles
              semaines il est absent, pas avec quel choix il a été servi — et
              « V2 » sur sa ligne ne lui apprend qu'une chose, qu'un autre a été
              préféré. La couleur du rayon suffit à dire « ici, tu ne viens pas ». */}
          {row.cells.map((cell) => (
            <td
              key={cell.weekId}
              style={cell.granted ? paint ?? undefined : undefined}
              className={cn(
                "h-[6mm] border border-neutral-400 align-middle",
                cell.granted && !paint && "bg-neutral-400"
              )}
            />
          ))}
        </tr>
      ))}
    </tbody>
  )
}
