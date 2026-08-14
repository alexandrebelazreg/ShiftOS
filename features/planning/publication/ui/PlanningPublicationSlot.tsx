import { cn } from "@/lib/utils"

import type { PublicationSlotVM } from "@/features/planning/publication/model/publication-document"

interface PlanningPublicationSlotProps {
  readonly slot: PublicationSlotVM
}

/**
 * Une plage horaire sur le papier.
 *
 * L'horaire est écrit gros et l'entourage petit : on lit cette feuille depuis
 * l'autre bout du couloir, et ce qu'on y cherche est une heure.
 *
 * `style` porte la couleur du rayon, comme partout ailleurs dans le board : elle
 * est saisie par le gérant, donc aucune classe Tailwind ne peut être générée
 * pour elle à la compilation. Sans couleur réglée, la case reste en noir et
 * blanc plutôt que d'en inventer une.
 */
export function PlanningPublicationSlot({ slot }: PlanningPublicationSlotProps) {
  return (
    <div
      style={slot.paint ?? undefined}
      className={cn(
        "rounded-sm border px-1.5 py-1 text-center leading-tight",
        slot.paint ? "border" : "border-neutral-400 bg-neutral-100"
      )}
    >
      {slot.sectorName ? (
        <p className="truncate text-[8px] font-bold uppercase tracking-wide opacity-80">
          {slot.sectorName}
        </p>
      ) : null}
      <p className="whitespace-nowrap text-[13px] font-bold tabular-nums">{slot.label}</p>
      <p className="text-[8px] uppercase tracking-wide opacity-75">{slot.durationLabel}</p>
    </div>
  )
}
