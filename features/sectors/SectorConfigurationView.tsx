"use client"

import { useEffect, useMemo, useState } from "react"
import { Archive, ArrowDown, ArrowUp, Plus } from "lucide-react"
import { WEEK_DAYS, type WeekDay } from "@/features/core/models"
import type { StoreConfig } from "@/features/store/schemas/store.schema"
import { applyHoursToEveryDay, buildHourlyProfile, copyCoverageProfile, createEmptySector, createSectorRepository, validateSectorDemand, type SectorDemandConfiguration } from "@/features/sectors"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

const LABELS: Record<WeekDay, string> = { monday: "Lundi", tuesday: "Mardi", wednesday: "Mercredi", thursday: "Jeudi", friday: "Vendredi", saturday: "Samedi", sunday: "Dimanche" }

export function SectorConfigurationView({ store }: { store: StoreConfig | null }) {
  const [sectors, setSectors] = useState<SectorDemandConfiguration[]>([]), [selectedId, setSelectedId] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  useEffect(() => { queueMicrotask(() => { const list = createSectorRepository(window.localStorage).list(); setSectors(list); setSelectedId(list[0]?.id ?? null) }) }, [])
  const selected = sectors.find((sector) => sector.id === selectedId) ?? null
  const issues = useMemo(() => selected ? validateSectorDemand(selected, store) : [], [selected, store])
  const update = (next: SectorDemandConfiguration) => { setSaved(false); setSectors((current) => current.map((sector) => sector.id === next.id ? next : sector)) }
  const create = () => { const sector = createEmptySector(); setSectors((current) => [...current, sector]); setSelectedId(sector.id); setSaved(false) }
  const save = () => { if (!selected || issues.length) return; createSectorRepository(window.localStorage).save(sectors); setSaved(true) }
  return <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
    <Card className="h-fit"><CardHeader><CardTitle className="text-base">Vos secteurs</CardTitle></CardHeader><CardContent className="space-y-2"><Button className="w-full" onClick={create}><Plus />Nouveau secteur</Button>{sectors.length === 0 ? <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">Aucun secteur. Créez le premier pour définir sa demande.</p> : sectors.map((sector) => <Button key={sector.id} className="w-full justify-start" variant={selectedId === sector.id ? "secondary" : "ghost"} onClick={() => setSelectedId(sector.id)}><span className="size-2 rounded-full" style={{ background: sector.color }} />{sector.name || "Nouveau secteur"}</Button>)}</CardContent></Card>
    {!selected ? <Card><CardContent className="py-12 text-center"><p className="text-muted-foreground">Créez ou sélectionnez un secteur pour commencer.</p><Button className="mt-4" onClick={create}><Plus />Créer un secteur</Button></CardContent></Card> : <div className="space-y-6">
      <Section title="Informations générales"><div className="grid gap-4 md:grid-cols-2"><Field label="Nom *"><Input value={selected.name} onChange={(e) => update({ ...selected, name: e.target.value })} /></Field><Field label="Couleur d’affichage"><Input type="color" className="h-10" value={selected.color} onChange={(e) => update({ ...selected, color: e.target.value })} /></Field></div><Field label="Description"><Textarea value={selected.description} onChange={(e) => update({ ...selected, description: e.target.value })} /></Field><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selected.status === "active"} onChange={(e) => update({ ...selected, status: e.target.checked ? "active" : "archived" })} />Secteur actif</label></Section>
      <Section title="Horaires du secteur" description="Ils peuvent être plus restrictifs que ceux du magasin, jamais plus larges."><BulkHours sector={selected} update={update} />{selected.hours.map((entry) => <div key={entry.day} className="grid items-center gap-3 border-b py-3 last:border-0 sm:grid-cols-[110px_90px_1fr_1fr]"><span className="text-sm font-medium">{LABELS[entry.day]}</span><label className="text-sm"><input type="checkbox" checked={!entry.closed} onChange={(e) => { const next = { ...entry, closed: !e.target.checked }; update({ ...selected, hours: selected.hours.map((day) => day.day === entry.day ? next : day), coverage: { ...selected.coverage, profiles: { ...selected.coverage.profiles, [entry.day]: e.target.checked ? buildHourlyProfile(next.opensAt, next.closesAt) : [] } } }) }} /> Ouvert</label><Input type="time" step={900} disabled={entry.closed} value={entry.opensAt} onChange={(e) => updateHours(selected, entry.day, "opensAt", e.target.value, update)} /><Input type="time" step={900} disabled={entry.closed} value={entry.closesAt} onChange={(e) => updateHours(selected, entry.day, "closesAt", e.target.value, update)} /></div>)}</Section>
      <Section title="Couverture horaire" description="Indiquez le nombre minimum de salariés attendus sur chaque plage.">{selected.hours.every((day) => day.closed) ? <Empty text="Ouvrez au moins un jour pour configurer sa couverture." /> : <CoverageTable sector={selected} update={update} />}</Section>
      <Section title="Répartition des heures" description="Répartissez 100 % des heures planifiables du secteur entre les jours de la semaine."><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{WEEK_DAYS.map((day) => <Field key={day} label={LABELS[day]}><div className="flex items-center gap-2"><Input type="number" min={0} step={1} value={selected.weeklyDistribution[day]} onChange={(e) => update({ ...selected, weeklyDistribution: { ...selected.weeklyDistribution, [day]: Number(e.target.value) } })} /><span>%</span></div></Field>)}</div><p className={`text-sm font-medium ${sumDistribution(selected) === 100 ? "text-emerald-600" : "text-destructive"}`}>Total : {sumDistribution(selected)} % · Écart : {100 - sumDistribution(selected)} %</p></Section>
      <Section title="Règles des shifts"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selected.workEveryNonFixedRestDay} onChange={(e) => update({ ...selected, workEveryNonFixedRestDay: e.target.checked })} />Planifier un shift chaque jour ouvert hors repos fixe</label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selected.shiftRules.inheritMinimumShiftDuration} onChange={(e) => update({ ...selected, shiftRules: { ...selected.shiftRules, inheritMinimumShiftDuration: e.target.checked } })} />Hériter de la durée minimale du magasin ({store?.minShiftDuration ? `${store.minShiftDuration / 60} h` : "non configurée"})</label><div className="grid gap-4 md:grid-cols-3"><Field label="Durée minimale (minutes)"><Input type="number" min={15} step={15} disabled={selected.shiftRules.inheritMinimumShiftDuration} value={selected.shiftRules.minimumShiftDuration ?? ""} onChange={(e) => update({ ...selected, shiftRules: { ...selected.shiftRules, minimumShiftDuration: Number(e.target.value) } })} /></Field><Field label="Durée effective maximale / jour"><Input type="number" min={15} step={15} value={selected.shiftRules.maximumDailyDuration} onChange={(e) => update({ ...selected, shiftRules: { ...selected.shiftRules, maximumDailyDuration: Number(e.target.value) } })} /></Field><Field label="Pas de temps"><Input disabled value="15 minutes" /></Field></div><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selected.shiftRules.splitShiftAllowed} onChange={(e) => update({ ...selected, shiftRules: { ...selected.shiftRules, splitShiftAllowed: e.target.checked } })} />Autoriser les shifts avec coupure dans ce secteur</label>{selected.shiftRules.splitShiftAllowed ? <Field label="Durée maximale de la coupure (minutes)"><Input type="number" min={15} step={15} value={selected.shiftRules.maximumSplitDuration ?? ""} onChange={(e) => update({ ...selected, shiftRules: { ...selected.shiftRules, maximumSplitDuration: Number(e.target.value) } })} /></Field> : null}</Section>
      <Competencies sector={selected} update={update} />
      {issues.length ? <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-4"><p className="font-medium text-destructive">Corrigez ces éléments avant d’enregistrer :</p><ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{issues.map((issue, index) => <li key={`${issue.path}-${index}`}>{issue.message}</li>)}</ul></div> : null}
      <div className="flex items-center justify-end gap-3">{saved ? <span className="text-sm text-emerald-600">Configuration enregistrée.</span> : null}<Button size="lg" disabled={issues.length > 0} onClick={save}>Enregistrer le secteur</Button></div>
    </div>}
  </div>
}

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
function CoverageTable({ sector, update }: { sector: SectorDemandConfiguration; update: (sector: SectorDemandConfiguration) => void }) {
  const openDays = WEEK_DAYS.filter((day) => !sector.hours.find((entry) => entry.day === day)?.closed)
  const rows = coverageRows(sector)
  const setEmployees = (day: WeekDay, start: string, employees: number) => update({ ...sector, coverage: { ...sector.coverage, profiles: { ...sector.coverage.profiles, [day]: (sector.coverage.profiles[day] ?? []).map((slot) => slot.start === start ? { ...slot, employees, explicitZero: employees === 0 } : slot) } } })

  if (rows.length === 0) return <Empty text="Définissez les horaires du secteur pour générer les tranches horaires." />

  return <div className="overflow-x-auto">
    <table className="w-full border-separate border-spacing-0 text-sm">
      <thead>
        <tr>
          <th className="sticky left-0 z-10 bg-card p-2 text-left font-medium">Tranche</th>
          {openDays.map((day) => <th key={day} className="min-w-28 p-2 text-center font-medium">{LABELS[day]}</th>)}
        </tr>
        <tr>
          <th className="sticky left-0 z-10 bg-card p-2 text-left text-xs font-normal text-muted-foreground">Copier</th>
          {openDays.map((day) => <th key={day} className="p-2">
            <select className="h-8 w-full rounded-md border bg-background px-2 text-xs font-normal" value="" onChange={(e) => e.target.value && update(copyCoverageProfile(sector, e.target.value as WeekDay, day))}>
              <option value="">Copier depuis…</option>
              {openDays.filter((other) => other !== day).map((other) => <option key={other} value={other}>{LABELS[other]}</option>)}
            </select>
          </th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => <tr key={`${row.start}-${row.end}`}>
          <th className="sticky left-0 z-10 border-t bg-card p-2 text-left text-xs font-medium whitespace-nowrap">{row.start}–{row.end}</th>
          {openDays.map((day) => {
            const slot = (sector.coverage.profiles[day] ?? []).find((item) => item.start === row.start && item.end === row.end)
            return <td key={day} className="border-t p-1 text-center">
              {slot ? <Input type="number" min={0} step={1} className="text-center" aria-label={`${LABELS[day]} ${row.start}–${row.end}`} value={slot.employees} onChange={(e) => setEmployees(day, row.start, Number(e.target.value))} /> : <span className="text-muted-foreground">—</span>}
            </td>
          })}
        </tr>)}
      </tbody>
    </table>
  </div>
}
function Competencies({ sector, update }: { sector: SectorDemandConfiguration; update: (sector: SectorDemandConfiguration) => void }) { const [name, setName] = useState(""); const sorted = [...sector.competencies].sort((a, b) => a.order - b.order); const add = () => { if (!name.trim()) return; update({ ...sector, competencies: [...sector.competencies, { id: `competency_${crypto.randomUUID()}`, name: name.trim(), archived: false, order: sector.competencies.length }] }); setName("") }; const mutate = (id: string, patch: object) => update({ ...sector, competencies: sector.competencies.map((item) => item.id === id ? { ...item, ...patch } : item) }); return <Section title="Compétences du secteur" description="Créez uniquement les savoir-faire métier. L’ouverture, la fermeture et les coupures restent des contraintes."><div className="flex gap-2"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nom de la compétence" /><Button type="button" onClick={add}><Plus />Ajouter</Button></div>{sorted.length === 0 ? <Empty text="Aucune compétence. Elles restent facultatives pour la préparation du planning." /> : sorted.map((item, index) => <div key={item.id} className="flex items-center gap-2"><Input value={item.name} disabled={item.archived} onChange={(e) => mutate(item.id, { name: e.target.value })} /><Button size="icon" variant="outline" disabled={index === 0} onClick={() => reorder(sector, index, -1, update)}><ArrowUp /></Button><Button size="icon" variant="outline" disabled={index === sorted.length - 1} onClick={() => reorder(sector, index, 1, update)}><ArrowDown /></Button><Button size="icon" variant="outline" onClick={() => mutate(item.id, { archived: !item.archived })}><Archive /></Button></div>)}</Section> }
function reorder(sector: SectorDemandConfiguration, index: number, delta: number, update: (sector: SectorDemandConfiguration) => void) { const sorted = [...sector.competencies].sort((a, b) => a.order - b.order), target = index + delta; if (!sorted[target]) return; [sorted[index], sorted[target]] = [sorted[target], sorted[index]]; update({ ...sector, competencies: sorted.map((item, order) => ({ ...item, order })) }) }
function sumDistribution(sector: SectorDemandConfiguration) { return WEEK_DAYS.reduce((sum, day) => sum + (sector.weeklyDistribution[day] || 0), 0) }
function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) { return <Card><CardHeader><CardTitle className="text-base">{title}</CardTitle>{description ? <p className="text-sm text-muted-foreground">{description}</p> : null}</CardHeader><CardContent className="space-y-4">{children}</CardContent></Card> }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="space-y-2 text-sm"><span className="font-medium">{label}</span>{children}</label> }
function Empty({ text }: { text: string }) { return <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">{text}</p> }
