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
  /** Toutes les semaines affichables, la plus récente en tête. */
  readonly weeks: readonly PublicationWeek[]
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
   * LES SEMAINES RETENUES par la feuille personnelle.
   *
   * Bornes incluses, et dans l'ordre CHRONOLOGIQUE — la liste déroulante range
   * la plus récente en tête, ce qui est juste pour choisir et faux pour lire :
   * empiler S38 au-dessus de S36 ferait remonter le temps d'une ligne à
   * l'autre. Sans bornes, la seule semaine affichée.
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
  }, [input, options, employeeWeeks, employees, storeName, storeCity, draft, printedAtLabel, primarySectorByEmployee])

  const printable = hasSomethingToPublish(options)
  /**
   * L'aperçu est FERMÉ au départ.
   *
   * Il occupait les deux tiers de l'écran en permanence, et on ne le regarde
   * qu'une fois : après avoir réglé, avant d'imprimer. Fermé, les options
   * tiennent sur une largeur confortable au lieu d'une colonne de 18 rem ;
   * ouvert, la feuille se déplie sous elles, à la taille où elle sortira.
   */
  const [previewOpen, setPreviewOpen] = useState(false)

  return (
    <div className="space-y-6">
      <aside className="space-y-5 print:hidden">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => window.print()}
            disabled={!printable}
            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:brightness-110 disabled:opacity-50"
          >
            Imprimer / Enregistrer en PDF
          </button>
          <button
            type="button"
            onClick={() => setPreviewOpen((open) => !open)}
            aria-expanded={previewOpen}
            disabled={!printable}
            className="rounded-md border px-3 py-2 text-sm transition hover:bg-muted disabled:opacity-50"
          >
            {previewOpen ? "Masquer la feuille" : "Voir la feuille"}
          </button>
        </div>

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
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

          {options.layout === "employee" ? null : (
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
          )}

          {/* LA FEUILLE PERSONNELLE NE FILTRE PAS LES RAYONS, elle choisit des
              GENS et des SEMAINES. Montrer les rayons ici promettrait un filtre
              qu'elle n'applique pas — elle doit dire toutes les heures de la
              personne, sans quoi elle lui cacherait un jour où on l'attend. */}
          {options.layout === "employee" ? (
            <>
              <Field label="Salariés affichés">
                {/* AUCUN AU DÉPART : sur trois semaines, « tous » ferait sortir
                    vingt pages que personne n'a demandées. */}
                <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
                  {employees.map((employee) => (
                    <Check
                      key={employee.id}
                      label={employee.name}
                      checked={options.employeeIds.includes(employee.id)}
                      onChange={() => setOptions((current) => toggleEmployee(current, employee.id))}
                    />
                  ))}
                </div>
                {options.employeeIds.length === 0 ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Choisissez au moins un salarié.
                  </p>
                ) : null}
              </Field>

              <Field label="Semaines">
                <div className="space-y-2">
                  <WeekBound
                    label="De"
                    value={options.fromWeek ?? input.periodStart}
                    weeks={weeks}
                    onChange={(fromWeek) => setOptions((current) => ({ ...current, fromWeek }))}
                  />
                  <WeekBound
                    label="À"
                    value={options.toWeek ?? options.fromWeek ?? input.periodStart}
                    weeks={weeks}
                    onChange={(toWeek) => setOptions((current) => ({ ...current, toWeek }))}
                  />
                </div>
              </Field>
            </>
          ) : null}

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
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              Dans la fenêtre d’impression, choisissez <strong>Enregistrer au format PDF</strong>,
              l’orientation <strong>paysage</strong>, et activez les graphiques d’arrière-plan pour
              conserver les couleurs des rayons.
            </p>
          </Field>
        </div>
      </aside>

      {/* À L'IMPRESSION, LA FEUILLE SORT QU'ELLE SOIT DÉPLIÉE OU NON.
          Le repli est un confort d'écran : le masquer avec `hidden` l'aurait
          retiré du document, et le bouton Imprimer n'aurait plus rien sorti
          tant qu'on n'avait pas ouvert l'aperçu — un piège silencieux. */}
      <div className={cn("min-w-0 overflow-auto print:block print:overflow-visible", previewOpen ? "block" : "hidden")}>
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
      <span className="w-6 shrink-0 text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1.5 text-sm"
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
