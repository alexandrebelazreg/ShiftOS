import { cn } from "@/lib/utils"

import {
  describeFractionation,
  describeRemaining,
  describeShortBalance,
  type LeaveSlipsVM,
  type PaidLeaveSlip,
} from "@/features/paid-leave/publication/leave-slips"

/**
 * Les billets individuels, DEUX PAR PAGE A4 PORTRAIT.
 *
 * Le format se déduit de l'usage : ces billets se distribuent, ils ne se
 * punaisent pas. Un par page gaspillerait trente feuilles pour trente
 * personnes ; quatre par page laisseraient à chaque billet un quart de page où
 * ni les semaines ni la raison ne tiennent. Deux demi-pages se coupent d'un
 * trait de massicot et se glissent dans une enveloppe de paie.
 *
 * A4 et non A3 : celui-ci sort de l'imprimante du bureau, pas du traceur.
 *
 * `data-publication-document` est l'ancre que les règles d'impression cherchent
 * pour effacer le reste de l'application. La feuille au mur porte la même — les
 * deux ne sont jamais rendues en même temps, et c'est l'onglet qui choisit.
 */
export function PaidLeaveSlips({ sheet }: { readonly sheet: LeaveSlipsVM }) {
  if (sheet.slips.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        Aucun billet à imprimer : personne n’a encore de semaine ni de vœu.
      </div>
    )
  }

  // Par PAIRES, pour que la coupe tombe au milieu d'une page et non entre deux
  // billets d'une même moitié.
  const pages: PaidLeaveSlip[][] = []
  for (let index = 0; index < sheet.slips.length; index += 2) {
    pages.push(sheet.slips.slice(index, index + 2))
  }

  return (
    <div data-publication-document className="flex flex-col items-center gap-6 print:gap-0">
      {pages.map((page) => (
        <article
          key={page[0].employeeId}
          className="leave-slips flex w-[210mm] min-h-[297mm] flex-col bg-white p-[10mm] text-black shadow-sm print:shadow-none"
        >
          {page.map((slip, index) => (
            <div key={slip.employeeId} className="flex-1">
              <Slip sheet={sheet} slip={slip} />
              {/* Le trait de coupe, seulement entre les deux moitiés. */}
              {index === 0 ? (
                <div className="my-[6mm] border-t border-dashed border-neutral-400" />
              ) : null}
            </div>
          ))}
        </article>
      ))}
    </div>
  )
}

function Slip({ sheet, slip }: { readonly sheet: LeaveSlipsVM; readonly slip: PaidLeaveSlip }) {
  const remaining = describeRemaining(slip)
  const fractionation = describeFractionation(slip)
  const shortBalance = describeShortBalance(slip)

  return (
    <section className="flex h-full flex-col">
      <header className="flex items-start justify-between gap-4 border-b-2 border-black pb-1.5">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold uppercase tracking-wide">{sheet.storeName}</p>
          <p className="text-[10px] text-neutral-600">
            Congés payés · {sheet.campaignName} · {sheet.periodLabel}
          </p>
        </div>
        <div className="shrink-0 text-right text-[10px] text-neutral-600">
          <p className="font-semibold text-black">{sheet.statusLabel}</p>
        </div>
      </header>

      {/* Une proposition ressemble trait pour trait à un arbitrage rendu. Sans
          ce bandeau, un brouillon distribué devient une promesse. */}
      {sheet.draft ? (
        <p className="mt-2 inline-block self-start border-2 border-black px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest">
          Proposition — ne pas distribuer
        </p>
      ) : null}

      <p className="mt-3 text-lg font-bold">{slip.name}</p>
      {slip.sectorName ? (
        <p className="text-[11px] text-neutral-600">{slip.sectorName}</p>
      ) : null}

      <div className="mt-3">
        {slip.weeks.length === 0 ? (
          <p className="text-sm font-medium">Aucune semaine ne vous a été attribuée sur cette période.</p>
        ) : (
          <>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-600">
              Vos semaines d’absence
            </p>
            <ul className="mt-1 space-y-0.5">
              {slip.weeks.map((week) => (
                <li key={week.weekId} className="flex items-baseline gap-2 text-sm">
                  <span className={cn("font-medium", week.closed && "text-neutral-600")}>
                    {week.label}
                  </span>
                  {week.closed ? (
                    <span className="text-[10px] uppercase tracking-wide text-neutral-600">
                      fermeture du magasin
                    </span>
                  ) : week.rank ? (
                    <span className="text-[10px] text-neutral-600">vœu {week.rank}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <p className="mt-3 text-sm">
        {slip.grantedCount} semaine{slip.grantedCount > 1 ? "s" : ""} attribuée
        {slip.grantedCount > 1 ? "s" : ""} sur {slip.grantableCount} que vous pouviez obtenir.
      </p>
      {/* L'écart entre ce qu'on a demandé et ce qu'on POUVAIT obtenir, quand il
          existe. Sans cette phrase, une personne dont le solde était trop court
          lirait un refus d'arbitrage là où l'arbitrage n'y est pour rien. */}
      {shortBalance ? (
        <p className="mt-1 text-[11px] text-neutral-700">{shortBalance}</p>
      ) : null}

      {/* La raison, et c'est tout l'objet de ce billet. La feuille au mur dit
          ce qui a été décidé ; elle ne dit à personne pourquoi, et c'est la
          seule question que se pose celui qui n'y trouve pas ses semaines. */}
      {slip.message ? (
        <p className="mt-1 text-[11px] text-neutral-700">{slip.message}</p>
      ) : null}

      {fractionation ? (
        <p className="mt-3 border-l-2 border-black pl-2 text-[11px]">{fractionation}</p>
      ) : null}

      {remaining ? <p className="mt-2 text-[11px] text-neutral-700">{remaining}</p> : null}

      <p className="mt-auto pt-3 text-[9px] text-neutral-500">{sheet.printedAtLabel}</p>
    </section>
  )
}
