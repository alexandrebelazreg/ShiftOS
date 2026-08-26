"use client"

import { useMemo, useState } from "react"

import { cn } from "@/lib/utils"

import type { PlanningBoardInput } from "@/features/planning/board"
import { formatDate, WEEK_DAY_LABELS } from "@/features/planning/board/model/labels"
import { buildPublicationDocument } from "@/features/planning/publication/model/publication-document"
import {
  defaultPublicationOptions,
  hasSomethingToPublish,
  PUBLICATION_LAYOUTS,
  toggleDate,
  toggleSector,
  type PublicationLayout,
  type PublicationOptions,
} from "@/features/planning/publication/model/publication-options"
import { PlanningPublicationDocument } from "@/features/planning/publication/ui/PlanningPublicationDocument"
import { usePrintedBy } from "@/features/auth/components/printed-by"
import { signPrintedLabel } from "@/features/core/shared"

interface PlanningPublicationPanelProps {
  /** Le planning publié à afficher, déjà adapté par l'appelant. */
  readonly input: PlanningBoardInput
  /** Les rayons du planning : le point de départ de la sélection. */
  readonly sectorIds: readonly string[]
  readonly storeName: string
  readonly storeCity: string | null
  /** Vrai tant que le planning n'est pas publié : la feuille le dira elle-même. */
  readonly draft: boolean
}

/**
 * Préparer la feuille à afficher, puis l'imprimer.
 *
 * L'aperçu N'EST PAS une image du document : c'est le document, rendu à sa
 * taille réelle en millimètres. Ce que le gérant voit ici est exactement ce qui
 * sortira, coupure des pages comprise — un aperçu approximatif n'aurait servi
 * qu'à faire découvrir les débordements au bac à papier.
 *
 * L'impression passe par le navigateur (« Enregistrer au format PDF »). Rien à
 * installer, rien à envoyer nulle part : le planning d'un magasin ne quitte pas
 * le poste du gérant pour devenir un PDF, et le texte reste du texte — donc net
 * à n'importe quel agrandissement, ce qu'une capture d'écran ne serait pas.
 *
 * L'appelant REMONTE ce panneau quand il change de semaine (une `key` sur le
 * planning), ce qui repart des options par défaut sans effet de
 * réinitialisation : des cases survivantes feraient imprimer un rayon que la
 * semaine choisie ne contient plus.
 */
export function PlanningPublicationPanel({
  input,
  sectorIds,
  storeName,
  storeCity,
  draft,
}: PlanningPublicationPanelProps) {
  const [options, setOptions] = useState<PublicationOptions>(() =>
    defaultPublicationOptions(input, sectorIds)
  )
  // Figée au montage : une heure d'édition qui bougerait à chaque changement de
  // case daterait le papier de l'instant du clic, pas de celui de la relecture.
  const printedBy = usePrintedBy()
  const [printedAtLabel] = useState(() =>
    signPrintedLabel(`Édité le ${formatNow(new Date())}`, printedBy)
  )

  const publication = useMemo(
    () =>
      buildPublicationDocument(input, options, {
        storeName,
        storeCity,
        draft,
        printedAtLabel,
      }),
    [input, options, storeName, storeCity, draft, printedAtLabel]
  )

  const printable = hasSomethingToPublish(options)

  return (
    <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <aside className="space-y-5 print:hidden">
        <button
          type="button"
          onClick={() => window.print()}
          disabled={!printable}
          className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:brightness-110 disabled:opacity-50"
        >
          Imprimer / Enregistrer en PDF
        </button>

        <Field label="Mise en page">
          <div className="space-y-1.5">
            {PUBLICATION_LAYOUTS.map((entry) => (
              <LayoutChoice
                key={entry.layout}
                entry={entry}
                selected={options.layout === entry.layout}
                onSelect={(layout) => setOptions((current) => ({ ...current, layout }))}
              />
            ))}
          </div>
        </Field>

        <Field label="Rayons affichés">
          <div className="space-y-1">
            {input.sectors.map((sector) => (
              <Check
                key={sector.id}
                label={sector.name}
                checked={options.sectorIds.includes(sector.id)}
                onChange={() => setOptions((current) => toggleSector(current, sector.id))}
              />
            ))}
          </div>
        </Field>

        {/* Le choix des jours n'existe que pour la mise en page qui en fait des
            feuilles. L'afficher ailleurs promettrait un filtre que les grilles
            hebdomadaires n'appliquent pas. */}
        {options.layout === "day" ? (
          <Field label="Jours affichés">
            <div className="space-y-1">
              {input.days.map((day) => (
                <Check
                  key={day.date}
                  label={`${WEEK_DAY_LABELS[day.weekDay]} ${formatDate(day.date)}`}
                  hint={day.closed ? "fermé" : null}
                  disabled={day.closed}
                  checked={options.dates.includes(day.date)}
                  onChange={() => setOptions((current) => toggleDate(current, day.date))}
                />
              ))}
            </div>
          </Field>
        ) : null}

        <Field label="Options">
          <Check
            label="Afficher les totaux d’heures"
            checked={options.showTotals}
            onChange={() =>
              setOptions((current) => ({ ...current, showTotals: !current.showTotals }))
            }
          />
        </Field>

        <p className="border-t pt-3 text-xs leading-relaxed text-muted-foreground">
          Dans la fenêtre d’impression, choisissez <strong>Enregistrer au format PDF</strong>,
          l’orientation <strong>paysage</strong>, et activez les graphiques d’arrière-plan pour
          conserver les couleurs des rayons.
        </p>
      </aside>

      <div className="min-w-0 overflow-auto rounded-lg bg-muted/40 p-6 print:overflow-visible print:bg-transparent print:p-0">
        <PlanningPublicationDocument publication={publication} />
      </div>
    </div>
  )
}

function Field({ label, children }: { readonly label: string; readonly children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </h3>
      {children}
    </section>
  )
}

function LayoutChoice({
  entry,
  selected,
  onSelect,
}: {
  readonly entry: (typeof PUBLICATION_LAYOUTS)[number]
  readonly selected: boolean
  readonly onSelect: (layout: PublicationLayout) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(entry.layout)}
      aria-pressed={selected}
      className={cn(
        "block w-full rounded-md border px-3 py-2 text-left transition",
        selected ? "border-primary bg-primary/10" : "hover:bg-muted"
      )}
    >
      <span className="block text-sm font-medium">{entry.label}</span>
      <span className="block text-xs text-muted-foreground">{entry.description}</span>
    </button>
  )
}

function Check({
  label,
  hint = null,
  checked,
  disabled = false,
  onChange,
}: {
  readonly label: string
  readonly hint?: string | null
  readonly checked: boolean
  readonly disabled?: boolean
  readonly onChange: () => void
}) {
  return (
    <label className={cn("flex items-center gap-2 text-sm", disabled && "text-muted-foreground/60")}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={onChange} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint ? <span className="shrink-0 text-xs text-muted-foreground">{hint}</span> : null}
    </label>
  )
}

/** "13/08/2026 à 14:05" — l'heure d'édition en pied de feuille. */
function formatNow(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0")
  return (
    `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ` +
    `à ${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}
