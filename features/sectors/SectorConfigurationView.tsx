"use client"

import { cn } from "@/lib/utils"

import { useEffect, useMemo, useState } from "react"
import { Archive, ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react"
import { WEEK_DAYS, type WeekDay } from "@/features/core/models"
import type { StoreConfig } from "@/features/store/schemas/store.schema"
import { applyHoursToEveryDay, buildHourlyProfile, copyCoverageProfile, coveragePercentages, createEmptySector, releaseCoveragePercentages, validateSectorDemand, withCoveragePercent, type CoverageSlot, type SectorDemandConfiguration } from "@/features/sectors"
import { sectorStore } from "@/features/sectors/sector.store"
import { SectorAdvancedConstraints } from "@/features/sectors/SectorAdvancedConstraints"
import { Empty, Field, Section } from "@/features/sectors/sector-layout"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { loadSectorCitationSources } from "@/features/employees/citation-sources"
import { sectorCitationFamilyLabel, sectorDeletionVerdict, type SectorCitation } from "@/features/sectors/deletion"
import { detectSectorRenames, employeesAffectedByRenames } from "@/features/sectors/rename"
import { employeeService } from "@/features/employees/services/employee.service"

const LABELS: Record<WeekDay, string> = { monday: "Lundi", tuesday: "Mardi", wednesday: "Mercredi", thursday: "Jeudi", friday: "Vendredi", saturday: "Samedi", sunday: "Dimanche" }

export function SectorConfigurationView({ store }: { store: StoreConfig | null }) {
  const [sectors, setSectors] = useState<SectorDemandConfiguration[]>([]), [selectedId, setSelectedId] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  // Les noms tels qu'ils étaient en arrivant : sans eux, impossible de savoir
  // qu'un nom a changé — donc impossible de suivre le rattachement des salariés,
  // qui se fait par ce nom.
  const [namesOnLoad, setNamesOnLoad] = useState<readonly { id: string; name: string }[]>([])
  const [renameNotice, setRenameNotice] = useState<string | null>(null)
  useEffect(() => { queueMicrotask(() => { void sectorStore.list().then((list) => { setSectors(list); setNamesOnLoad(list.map((sector) => ({ id: sector.id, name: sector.name }))); setSelectedId(list[0]?.id ?? null) }) }) }, [])
  const selected = sectors.find((sector) => sector.id === selectedId) ?? null
  const issues = useMemo(() => selected ? validateSectorDemand(selected, store) : [], [selected, store])
  const update = (next: SectorDemandConfiguration) => { setSaved(false); setSectors((current) => current.map((sector) => sector.id === next.id ? next : sector)) }
  const create = () => { const sector = createEmptySector(); setSectors((current) => [...current, sector]); setSelectedId(sector.id); setSaved(false) }
  /**
   * Enregistrer, et faire suivre les fiches quand un nom a changé.
   *
   * Le rattachement salarié↔secteur est une CHAÎNE. Sans cette cascade, un
   * renommage laissait chaque fiche pointer vers un nom qui ne désignait plus
   * rien : le secteur paraissait désert, la mise en route le refusait, et
   * l'historique des fermetures ne trouvait plus personne à comparer — sans
   * qu'aucun message ne relie ces effets au renommage.
   *
   * Les secteurs sont écrits AVANT les fiches : si l'écriture des fiches
   * échoue, le nom est déjà à jour et le sélecteur montre l'ancien nom comme
   * périmé, donc réparable à la main. L'ordre inverse laisserait des fiches
   * pointant vers un nom que le secteur ne porte pas encore.
   */
  const save = async () => {
    if (!selected || issues.length) return
    const renames = detectSectorRenames(namesOnLoad, sectors)
    await sectorStore.save(sectors)

    if (renames.length > 0) {
      const affected = employeesAffectedByRenames(await employeeService.list(), renames)
      for (const { employee, sectors: next } of affected) {
        await employeeService.setSectors(employee.id, next)
      }
      setRenameNotice(
        affected.length === 0
          ? "Aucune fiche n’était rattachée à l’ancien nom."
          : `${affected.length} fiche${affected.length > 1 ? "s ont" : " a"} suivi le nouveau nom.`
      )
    } else {
      setRenameNotice(null)
    }

    setNamesOnLoad(sectors.map((sector) => ({ id: sector.id, name: sector.name })))
    setSaved(true)
  }

  const [pendingDeletion, setPendingDeletion] = useState<SectorDemandConfiguration | null>(null)
  const [refusal, setRefusal] = useState<readonly SectorCitation[]>([])
  const [isDeleting, setIsDeleting] = useState(false)

  /**
   * Supprimer un secteur, mais seulement s'il ne sert à personne.
   *
   * Le dépôt enregistre la LISTE ENTIÈRE : retirer une entrée puis sauver
   * suffit à l'effacer, sans qu'aucune vérification ne soit imposée nulle part.
   * C'est pour cela que le verdict est consulté ici, juste avant l'écriture, et
   * relu au moment du clic — un salarié a pu être rattaché depuis un autre
   * onglet entre l'avertissement et la confirmation.
   */
  async function confirmDeletion() {
    if (!pendingDeletion) return
    setIsDeleting(true)
    try {
      const verdict = sectorDeletionVerdict(pendingDeletion, await loadSectorCitationSources())
      if (!verdict.deletable) {
        setRefusal(verdict.citations)
        return
      }
      const remaining = sectors.filter((sector) => sector.id !== pendingDeletion.id)
      await sectorStore.save(remaining)
      setSectors(remaining)
      setSelectedId(remaining[0]?.id ?? null)
      setPendingDeletion(null)
      setSaved(true)
    } finally {
      setIsDeleting(false)
    }
  }
  return <div className="space-y-6">
    {/* Le sélecteur de secteur est de la NAVIGATION, pas du contenu. En colonne
        de gauche il coûtait un cinquième de la page en permanence pour deux ou
        trois entrées, et cette largeur manquait au tableau de couverture, qui
        est la vraie matière de cet écran. */}
    <div className="flex flex-wrap items-center gap-2">
      {sectors.map((sector) => <button
        key={sector.id}
        type="button"
        onClick={() => setSelectedId(sector.id)}
        aria-pressed={selectedId === sector.id}
        className={cn(
          "flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition",
          selectedId === sector.id ? "border-primary bg-primary/10 font-medium" : "hover:bg-muted"
        )}
      >
        <span className="size-2 shrink-0 rounded-full" style={{ background: sector.color }} />
        {sector.name || "Nouveau secteur"}
      </button>)}
      <Button size="sm" variant="outline" onClick={create}><Plus />Nouveau secteur</Button>
    </div>

    {!selected ? <Card><CardContent className="py-12 text-center"><p className="text-muted-foreground">Créez ou sélectionnez un secteur pour commencer.</p><Button className="mt-4" onClick={create}><Plus />Créer un secteur</Button></CardContent></Card> : <div className="min-w-0 space-y-6">
      {/* Identité, pas configuration : une bande compacte plutôt qu'une carte
          du même poids que les règles qui gouvernent le moteur. */}
      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-3">
        <label className="flex-1 basis-56 space-y-1.5 text-sm">
          <span className="text-xs font-medium text-muted-foreground">Nom du secteur</span>
          <Input value={selected.name} placeholder="Drive, Accueil, Caisse…" onChange={(e) => update({ ...selected, name: e.target.value })} />
        </label>
        <label className="space-y-1.5 text-sm">
          <span className="block text-xs font-medium text-muted-foreground">Couleur</span>
          <Input type="color" className="h-8 w-14 cursor-pointer p-1" value={selected.color} onChange={(e) => update({ ...selected, color: e.target.value })} />
        </label>
        <label className="flex h-8 items-center gap-2 text-sm">
          <input type="checkbox" checked={selected.status === "active"} onChange={(e) => update({ ...selected, status: e.target.checked ? "active" : "archived" })} />
          Secteur actif
        </label>
        <label className="flex h-8 items-center gap-2 text-sm">
          <input type="checkbox" checked={selected.marketZone} onChange={(e) => update({ ...selected, marketZone: e.target.checked })} />
          Zone marché
        </label>
        {selected.marketZone ? <p className="w-full text-xs text-muted-foreground">Ce secteur sera proposé avec les autres secteurs « Zone marché » pour une génération commune.</p> : null}
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          onClick={() => { setRefusal([]); setPendingDeletion(selected) }}
          aria-label={`Supprimer le secteur ${selected.name || "sans nom"}`}
        >
          <Trash2 />
          Supprimer
        </Button>
        <label className="w-full space-y-1.5 text-sm">
          <span className="text-xs font-medium text-muted-foreground">Description</span>
          <Textarea rows={2} value={selected.description} onChange={(e) => update({ ...selected, description: e.target.value })} />
        </label>
      </div>

      <Section title="Horaires du secteur" description="Indépendants de ceux du magasin : un secteur peut ouvrir plus tôt ou fermer plus tard que la surface de vente.">
        <BulkHours sector={selected} update={update} />
        <div className="rounded-lg border">
          {selected.hours.map((entry) => <div key={entry.day} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-3 py-2 last:border-0">
            <span className="w-20 text-sm font-medium">{LABELS[entry.day]}</span>
            <label className="flex w-24 items-center gap-2 text-sm text-muted-foreground">
              <input type="checkbox" checked={!entry.closed} onChange={(e) => { const next = { ...entry, closed: !e.target.checked }; update({ ...selected, hours: selected.hours.map((day) => day.day === entry.day ? next : day), coverage: { ...selected.coverage, profiles: { ...selected.coverage.profiles, [entry.day]: e.target.checked ? buildHourlyProfile(next.opensAt, next.closesAt) : [] } } }) }} />
              Ouvert
            </label>
            {entry.closed
              ? <span className="text-sm italic text-muted-foreground/70">Fermé toute la journée</span>
              : <span className="flex items-center gap-2">
                  <Input type="time" step={900} className="w-28" aria-label={`Ouverture ${LABELS[entry.day]}`} value={entry.opensAt} onChange={(e) => updateHours(selected, entry.day, "opensAt", e.target.value, update)} />
                  <span className="text-sm text-muted-foreground">→</span>
                  <Input type="time" step={900} className="w-28" aria-label={`Fermeture ${LABELS[entry.day]}`} value={entry.closesAt} onChange={(e) => updateHours(selected, entry.day, "closesAt", e.target.value, update)} />
                </span>}
          </div>)}
        </div>
      </Section>

      <Section title="Couverture horaire" description="Le nombre de salariés attendus sur chaque plage, et la part que cette plage représente dans la journée.">
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={selected.hourlyPercentagesEnabled}
            onChange={(e) => update({ ...selected, hourlyPercentagesEnabled: e.target.checked })}
          />
          <span>
            <span className="block font-medium">Afficher et régler les parts horaires en pourcentage</span>
            <span className="text-xs text-muted-foreground">Facultatif : le nombre de salariés par plage suffit au moteur.</span>
          </span>
        </label>
        {selected.hours.every((day) => day.closed) ? <Empty text="Ouvrez au moins un jour pour configurer sa couverture." /> : <CoverageTable sector={selected} update={update} showPercentages={selected.hourlyPercentagesEnabled} />}
      </Section>

      <Section title="Répartition des heures" description="Choisissez une répartition manuelle ou laissez Planiteo la déduire de la couverture configurée.">
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={selected.weeklyDistributionEnabled}
            onChange={(e) => update({ ...selected, weeklyDistributionEnabled: e.target.checked })}
          />
          <span>
            <span className="block font-medium">Définir manuellement la répartition hebdomadaire en pourcentage</span>
            <span className="text-xs text-muted-foreground">Désactivé, le volume de chaque jour est calculé automatiquement à partir des besoins horaires.</span>
          </span>
        </label>
        {/* Une cellule par jour, dans l'ordre de la semaine : la même grille que
            le tableau de couverture, parce que ce sont les mêmes journées. */}
        {selected.weeklyDistributionEnabled ? <>
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
            {WEEK_DAYS.map((day) => <label key={day} className="space-y-1 text-center">
              <span className="block text-xs font-medium text-muted-foreground">{LABELS[day].slice(0, 3)}</span>
              <span className="relative block">
                <Input type="number" min={0} step={1} className={cn(NUMERIC_FIELD, "pr-5 text-center")} aria-label={`Part ${LABELS[day]}`} value={selected.weeklyDistribution[day]} onChange={(e) => update({ ...selected, weeklyDistribution: { ...selected.weeklyDistribution, [day]: Number(e.target.value) } })} />
                <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-xs text-muted-foreground">%</span>
              </span>
            </label>)}
          </div>
          <p className={cn("text-sm font-medium", sumDistribution(selected) === 100 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive")}>
            Total : {sumDistribution(selected)} %{sumDistribution(selected) === 100 ? "" : ` · il manque ${100 - sumDistribution(selected)} %`}
          </p>
        </> : <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">Répartition automatique active : aucun pourcentage n’est à saisir.</p>}
      </Section>

      {/* Les durées ne vivent plus ici : elles avaient un second foyer dans
          « Contraintes avancées », avec d'autres libellés pour les mêmes
          valeurs, et l'héritage réglable d'un côté seulement. Deux champs pour
          un réglage, c'est un réglage qu'on croit avoir changé. */}
      <Section title="Règles des shifts">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selected.workEveryNonFixedRestDay} onChange={(e) => update({ ...selected, workEveryNonFixedRestDay: e.target.checked })} />Planifier un shift chaque jour ouvert hors repos fixe</label>
        <p className="text-sm text-muted-foreground">Les durées minimales et maximales se règlent dans « Contraintes avancées » ci-dessous.</p>
      </Section>

      {/* Coupures, plafonds, planchers, repos et équité vivent dans une seule
          section repliable, pour que cette page reste lisible. */}
      <SectorAdvancedConstraints sector={selected} update={update} store={store} />
      <Competencies sector={selected} update={update} />
      {issues.length ? <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-4"><p className="font-medium text-destructive">Corrigez ces éléments avant d’enregistrer :</p><ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{issues.map((issue, index) => <li key={`${issue.path}-${index}`}>{issue.message}</li>)}</ul></div> : null}
      <div className="flex items-center justify-end gap-3">{saved ? <span className="text-sm text-emerald-600 dark:text-emerald-400">Configuration enregistrée.{renameNotice ? ` ${renameNotice}` : ""}</span> : null}<Button size="lg" disabled={issues.length > 0} onClick={() => void save()}>Enregistrer le secteur</Button></div>
    </div>}

    <ConfirmDialog
      open={pendingDeletion !== null}
      onOpenChange={(open) => { if (!open) { setPendingDeletion(null); setRefusal([]) } }}
      title={pendingDeletion ? `Supprimer le secteur « ${pendingDeletion.name || "sans nom"} » ?` : "Supprimer le secteur ?"}
      description={
        refusal.length > 0
          ? "Ce secteur sert encore. Le supprimer viderait le rattachement des salariés qui y travaillent (le rattachement se fait par nom) et rendrait inattribuables les semaines déjà publiées. Décochez plutôt « Secteur actif » : il sortira des générations sans rien effacer."
          : "Cette action est définitive et ne peut pas être annulée. Elle n’est proposée que parce que rien ne cite encore ce secteur."
      }
      blockedBy={refusal.map((citation) => `${sectorCitationFamilyLabel(citation.family)} — ${citation.label}`)}
      blockedTitle="Ce secteur est cité par :"
      onConfirm={() => void confirmDeletion()}
      isPending={isDeleting}
    />
  </div>
}

/**
 * A numeric field stripped of its spinners.
 *
 * The arrows cost about seventeen pixels and buy nothing here: every value on
 * this page is one or two digits typed directly. Reclaiming that width is what
 * lets the coverage table hold two figures per day without overflowing.
 */
const NUMERIC_FIELD =
  "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"

function updateHours(sector: SectorDemandConfiguration, day: WeekDay, field: "opensAt" | "closesAt", value: string, update: (sector: SectorDemandConfiguration) => void) { const hours = sector.hours.map((entry) => entry.day === day ? { ...entry, [field]: value } : entry); const target = hours.find((entry) => entry.day === day)!; update({ ...sector, hours, coverage: { ...sector.coverage, profiles: { ...sector.coverage.profiles, [day]: buildHourlyProfile(target.opensAt, target.closesAt) } } }) }
/** Opening / closing times applied to the whole week in one go. */
function BulkHours({ sector, update }: { sector: SectorDemandConfiguration; update: (sector: SectorDemandConfiguration) => void }) {
  const [opensAt, setOpensAt] = useState("09:00")
  const [closesAt, setClosesAt] = useState("18:00")
  return <div className="flex flex-wrap items-end gap-3 rounded-lg border border-dashed p-3">
    <Field label="Ouverture"><Input type="time" step={900} value={opensAt} onChange={(e) => setOpensAt(e.target.value)} /></Field>
    <Field label="Fermeture"><Input type="time" step={900} value={closesAt} onChange={(e) => setClosesAt(e.target.value)} /></Field>
    <Button type="button" variant="outline" onClick={() => update(applyHoursToEveryDay(sector, opensAt, closesAt))}>Appliquer aux 7 jours</Button>
  </div>
}

/** Distinct time slots across the open days, in chronological order. */
function coverageRows(sector: SectorDemandConfiguration) {
  const rows = new Map<string, { start: string; end: string }>()
  for (const day of sector.hours) {
    if (day.closed) continue
    for (const slot of sector.coverage.profiles[day.day] ?? []) rows.set(`${slot.start}-${slot.end}`, { start: slot.start, end: slot.end })
  }
  return [...rows.values()].sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end))
}

/** Single week grid: days across the top, time slots down the left. */
/**
 * How heavy a slot is, relative to the busiest slot of its own day.
 *
 * The shape of a day — a morning rush, a lunch peak, a quiet afternoon — is the
 * thing this table exists to describe, and reading it currently means comparing
 * fourteen numbers by eye. Tinting each cell by its own share makes that shape
 * legible at a glance and costs no width, which is what the table did not have.
 *
 * Five steps, not a gradient: a continuous scale would need an inline style per
 * cell and would read as decoration. The figures stay at full contrast, so the
 * tint is never the only thing carrying the information.
 */
const DENSITY = [
  "",
  "bg-primary/[0.04]",
  "bg-primary/[0.08]",
  "bg-primary/[0.13]",
  "bg-primary/[0.19]",
] as const

function densityClass(value: number, peak: number): string {
  if (peak <= 0 || value <= 0) return DENSITY[0]
  return DENSITY[Math.min(DENSITY.length - 1, Math.ceil((value / peak) * (DENSITY.length - 1)))]
}

function CoverageTable({ sector, update, showPercentages }: { sector: SectorDemandConfiguration; update: (sector: SectorDemandConfiguration) => void; showPercentages: boolean }) {
  const openDays = WEEK_DAYS.filter((day) => !sector.hours.find((entry) => entry.day === day)?.closed)
  const rows = coverageRows(sector)

  const setProfile = (day: WeekDay, slots: readonly CoverageSlot[]) =>
    update({ ...sector, coverage: { ...sector.coverage, profiles: { ...sector.coverage.profiles, [day]: slots } } })

  const setEmployees = (day: WeekDay, start: string, employees: number) =>
    setProfile(
      day,
      (sector.coverage.profiles[day] ?? []).map((slot) =>
        slot.start === start ? { ...slot, employees, explicitZero: employees === 0 } : slot
      )
    )

  const setPercent = (day: WeekDay, start: string, percent: number) =>
    setProfile(day, withCoveragePercent(sector.coverage.profiles[day] ?? [], start, percent))

  const releaseDay = (day: WeekDay) =>
    setProfile(day, releaseCoveragePercentages(sector.coverage.profiles[day] ?? []))

  if (rows.length === 0) return <Empty text="Définissez les horaires du secteur pour générer les tranches horaires." />

  // Computed once per day, never per cell: a slot's share is a fact about the
  // whole day, and recomputing it inside the loop would read a different
  // denominator on every row.
  const percentagesByDay = new Map(
    openDays.map((day) => [day, coveragePercentages(sector.coverage.profiles[day] ?? [])])
  )
  const peakByDay = new Map(
    openDays.map((day) => [day, Math.max(0, ...(sector.coverage.profiles[day] ?? []).map((slot) => slot.employees))])
  )
  const lockedDays = openDays.filter((day) =>
    (sector.coverage.profiles[day] ?? []).some((slot) => slot.percentLocked)
  )

  return <div className="space-y-3">
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b bg-muted/30">
            <th rowSpan={showPercentages ? 2 : 1} className="sticky left-0 z-10 w-24 bg-muted/30 px-2 py-1.5 text-left align-bottom text-xs font-medium">Tranche</th>
            {openDays.map((day) => <th key={day} colSpan={showPercentages ? 2 : 1} className="border-l px-1 py-1.5 text-center text-xs font-medium">{LABELS[day].slice(0, 3)}</th>)}
          </tr>
          {showPercentages ? <tr className="border-b bg-muted/30 text-[11px] font-normal text-muted-foreground">
            {openDays.flatMap((day) => [
              <th key={`${day}-n`} className="w-14 border-l px-1 pb-1 font-normal">Salariés</th>,
              <th key={`${day}-p`} className="w-14 px-1 pb-1 font-normal">Part</th>,
            ])}
          </tr> : null}
        </thead>
        <tbody>
          {rows.map((row) => <tr key={`${row.start}-${row.end}`} className="border-b last:border-0">
            <th className="sticky left-0 z-10 bg-background px-2 py-1 text-left text-[11px] font-medium tabular-nums whitespace-nowrap">
              {row.start}<span className="text-muted-foreground">–{row.end}</span>
            </th>
            {openDays.flatMap((day) => {
              const profile = sector.coverage.profiles[day] ?? []
              const index = profile.findIndex((item) => item.start === row.start && item.end === row.end)
              const slot = index === -1 ? undefined : profile[index]
              if (!slot) return showPercentages
                ? [
                    <td key={`${day}-n`} className="border-l px-1 py-1 text-center text-xs text-muted-foreground/50">—</td>,
                    <td key={`${day}-p`} className="px-1 py-1 text-center text-xs text-muted-foreground/50">—</td>,
                  ]
                : [<td key={`${day}-n`} className="border-l px-1 py-1 text-center text-xs text-muted-foreground/50">—</td>]
              const tint = densityClass(slot.employees, peakByDay.get(day) ?? 0)
              const employeeCell =
                <td key={`${day}-n`} className={cn("border-l px-1 py-1", tint)}>
                  <Input type="number" min={0} step={1} className={cn(NUMERIC_FIELD, "h-7 px-1 text-center tabular-nums")} aria-label={`Salariés ${LABELS[day]} ${row.start}–${row.end}`} value={slot.employees} onChange={(e) => setEmployees(day, row.start, Number(e.target.value))} />
                </td>
              if (!showPercentages) return [employeeCell]
              return [
                employeeCell,
                <td key={`${day}-p`} className={cn("px-1 py-1", tint)}>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    className={cn(NUMERIC_FIELD, "h-7 px-1 text-center tabular-nums", slot.percentLocked ? "border-primary/60 font-medium" : "text-muted-foreground")}
                    aria-label={`Part ${LABELS[day]} ${row.start}–${row.end}`}
                    title={slot.percentLocked ? "Part saisie : elle ne sera plus rééquilibrée." : "Part déduite des effectifs."}
                    value={percentagesByDay.get(day)?.[index] ?? 0}
                    onChange={(e) => setPercent(day, row.start, Number(e.target.value))}
                  />
                </td>,
              ]
            })}
          </tr>)}
        </tbody>
        <tfoot>
          <tr className="border-t bg-muted/30 text-xs">
            <th className="sticky left-0 z-10 bg-muted/30 px-2 py-1.5 text-left font-medium">Total</th>
            {openDays.flatMap((day) => {
              const profile = sector.coverage.profiles[day] ?? []
              const people = profile.reduce((total, slot) => total + slot.employees, 0)
              const share = (percentagesByDay.get(day) ?? []).reduce((total, value) => total + value, 0)
              const employeeCell = <td key={`${day}-n`} className="border-l px-1 py-1.5 text-center tabular-nums">{people}</td>
              return showPercentages
                ? [employeeCell, <td key={`${day}-p`} className={cn("px-1 py-1.5 text-center tabular-nums", share === 100 ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>{share}</td>]
                : [employeeCell]
            })}
          </tr>
        </tfoot>
      </table>
    </div>

    <div className="flex flex-wrap items-center justify-between gap-2">
      {showPercentages ? <p className="text-xs text-muted-foreground">
        La <strong className="font-medium">part</strong> totalise toujours 100 % et décrit la forme de la
        journée. En saisir une la fige : seules celles que personne n’a touchées se rééquilibrent.
      </p> : <p className="text-xs text-muted-foreground">Seuls les effectifs attendus sont utilisés pour ce secteur.</p>}
      <span className="flex flex-wrap items-center gap-2">
        {showPercentages ? lockedDays.map((day) => (
          <Button key={day} type="button" size="sm" variant="outline" onClick={() => releaseDay(day)}>
            Rendre {LABELS[day]} automatique
          </Button>
        )) : null}
        <select className="h-8 rounded-md border bg-background px-2 text-xs" value="" onChange={(e) => { const [from, to] = e.target.value.split("→"); if (from && to) update(copyCoverageProfile(sector, from as WeekDay, to as WeekDay)) }}>
          <option value="">Copier un jour vers un autre…</option>
          {openDays.flatMap((from) => openDays.filter((to) => to !== from).map((to) => (
            <option key={`${from}-${to}`} value={`${from}→${to}`}>{LABELS[from]} → {LABELS[to]}</option>
          )))}
        </select>
      </span>
    </div>
  </div>
}

function Competencies({ sector, update }: { sector: SectorDemandConfiguration; update: (sector: SectorDemandConfiguration) => void }) { const [name, setName] = useState(""); const sorted = [...sector.competencies].sort((a, b) => a.order - b.order); const add = () => { if (!name.trim()) return; update({ ...sector, competencies: [...sector.competencies, { id: `competency_${crypto.randomUUID()}`, name: name.trim(), archived: false, order: sector.competencies.length }] }); setName("") }; const mutate = (id: string, patch: object) => update({ ...sector, competencies: sector.competencies.map((item) => item.id === id ? { ...item, ...patch } : item) }); return <Section title="Compétences du secteur" description="Créez uniquement les savoir-faire métier. L’ouverture, la fermeture et les coupures restent des contraintes."><div className="flex gap-2"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nom de la compétence" /><Button type="button" onClick={add}><Plus />Ajouter</Button></div>{sorted.length === 0 ? <Empty text="Aucune compétence. Elles restent facultatives pour la préparation du planning." /> : sorted.map((item, index) => <div key={item.id} className="flex items-center gap-2"><Input value={item.name} disabled={item.archived} onChange={(e) => mutate(item.id, { name: e.target.value })} /><Button size="icon" variant="outline" disabled={index === 0} onClick={() => reorder(sector, index, -1, update)}><ArrowUp /></Button><Button size="icon" variant="outline" disabled={index === sorted.length - 1} onClick={() => reorder(sector, index, 1, update)}><ArrowDown /></Button><Button size="icon" variant="outline" onClick={() => mutate(item.id, { archived: !item.archived })}><Archive /></Button></div>)}</Section> }
function reorder(sector: SectorDemandConfiguration, index: number, delta: number, update: (sector: SectorDemandConfiguration) => void) { const sorted = [...sector.competencies].sort((a, b) => a.order - b.order), target = index + delta; if (!sorted[target]) return; [sorted[index], sorted[target]] = [sorted[target], sorted[index]]; update({ ...sector, competencies: sorted.map((item, order) => ({ ...item, order })) }) }
function sumDistribution(sector: SectorDemandConfiguration) { return WEEK_DAYS.reduce((sum, day) => sum + (sector.weeklyDistribution[day] || 0), 0) }
