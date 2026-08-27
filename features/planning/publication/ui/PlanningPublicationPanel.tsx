"use client"

import { useMemo, useState } from "react"

import { cn } from "@/lib/utils"

import type { PlanningBoardInput } from "@/features/planning/board"
import { formatDate, WEEK_DAY_LABELS } from "@/features/planning/board/model/labels"
import {
  buildEmployeeDocument,
  type PublicationWeek,
} from "@/features/planning/publication/model/employee-document"
import { buildPublicationDocument } from "@/features/planning/publication/model/publication-document"
import {
  defaultPublicationOptions,
  hasSomethingToPublish,
  PUBLICATION_LAYOUTS,
  toggleDate,
  toggleEmployee,
  toggleSector,
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
  /** Toutes les semaines affichables, la plus récente en tête. */
  readonly weeks: readonly PublicationWeek[]
  /** La semaine regardée, et de quoi en changer sans quitter la barre. */
  readonly selectedWeek: string
  readonly onSelectWeek: (weekStart: string) => void
  /** L'équipe, pour la feuille personnelle. */
  readonly employees: readonly { readonly id: string; readonly name: string }[]
  /** Le premier rayon de chaque fiche : qui reste à l'affiche d'un comptoir. */
  readonly primarySectorByEmployee: Readonly<Record<string, string | null>>
  readonly storeName: string
  readonly storeCity: string | null
  /** Vrai tant que le planning n'est pas publié : la feuille le dira elle-même. */
  readonly draft: boolean
}

