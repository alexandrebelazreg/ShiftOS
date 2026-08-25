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
 * latérale sur le papier. C'est aussi elle qui porte `print-color-adjust:
 * exact` : sans ça les navigateurs retirent tous les fonds à l'impression, et
 * la couleur ci-dessous n'atteindrait jamais le mur.
 *
 * LA RÈGLE DE COULEUR, en une phrase : la TEINTE dit le rôle, la VALEUR dit le
 * calendrier.
 *
 * Les lignes portent donc une teinte — ocre pour l'ouverture, pétrole pour la
 * fermeture — et les colonnes ne portent que du gris plus ou moins sombre,
 * dans l'en-tête seulement. Teinter les deux paraissait plus riche et donnait
 * l'inverse : un samedi férié en ligne de fermeture cumulait trois fonds, et
 * la case devenait une bouillie où le nom ne se lisait plus.
 *
 * Deux teintes seulement, et le plus loin possible l'une de l'autre sur la
 * roue. À deux mètres d'un tableau de réserve, on ne distingue pas deux bleus ;
 * on distingue un chaud d'un froid.
 *
 * Rien ne repose sur la couleur SEULE. « Ouverture », « Fermeture » et
 * « Repos » restent écrits en tête de ligne, un férié garde son nom, et une
 * case à pourvoir est hachurée. Beaucoup de réserves impriment en noir et
 * blanc, et une feuille qui perd son sens à la photocopie ne vaut rien.
 */

/**
 * La hachure d'une case à pourvoir.
 *
 * Le modèle laisse cette case VIDE, jamais comblée par un tiret, parce qu'un
 * tiret la ferait passer pour un choix. La hachure dit la même chose sans rien
 * y écrire : ce n'est pas une décision, c'est un trou. Et elle survit au noir
 * et blanc, là où une teinte rose deviendrait un gris parmi d'autres.
 *
 * `bg-[image:…]` et non `bg-[…]` : la forme explicite dit à Tailwind, et à
 * `tailwind-merge` qui départage les classes en conflit, qu'il s'agit d'une
 * IMAGE de fond. Sans elle, le dégradé et la couleur rose passent pour deux
 * `bg-*` concurrents et l'un des deux disparaît, en silence.
 */
const TO_FILL =
  "bg-rose-50 bg-[image:repeating-linear-gradient(45deg,transparent,transparent_2.5px,#fda4af_2.5px,#fda4af_3.5px)]"

/**
 * Les deux teintes de rôle.
 *
 * Le liseré gauche est ce qui se voit de loin : il donne à chaque ligne un
 * départ franc, là où un fond clair seul se perd sur une feuille photocopiée.
 */
const TONES = {
  opening: {
    label: "border-l-4 border-l-amber-600 bg-amber-100 text-amber-950",
    cell: "bg-amber-50",
  },
  closing: {
    label: "border-l-4 border-l-teal-700 bg-teal-100 text-teal-950",
    cell: "bg-teal-50",
  },
} as const

type SlotTone = keyof typeof TONES

/** La feuille elle-même. Le commentaire de tête en donne les règles. */
export function PermanenceSheet({ sheet }: { readonly sheet: PermanenceSheetVM }) {
  return (
    <div data-publication-document className="flex flex-col items-center gap-6 print:gap-0">
      <article className="flex w-[281mm] min-h-[194mm] flex-col bg-white p-[6mm] text-black shadow-sm print:shadow-none">
        <header className="flex items-start justify-between gap-6 border-b-4 border-teal-800 pb-1.5">
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
              <p className="mt-0.5 inline-block border-2 border-rose-700 bg-rose-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-rose-900">
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

        {/* La légende vit au pied de la feuille, sur la ligne qui existait
            déjà : elle ne coûte pas un millimètre de hauteur, et le mois doit
            continuer de tenir sur UNE page. Sans elle, la couleur n'est lisible
            que par qui l'a choisie. */}
        <footer className="mt-1 flex items-center justify-between gap-4 border-t border-neutral-300 pt-1 text-[8px] text-neutral-500">
          <span className="shrink-0">{sheet.printedAtLabel}</span>
          <span className="flex items-center gap-3">
            <LegendChip className="border-amber-600 bg-amber-100">Ouverture</LegendChip>
            <LegendChip className="border-teal-700 bg-teal-100">Fermeture</LegendChip>
            <LegendChip className={cn("border-rose-400", TO_FILL)}>À pourvoir</LegendChip>
            <LegendChip className="border-neutral-500 bg-neutral-300">Fermé</LegendChip>
          </span>
          <span className="shrink-0">Permanences · {sheet.monthLabel}</span>
        </footer>
      </article>
    </div>
  )
}

/** Un carré de couleur et son mot, pour la légende du pied de page. */
function LegendChip({
  className,
  children,
}: {
  readonly className: string
  readonly children: React.ReactNode
}) {
  return (
    <span className="flex items-center gap-1 whitespace-nowrap">
      <span className={cn("inline-block size-2 border", className)} />
      {children}
    </span>
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
          {/* Pétrole et non noir : le noir est désormais réservé au férié, qui
              est l'exception à repérer. Un numéro de semaine ne l'est pas. */}
          <th className="border border-neutral-400 bg-teal-800 px-1 py-0.5 text-left text-[10px] font-bold text-white">
            {week.label}
          </th>
          {week.days.map((day) => (
            <th
              key={day.label}
              className={cn(
                "border border-neutral-400 px-0.5 py-0.5 text-center text-[9px] font-bold leading-tight",
                // Que du gris, du plus clair au plus sombre. La teinte est prise
                // par les lignes en dessous ; l'ajouter ici ferait s'empiler
                // deux fonds sur la même case.
                !day.inMonth
                  ? "bg-neutral-200 text-neutral-500"
                  : day.holidayName
                    ? "bg-neutral-800 text-white"
                    : day.weekend
                      ? "bg-neutral-300"
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
        <SlotRow label="Ouverture" tone="opening" days={week.days} cells={week.opening}>
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
        <SlotRow label="Fermeture" tone="closing" days={week.days} cells={week.closing} />
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
  tone,
  days,
  cells,
  children,
}: {
  readonly label: string
  readonly tone: SlotTone
  readonly days: readonly PermanenceSheetDay[]
  readonly cells: readonly PermanenceSheetCell[]
  readonly children?: React.ReactNode
}) {
  return (
    <tr>
      <th
        className={cn(
          "border border-neutral-400 px-1 py-0.5 text-left text-[9px] font-bold",
          TONES[tone].label
        )}
      >
        {label}
      </th>
      {cells.map((cell, index) => (
        <td
          key={days[index].label}
          className={cn(
            "h-[5.5mm] border border-neutral-400 px-0.5 text-center text-[10px] font-semibold",
            // La teinte du rôle d'abord, les états ensuite : ce que dit le
            // CALENDRIER prime sur ce que dit le rôle. Une journée fermée ou
            // hors du mois n'attend personne, et la teindre en ocre laisserait
            // croire qu'il y manque un nom.
            TONES[tone].cell,
            cell.kind === "empty" && TO_FILL,
            cell.kind === "outside" && "bg-neutral-200 text-neutral-400",
            cell.kind === "closed" &&
              "bg-neutral-300 text-[8px] font-bold uppercase text-neutral-700"
          )}
        >
          {cell.text}
        </td>
      ))}
      {children}
    </tr>
  )
}
