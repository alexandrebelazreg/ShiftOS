import { cn } from "@/lib/utils"

import type {
  PermanenceSheetCell,
  PermanenceSheetDay,
  PermanenceSheetVM,
  PermanenceSheetWeek,
} from "@/features/permanence/publication/permanence-sheet"

/**
 * La feuille de permanence, A4 PAYSAGE.
 *
 * Le format se déduit de la grille et non d'un goût : neuf ou dix colonnes —
 * le libellé, six ou sept journées, les congés, l'astreinte — tiennent dans les
 * 281 mm utiles d'un A4 paysage, alors qu'un A4 portrait forcerait des colonnes
 * de vingt millimètres où un prénom ne rentre pas. C'est aussi le format des
 * feuilles du planning, et une réserve où toutes les feuilles ont la même taille
 * se lit mieux qu'une où chacune a la sienne.
 *
 * Le mois entier tient sur UNE page, récapitulatif exclu — celui-ci sert à
 * arbitrer devant l'écran, pas à être lu devant le tableau. `break-inside-avoid`
 * garantit qu'aucune bande de semaine ne soit coupée en deux par la pliure, ce
 * qui est la seule chose qui rendrait la feuille illisible.
 *
 * `data-publication-document` est l'ancre que les règles d'impression cherchent
 * pour effacer tout le reste de l'application. La renommer sortirait la barre
 * latérale sur le papier.
 */
export function PermanenceSheet({ sheet }: { readonly sheet: PermanenceSheetVM }) {
  return (
    <div data-publication-document className="flex flex-col items-center gap-6 print:gap-0">
      <article className="flex w-[281mm] min-h-[194mm] flex-col bg-white p-[6mm] text-black shadow-sm print:shadow-none">
        <header className="flex items-start justify-between gap-6 border-b-2 border-black pb-1.5">
          <div className="min-w-0">
            <p className="truncate text-base font-bold uppercase tracking-wide">
              {sheet.storeName}
            </p>
            <p className="text-[10px] text-neutral-600">Ouverture · Fermeture · Repos</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold">Permanences · {sheet.monthLabel}</p>
            {/* Une feuille incomplète ressemble trait pour trait à une feuille
                finie : sans ce bandeau, les cases vides ne se découvrent qu'au
                matin où personne n'ouvre. */}
            {sheet.unfilled > 0 ? (
              <p className="mt-0.5 inline-block border-2 border-black px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest">
                {sheet.unfilled} case{sheet.unfilled > 1 ? "s" : ""} à pourvoir
              </p>
            ) : null}
          </div>
          <div className="shrink-0 text-right text-[10px] text-neutral-600">
            <p className="font-semibold text-black">{sheet.memberCount} personnes au tour</p>
            <p>{sheet.closingCount} fermetures</p>
          </div>
        </header>

        <div className="mt-1.5 flex-1 space-y-1">
          {sheet.weeks.map((week) => (
            <WeekBand key={week.label} week={week} />
          ))}
        </div>

        <footer className="mt-1 flex items-baseline justify-between border-t border-neutral-300 pt-1 text-[8px] text-neutral-500">
          <span>{sheet.printedAtLabel}</span>
          <span>Case vide = permanence à pourvoir</span>
          <span>Permanences · {sheet.monthLabel}</span>
        </footer>
      </article>
    </div>
  )
}

/** Une bande de semaine : les journées en tête, puis les trois lignes. */
function WeekBand({ week }: { readonly week: PermanenceSheetWeek }) {
  return (
    <table className="w-full table-fixed border-collapse break-inside-avoid">
      <colgroup>
        <col className="w-[18mm]" />
        {week.days.map((day) => (
          <col key={day.label} />
        ))}
        <col className="w-[26mm]" />
        <col className="w-[22mm]" />
      </colgroup>

      <thead>
        <tr>
          <th className="border border-neutral-400 bg-neutral-800 px-1 py-0.5 text-left text-[10px] font-bold text-white">
            {week.label}
          </th>
          {week.days.map((day) => (
            <th
              key={day.label}
              className={cn(
                "border border-neutral-400 px-0.5 py-0.5 text-center text-[9px] font-bold leading-tight",
                !day.inMonth
                  ? "bg-neutral-200 text-neutral-500"
                  : day.holidayName
                    ? "bg-amber-200"
                    : day.weekend
                      ? "bg-orange-200"
                      : "bg-neutral-100"
              )}
            >
              <span className="block">{day.label}</span>
              <span className="block font-semibold tabular-nums">{day.dateLabel}</span>
              {day.holidayName ? (
                <span className="block truncate font-medium">{day.holidayName}</span>
              ) : null}
            </th>
          ))}
          <th className="border border-neutral-400 bg-neutral-100 px-1 py-0.5 text-center text-[9px] font-bold">
            CP
          </th>
          <th className="border border-neutral-400 bg-neutral-100 px-1 py-0.5 text-center text-[9px] font-bold">
            Astreinte
          </th>
        </tr>
      </thead>

      <tbody>
        <SlotRow label="Ouverture" days={week.days} cells={week.opening}>
          {/* Congés et astreinte se posent à la semaine : leurs cases couvrent
              les trois lignes, comme dans le classeur. Elles sont donc posées
              par la PREMIÈRE ligne — un `rowSpan` parti de la dernière
              déborderait sous le tableau. */}
          <td
            rowSpan={3}
            className="border border-neutral-400 px-1 py-0.5 text-center align-middle text-[9px]"
          >
            {week.paidLeave.length > 0 ? week.paidLeave.join(", ") : "—"}
          </td>
          <td
            rowSpan={3}
            className="border border-neutral-400 px-1 py-0.5 text-center align-middle text-[9px] font-medium"
          >
            {week.onCall ?? "—"}
          </td>
        </SlotRow>
        <SlotRow label="Fermeture" days={week.days} cells={week.closing} />
        <tr>
          <th className="border border-neutral-400 bg-neutral-100 px-1 py-0.5 text-left text-[9px] font-medium">
            Repos
          </th>
          {week.rest.map((names, index) => (
            <td
              key={week.days[index].label}
              className={cn(
                "h-[5mm] border border-neutral-400 px-0.5 text-center text-[9px] italic leading-tight text-neutral-600",
                !week.days[index].inMonth && "bg-neutral-200"
              )}
            >
              {names.join(", ")}
            </td>
          ))}
        </tr>
      </tbody>
    </table>
  )
}

/**
 * Une ligne d'ouverture ou de fermeture.
 *
 * `children` reçoit les cases de semaine — congés, astreinte — que seule la
 * première ligne pose, avec leur `rowSpan`.
 */
function SlotRow({
  label,
  days,
  cells,
  children,
}: {
  readonly label: string
  readonly days: readonly PermanenceSheetDay[]
  readonly cells: readonly PermanenceSheetCell[]
  readonly children?: React.ReactNode
}) {
  return (
    <tr>
      <th className="border border-neutral-400 bg-neutral-100 px-1 py-0.5 text-left text-[9px] font-bold">
        {label}
      </th>
      {cells.map((cell, index) => (
        <td
          key={days[index].label}
          className={cn(
            "h-[5.5mm] border border-neutral-400 px-0.5 text-center text-[10px] font-semibold",
            cell.kind === "outside" && "bg-neutral-200 text-neutral-400",
            cell.kind === "closed" && "bg-neutral-300 text-[8px] font-bold uppercase text-neutral-700"
          )}
        >
          {cell.text}
        </td>
      ))}
      {children}
    </tr>
  )
}
