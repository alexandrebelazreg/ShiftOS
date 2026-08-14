import type { PublicationDocumentVM } from "@/features/planning/publication/model/publication-document"
import { PlanningPublicationDayList } from "@/features/planning/publication/ui/PlanningPublicationDayList"
import { PlanningPublicationGrid } from "@/features/planning/publication/ui/PlanningPublicationGrid"
import { PlanningPublicationSheet } from "@/features/planning/publication/ui/PlanningPublicationSheet"

interface PlanningPublicationDocumentProps {
  readonly publication: PublicationDocumentVM
}

/**
 * Le document à afficher, feuille après feuille.
 *
 * `data-publication-document` n'est pas décoratif : c'est l'ancre sur laquelle
 * les règles `@media print` de `globals.css` effacent tout le reste de
 * l'application. Le renommer sortirait la barre latérale sur le papier.
 *
 * Le même arbre sert à l'aperçu et à l'impression — il n'y a pas de version
 * « pour l'écran ». Un aperçu qui ne serait pas le document ne prouverait rien.
 */
export function PlanningPublicationDocument({ publication }: PlanningPublicationDocumentProps) {
  if (publication.emptyLabel) {
    return (
      <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
        {publication.emptyLabel}
      </p>
    )
  }

  return (
    <div data-publication-document className="flex flex-col items-center gap-6 print:gap-0">
      {publication.pages.map((page, index) => (
        <PlanningPublicationSheet
          key={page.key}
          publication={publication}
          heading={page.title}
          subheading={page.subtitle}
          pageLabel={`Page ${index + 1} / ${publication.pages.length}`}
        >
          {page.kind === "grid" ? (
            <PlanningPublicationGrid page={page} />
          ) : (
            <PlanningPublicationDayList page={page} />
          )}
        </PlanningPublicationSheet>
      ))}
    </div>
  )
}
