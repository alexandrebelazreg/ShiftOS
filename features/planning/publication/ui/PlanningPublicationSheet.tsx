import type { ReactNode } from "react"

import type { PublicationDocumentVM } from "@/features/planning/publication/model/publication-document"

interface PlanningPublicationSheetProps {
  readonly publication: PublicationDocumentVM
  readonly heading: string
  readonly subheading: string | null
  readonly pageLabel: string
  readonly children: ReactNode
}

/**
 * Une feuille A4 paysage : en-tête, contenu, pied de page.
 *
 * Les dimensions sont en millimètres et non en pixels, pour que l'aperçu à
 * l'écran soit la feuille elle-même et pas une approximation qui déborderait à
 * l'impression. `break-after-page` fait le reste : une feuille, une page.
 *
 * L'en-tête se répète sur chaque feuille. Un planning affiché finit toujours
 * dépunaisé et recollé ailleurs, et une page qui ne dit pas de quelle semaine
 * ni de quel magasin elle parle est une page dangereuse.
 */
export function PlanningPublicationSheet({
  publication,
  heading,
  subheading,
  pageLabel,
  children,
}: PlanningPublicationSheetProps) {
  return (
    <article className="flex w-[277mm] min-h-[190mm] flex-col break-after-page bg-white p-[6mm] text-black shadow-sm last:break-after-auto print:shadow-none">
      <header className="flex items-start justify-between gap-6 border-b-2 border-black pb-2">
        <div className="min-w-0">
          <p className="truncate text-lg font-bold uppercase tracking-wide">
            {publication.storeLabel}
          </p>
          {publication.storeSubLabel ? (
            <p className="truncate text-xs text-neutral-600">{publication.storeSubLabel}</p>
          ) : null}
        </div>

        <div className="min-w-0 text-center">
          <p className="text-xl font-bold">{heading}</p>
          {subheading ? <p className="truncate text-xs text-neutral-600">{subheading}</p> : null}
        </div>

        <div className="shrink-0 text-right">
          <p className="text-lg font-bold">{publication.weekLabel}</p>
          <p className="text-xs text-neutral-600">{publication.rangeLabel}</p>
        </div>
      </header>

      {/* Un brouillon imprimé ressemble trait pour trait à un planning publié.
          Il le dit donc lui-même, en haut, avant la grille — pas dans un coin. */}
      {publication.draftLabel ? (
        <p className="mt-2 border-2 border-dashed border-neutral-500 px-3 py-1 text-center text-sm font-bold uppercase tracking-widest text-neutral-700">
          {publication.draftLabel}
        </p>
      ) : null}

      <div className="mt-3 flex-1">{children}</div>

      <footer className="mt-3 flex items-baseline justify-between border-t border-neutral-300 pt-1.5 text-[9px] text-neutral-500">
        <span>{publication.printedAtLabel}</span>
        <span>{publication.title}</span>
        <span>{pageLabel}</span>
      </footer>
    </article>
  )
}