/**
 * Préparer la feuille à afficher, puis l'imprimer.
 *
 * LA MISE EN PAGE GOUVERNE, et c'est pourquoi elle est en onglets.
 *
 * Elle décide des filtres qui EXISTENT — les rayons disparaissent sur la
 * feuille personnelle, une plage de semaines y apparaît à la place. Présentés
 * ensemble dans une grille de cases à cocher, ces filtres changeaient sous les
 * doigts sans prévenir : on cherchait ce qu'on venait de faire disparaître. Un
 * onglet annonce qu'on change de contexte, et ne montre que le sien.
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
  weeks,
  selectedWeek,
  onSelectWeek,
  employees,
  primarySectorByEmployee,
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
  /**
   * L'aperçu est FERMÉ au départ.
   *
   * On ne le regarde qu'une fois : après avoir réglé, avant d'imprimer. Ouvert
   * en permanence, il repoussait les commandes hors de l'écran.
   */
  const [previewOpen, setPreviewOpen] = useState(false)

  /**
   * LES SEMAINES RETENUES par la feuille personnelle.
   *
   * Bornes incluses, et dans l'ordre CHRONOLOGIQUE — la liste range la plus
   * récente en tête, ce qui est juste pour choisir et faux pour lire : empiler
   * S38 au-dessus de S36 ferait remonter le temps d'une ligne à l'autre.
   */
  const employeeWeeks = useMemo(() => {
    const from = options.fromWeek ?? input.periodStart
    const to = options.toWeek ?? from
    const [low, high] = from <= to ? [from, to] : [to, from]
    return weeks
      .filter((week) => week.weekStart >= low && week.weekStart <= high)
      .slice()
      .sort((left, right) => left.weekStart.localeCompare(right.weekStart))
  }, [weeks, options.fromWeek, options.toWeek, input.periodStart])

  const publication = useMemo(() => {
    const context = {
      storeName,
      storeCity,
      draft,
      printedAtLabel,
      primarySectorByEmployee,
      employeeNames: Object.fromEntries(employees.map((entry) => [entry.id, entry.name])),
    }
    // Deux constructeurs, parce que deux formes de document : les feuilles de
    // rayon et de journée lisent UNE semaine, la feuille personnelle en lit
    // plusieurs. Un seul constructeur aurait pris la liste des semaines partout
    // pour n'en servir qu'une deux fois sur trois.
    return options.layout === "employee"
      ? buildEmployeeDocument(employeeWeeks, options, context)
      : buildPublicationDocument(input, options, context)
  }, [
    input,
    options,
    employeeWeeks,
    employees,
    storeName,
    storeCity,
    draft,
    printedAtLabel,
    primarySectorByEmployee,
  ])

  const printable = hasSomethingToPublish(options)
  /**
   * Ce que le bouton va sortir, COMPTÉ plutôt que promis.
   *
   * « Imprimer » ne disait pas combien de feuilles partaient : on découvrait
   * huit pages dans la fenêtre du navigateur. Le nombre est lu sur le document
   * lui-même, donc il ne peut pas se désaccorder de ce qui sort.
   */
  const sheets = publication.pages.length
  const layout = PUBLICATION_LAYOUTS.find((entry) => entry.layout === options.layout)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-x-1 gap-y-2 border-b print:hidden">
        {PUBLICATION_LAYOUTS.map((entry) => (
          <button
            key={entry.layout}
            type="button"
            onClick={() => setOptions((current) => ({ ...current, layout: entry.layout }))}
            aria-current={options.layout === entry.layout ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition",
              options.layout === entry.layout
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {entry.label}
          </button>
        ))}

        {/* La semaine se règle ici pour les feuilles qui en montrent UNE. La
            feuille personnelle a sa propre plage, plus bas : deux commandes de
            semaine à deux endroits finiraient par se contredire. */}
        {options.layout === "employee" || weeks.length < 2 ? null : (
          <label className="ml-auto flex items-center gap-2 pb-1.5 text-sm">
            <span className="text-muted-foreground">Semaine</span>
            <select
              value={selectedWeek}
              onChange={(event) => onSelectWeek(event.target.value)}
              className="rounded-md border bg-background px-2 py-1 text-sm font-medium"
            >
              {weeks.map((week) => (
                <option key={week.weekStart} value={week.weekStart}>
                  {week.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="space-y-4 print:hidden">
        <p className="text-sm text-muted-foreground">{layout?.description}</p>

        {options.layout === "employee" ? (
          <>
            <Field label="Salariés">
              <Pills
                entries={employees.map((employee) => ({
                  key: employee.id,
                  label: employee.name,
                  selected: options.employeeIds.includes(employee.id),
                }))}
                onToggle={(id) => setOptions((current) => toggleEmployee(current, id))}
              />
            </Field>
            <Field label="Semaines">
              <div className="flex flex-wrap items-center gap-2">
                <WeekBound
                  label="De"
                  value={options.fromWeek ?? input.periodStart}
                  weeks={weeks}
                  onChange={(fromWeek) => setOptions((current) => ({ ...current, fromWeek }))}
                />
                <WeekBound
                  label="à"
                  value={options.toWeek ?? options.fromWeek ?? input.periodStart}
                  weeks={weeks}
                  onChange={(toWeek) => setOptions((current) => ({ ...current, toWeek }))}
                />
              </div>
            </Field>
          </>
        ) : (
          <Field label="Rayons">
            <Pills
              entries={input.sectors.map((sector) => ({
                key: sector.id,
                label: sector.name,
                selected: options.sectorIds.includes(sector.id),
              }))}
              onToggle={(id) => setOptions((current) => toggleSector(current, id))}
            />
          </Field>
        )}

        {options.layout === "day" ? (
          <Field label="Jours">
            <Pills
              entries={input.days.map((day) => ({
                key: day.date,
                label: `${WEEK_DAY_LABELS[day.weekDay]} ${formatDate(day.date)}`,
                selected: options.dates.includes(day.date),
                disabled: day.closed,
              }))}
              onToggle={(date) => setOptions((current) => toggleDate(current, date as never))}
            />
          </Field>
        ) : null}

        <div className="flex flex-wrap items-center gap-3 border-t pt-4">
          <button
            type="button"
            onClick={() => window.print()}
            disabled={!printable}
            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:brightness-110 disabled:opacity-50"
          >
            {printable ? `Imprimer ${sheets} feuille${sheets > 1 ? "s" : ""}` : "Imprimer"}
          </button>
          <button
            type="button"
            onClick={() => setPreviewOpen((open) => !open)}
            aria-expanded={previewOpen}
            disabled={!printable}
            className="rounded-md border px-3 py-2 text-sm transition hover:bg-muted disabled:opacity-50"
          >
            {previewOpen ? "Masquer" : "Voir"}
          </button>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={options.showTotals}
              onChange={() =>
                setOptions((current) => ({ ...current, showTotals: !current.showTotals }))
              }
            />
            Totaux d’heures
          </label>
          <p className="ml-auto max-w-xs text-xs leading-snug text-muted-foreground">
            À l’impression : format PDF, orientation paysage, et graphiques
            d’arrière-plan activés pour garder les couleurs.
          </p>
        </div>
      </div>

      {/* À L'IMPRESSION, LA FEUILLE SORT QU'ELLE SOIT DÉPLIÉE OU NON.
          Le repli est un confort d'écran : la masquer avec `hidden` la garde
          dans le document, alors que la démonter ferait imprimer une page
          blanche à qui n'a pas pensé à déplier — un piège silencieux. */}
      <div
        className={cn(
          "min-w-0 overflow-auto print:block print:overflow-visible",
          previewOpen ? "block" : "hidden"
        )}
      >
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

/**
 * Une rangée de pastilles à bascule.
 *
 * Les cases à cocher en colonne coûtaient une colonne entière pour huit rayons,
 * et un ascenseur pour vingt salariés — le seul endroit de l'application où il
 * fallait faire défiler pour voir une liste de noms. Les pastilles se replient
 * sur la largeur disponible, et l'état se lit à la couleur du fond plutôt qu'à
 * un carré de treize pixels.
 */
function Pills({
  entries,
  onToggle,
}: {
  readonly entries: readonly {
    readonly key: string
    readonly label: string
    readonly selected: boolean
    readonly disabled?: boolean
  }[]
  readonly onToggle: (key: string) => void
}) {
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">Rien à choisir ici.</p>
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {entries.map((entry) => (
        <button
          key={entry.key}
          type="button"
          onClick={() => onToggle(entry.key)}
          aria-pressed={entry.selected}
          disabled={entry.disabled}
          className={cn(
            "rounded-md border px-2.5 py-1 text-sm transition",
            entry.selected
              ? "border-primary bg-primary/10 font-medium text-foreground"
              : "text-muted-foreground hover:bg-muted",
            entry.disabled && "cursor-not-allowed opacity-40 hover:bg-transparent"
          )}
        >
          {entry.label}
        </button>
      ))}
    </div>
  )
}

/** Une borne de la plage de semaines. Les deux se ressemblent trop pour être écrites deux fois. */
function WeekBound({
  label,
  value,
  weeks,
  onChange,
}: {
  readonly label: string
  readonly value: string
  readonly weeks: readonly PublicationWeek[]
  readonly onChange: (weekStart: string) => void
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-w-0 rounded-md border bg-background px-2 py-1.5 text-sm"
      >
        {weeks.map((week) => (
          <option key={week.weekStart} value={week.weekStart}>
            {week.label}
          </option>
        ))}
      </select>
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
