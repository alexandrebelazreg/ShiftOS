"use client"

import { Plus, Trash2 } from "lucide-react"

import { WEEK_DAYS, type WeekDay } from "@/features/core/models"
import { SECTOR_RULE_DEFAULTS, type SectorDemandConfiguration, type SectorPresenceRule, type SectorShiftRules } from "@/features/sectors/sector-demand"
import { Empty, Field, Section } from "@/features/sectors/sector-layout"
import { Button } from "@/components/ui/button"
import { CollapsibleSection } from "@/components/ui/collapsible-section"
import { Input } from "@/components/ui/input"

const LABELS: Record<WeekDay, string> = { monday: "Lundi", tuesday: "Mardi", wednesday: "Mercredi", thursday: "Jeudi", friday: "Vendredi", saturday: "Samedi", sunday: "Dimanche" }
const SHORT: Record<WeekDay, string> = { monday: "Lun", tuesday: "Mar", wednesday: "Mer", thursday: "Jeu", friday: "Ven", saturday: "Sam", sunday: "Dim" }

type Update = (sector: SectorDemandConfiguration) => void

/** Minutes → "4 h", "4 h 30", "45 min" — for the default hints only. */
function humanMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours} h` : `${hours} h ${rest}`
}

/**
 * Sector → « Contraintes avancées ».
 *
 * Six folds, all closed, each holding rules the engines have always been able to
 * enforce but that no screen could set. Two of them —
 * `maximumContinuousDuration` and `maximumSplitsPerDay` — reached the solvers as
 * `null` until now, so "ten hours in one block" and "three coupures in a day"
 * were legal by omission rather than by decision.
 *
 * The head-count PROFILE stays where it is, in « Couverture horaire ». What
 * lives here is the other thing: the floor a schedule may be refused over.
 */
export function SectorAdvancedConstraints({ sector, update }: { sector: SectorDemandConfiguration; update: Update }) {
  const rules = sector.shiftRules
  const setRules = (patch: Partial<SectorShiftRules>) => update({ ...sector, shiftRules: { ...rules, ...patch } })

  return (
    <Section
      title="Contraintes avancées"
      description="Les règles que le moteur doit respecter. Elles ne remplacent pas la couverture horaire, qui reste une cible souple."
    >
      <CollapsibleSection title="1 · Couverture opérationnelle" summary={presenceSummary(sector)}>
        <OperationalCoverage sector={sector} update={update} />
      </CollapsibleSection>

      <CollapsibleSection title="2 · Durées et coupures" summary={durationSummary(rules)}>
        <div className="grid gap-4 md:grid-cols-2">
          <MinuteField
            label="Durée minimale d’un shift ou segment"
            value={rules.inheritMinimumShiftDuration ? null : rules.minimumShiftDuration}
            disabled={rules.inheritMinimumShiftDuration}
            hint={rules.inheritMinimumShiftDuration ? "Héritée du magasin." : `Valeur en vigueur : ${humanMinutes(240)}.`}
            onChange={(minimumShiftDuration) => setRules({ minimumShiftDuration })}
          />
          <MinuteField
            label="Durée maximale d’un segment continu"
            value={rules.maximumContinuousDuration}
            hint={`Valeur en vigueur : ${humanMinutes(SECTOR_RULE_DEFAULTS.maximumContinuousDuration)}. Vide = aucune limite.`}
            onChange={(maximumContinuousDuration) => setRules({ maximumContinuousDuration })}
          />
          <MinuteField
            label="Durée maximale travaillée par jour, coupure comprise"
            value={rules.maximumDailyDuration}
            hint={`Valeur en vigueur : ${humanMinutes(SECTOR_RULE_DEFAULTS.maximumDailyDuration)}.`}
            onChange={(value) => setRules({ maximumDailyDuration: value ?? SECTOR_RULE_DEFAULTS.maximumDailyDuration })}
          />
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={rules.splitShiftAllowed}
            onChange={(event) => setRules({ splitShiftAllowed: event.target.checked })}
          />
          Autoriser les shifts avec coupure dans ce secteur
        </label>
        <p className="text-xs text-muted-foreground">
          L’autorisation personnelle reste définie sur chaque salarié : le secteur ouvre la
          possibilité, l’employé en bénéficie ou non.
        </p>

        {rules.splitShiftAllowed ? (
          <div className="grid gap-4 md:grid-cols-3">
            <MinuteField
              label="Coupure minimale"
              value={rules.minimumSplitDuration}
              hint={`Valeur en vigueur : ${humanMinutes(SECTOR_RULE_DEFAULTS.minimumSplitDuration)}. En deçà, c’est une pause.`}
              onChange={(minimumSplitDuration) => setRules({ minimumSplitDuration })}
            />
            <MinuteField
              label="Coupure maximale"
              value={rules.maximumSplitDuration}
              hint={`Valeur en vigueur : ${humanMinutes(SECTOR_RULE_DEFAULTS.maximumSplitDuration)}.`}
              onChange={(maximumSplitDuration) => setRules({ maximumSplitDuration })}
            />
            <CountField
              label="Coupures maximum par salarié et par jour"
              value={rules.maximumSplitsPerDay}
              min={1}
              placeholder="Aucune limite"
              hint={`Valeur en vigueur : ${SECTOR_RULE_DEFAULTS.maximumSplitsPerDay}.`}
              onChange={(maximumSplitsPerDay) => setRules({ maximumSplitsPerDay })}
            />
          </div>
        ) : null}
      </CollapsibleSection>

      <CollapsibleSection title="3 · Ouvertures et fermetures" summary={boundarySummary(rules)}>
        <div className="grid gap-4 md:grid-cols-2">
          <CountField
            label="Ouvertures minimum par jour"
            value={rules.minimumOpeningsPerDay}
            min={0}
            hint="Un minimum : un pic à l’ouverture peut en exiger plusieurs."
            onChange={(value) => setRules({ minimumOpeningsPerDay: value ?? 0 })}
          />
          <CountField
            label="Fermeurs minimum par jour"
            value={rules.requiredClosingsPerDay}
            min={0}
            hint="Un nombre exact : fermer est une responsabilité, pas une couverture."
            onChange={(value) => setRules({ requiredClosingsPerDay: value ?? 0 })}
          />
          <CountField
            label="Ouvertures maximum par salarié et par semaine"
            value={rules.maximumOpeningsPerWeek}
            min={0}
            placeholder="Aucune limite"
            hint="Plafond hérité par défaut."
            onChange={(maximumOpeningsPerWeek) => setRules({ maximumOpeningsPerWeek })}
          />
          <CountField
            label="Fermetures maximum par salarié et par semaine"
            value={rules.maximumClosingsPerWeek}
            min={0}
            placeholder="Aucune limite"
            hint="Plafond hérité par défaut."
            onChange={(maximumClosingsPerWeek) => setRules({ maximumClosingsPerWeek })}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Un plafond défini sur un salarié remplace celui du secteur ; laissé vide, il en hérite.
          Un plafond individuel à 0 interdit totalement.
        </p>
      </CollapsibleSection>

      <CollapsibleSection title="4 · Équité des fermetures" summary={fairnessSummary(sector)}>
        <ClosingFairness sector={sector} update={update} />
      </CollapsibleSection>

      <CollapsibleSection title="5 · Repos et enchaînements" summary={restSummary(rules)}>
        <MinuteField
          label="Repos minimum entre deux journées"
          value={rules.minimumRestMinutes}
          hint={`Valeur en vigueur : ${humanMinutes(SECTOR_RULE_DEFAULTS.minimumRestMinutes)}. Vide = règle du magasin.`}
          onChange={(minimumRestMinutes) => setRules({ minimumRestMinutes })}
        />
      </CollapsibleSection>
    </Section>
  )
}

/** §1 — the floors a schedule may be REFUSED over, as opposed to the target profile. */
function OperationalCoverage({ sector, update }: { sector: SectorDemandConfiguration; update: Update }) {
  const wholeOpening = sector.minimumPresence.find((rule) => rule.days.length === 0 && rule.from === null && rule.to === null)
  const reinforced = sector.minimumPresence.filter((rule) => rule !== wholeOpening)

  const replaceAll = (next: readonly SectorPresenceRule[]) => update({ ...sector, minimumPresence: next })
  const setWholeOpening = (employees: number | null) => {
    const rest = sector.minimumPresence.filter((rule) => rule !== wholeOpening)
    replaceAll(employees === null ? rest : [{ id: wholeOpening?.id ?? `presence_${crypto.randomUUID()}`, days: [], from: null, to: null, employees }, ...rest])
  }
  const mutate = (id: string, patch: Partial<SectorPresenceRule>) =>
    replaceAll(sector.minimumPresence.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)))

  return (
    <>
      <Field label="Minimum de personnes pendant toute l’ouverture">
        <Input
          type="number"
          min={1}
          step={1}
          placeholder="Aucun minimum"
          value={wholeOpening?.employees ?? ""}
          onChange={(event) => setWholeOpening(event.target.value === "" ? null : Number(event.target.value))}
        />
      </Field>
      <p className="text-xs text-muted-foreground">
        Incassable : un planning qui descend en dessous n’est pas moins bon, il est illégal. À
        distinguer du besoin de référence, qui reste une cible souple.
      </p>

      <div className="flex items-center justify-between gap-3 pt-2">
        <p className="text-sm font-medium">Plages de minimum renforcé</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => replaceAll([...sector.minimumPresence, { id: `presence_${crypto.randomUUID()}`, days: [], from: "10:00", to: "18:30", employees: 2 }])}
        >
          <Plus />
          Ajouter une plage
        </Button>
      </div>

      {reinforced.length === 0 ? (
        <Empty text="Aucune plage renforcée. Le minimum ci-dessus s’applique à toute l’ouverture." />
      ) : (
        reinforced.map((rule) => (
          <div key={rule.id} className="grid gap-3 rounded-lg border border-border p-3">
            <div className="flex flex-wrap gap-1">
              {WEEK_DAYS.map((day) => {
                const active = rule.days.includes(day)
                return (
                  <Button
                    key={day}
                    type="button"
                    size="sm"
                    variant={active ? "secondary" : "ghost"}
                    aria-pressed={active}
                    onClick={() => mutate(rule.id, { days: active ? rule.days.filter((entry) => entry !== day) : [...rule.days, day] })}
                  >
                    {SHORT[day]}
                  </Button>
                )
              })}
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
              <Field label="Début">
                <Input type="time" step={900} value={rule.from ?? ""} onChange={(event) => mutate(rule.id, { from: event.target.value === "" ? null : event.target.value })} />
              </Field>
              <Field label="Fin">
                <Input type="time" step={900} value={rule.to ?? ""} onChange={(event) => mutate(rule.id, { to: event.target.value === "" ? null : event.target.value })} />
              </Field>
              <Field label="Minimum">
                <Input type="number" min={1} step={1} value={rule.employees} onChange={(event) => mutate(rule.id, { employees: Number(event.target.value) })} />
              </Field>
              <div className="flex items-end">
                <Button type="button" size="icon" variant="outline" aria-label="Supprimer la plage" onClick={() => replaceAll(sector.minimumPresence.filter((entry) => entry.id !== rule.id))}>
                  <Trash2 />
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {rule.days.length === 0 ? "Tous les jours ouverts." : rule.days.map((day) => LABELS[day]).join(", ")}
              {" · "}
              Heure vide = ouverture ou fermeture du secteur.
            </p>
          </div>
        ))
      )}
    </>
  )
}

/** §4 — soft objectives, ranked below coverage. */
function ClosingFairness({ sector, update }: { sector: SectorDemandConfiguration; update: Update }) {
  const fairness = sector.closingFairness
  const set = (patch: Partial<typeof fairness>) => update({ ...sector, closingFairness: { ...fairness, ...patch } })

  return (
    <>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={fairness.balanceClosings} onChange={(event) => set({ balanceClosings: event.target.checked })} />
        Équilibrer les fermetures entre les semaines
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={fairness.balanceSaturdayClosings} onChange={(event) => set({ balanceSaturdayClosings: event.target.checked })} />
        Équilibrer séparément les fermetures du samedi soir
      </label>
      <Field label="Semaines d’historique">
        <Input type="number" min={1} step={1} value={fairness.lookbackWeeks} onChange={(event) => set({ lookbackWeeks: Number(event.target.value) })} />
      </Field>
      <p className="text-xs text-muted-foreground">
        Objectifs souples : ils passent après les contraintes dures, la couverture et le déficit,
        et ne peuvent jamais les dégrader. À couverture identique, la fermeture revient au salarié
        le moins chargé.
      </p>
      <p className="text-xs text-muted-foreground">
        L’historique est lu par secteur, uniquement sur les plannings publiés ou archivés
        antérieurs à la semaine générée, et compte les occasions réelles de fermer — une absence
        n’avantage donc personne.
      </p>
    </>
  )
}

function MinuteField({ label, value, hint, disabled, onChange }: { label: string; value: number | null; hint?: string; disabled?: boolean; onChange: (value: number | null) => void }) {
  return (
    <div className="space-y-1">
      <Field label={label}>
        <Input
          type="number"
          min={15}
          step={15}
          disabled={disabled}
          placeholder="Aucune limite"
          value={value ?? ""}
          onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))}
        />
      </Field>
      {hint ? <p className="text-xs text-muted-foreground">{hint} Exprimé en minutes.</p> : null}
    </div>
  )
}

function CountField({ label, value, min, hint, placeholder, onChange }: { label: string; value: number | null; min: number; hint?: string; placeholder?: string; onChange: (value: number | null) => void }) {
  return (
    <div className="space-y-1">
      <Field label={label}>
        <Input
          type="number"
          min={min}
          step={1}
          placeholder={placeholder}
          value={value ?? ""}
          onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))}
        />
      </Field>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

function presenceSummary(sector: SectorDemandConfiguration): string[] {
  const whole = sector.minimumPresence.find((rule) => rule.days.length === 0 && rule.from === null && rule.to === null)
  const reinforced = sector.minimumPresence.filter((rule) => rule !== whole)
  const summary: string[] = []
  if (whole) summary.push(`Minimum ${whole.employees} en continu`)
  if (reinforced.length > 0) summary.push(`${reinforced.length} plage${reinforced.length > 1 ? "s" : ""} renforcée${reinforced.length > 1 ? "s" : ""}`)
  return summary
}

function durationSummary(rules: SectorShiftRules): string[] {
  const summary = [`Journée ${humanMinutes(rules.maximumDailyDuration)} max`]
  if (rules.maximumContinuousDuration !== null) summary.push(`Continu ${humanMinutes(rules.maximumContinuousDuration)} max`)
  if (!rules.splitShiftAllowed) summary.push("Coupures interdites")
  else if (rules.minimumSplitDuration !== null && rules.maximumSplitDuration !== null) {
    summary.push(`Coupure ${rules.minimumSplitDuration}–${rules.maximumSplitDuration} min`)
  }
  return summary
}

function boundarySummary(rules: SectorShiftRules): string[] {
  const summary = [`${rules.minimumOpeningsPerDay} ouverture${rules.minimumOpeningsPerDay > 1 ? "s" : ""}/jour min`, `${rules.requiredClosingsPerDay} fermeture${rules.requiredClosingsPerDay > 1 ? "s" : ""}/jour min`]
  if (rules.maximumOpeningsPerWeek !== null) summary.push(`${rules.maximumOpeningsPerWeek} ouvertures/semaine max`)
  if (rules.maximumClosingsPerWeek !== null) summary.push(`${rules.maximumClosingsPerWeek} fermetures/semaine max`)
  return summary
}

function fairnessSummary(sector: SectorDemandConfiguration): string[] {
  const { balanceClosings, balanceSaturdayClosings, lookbackWeeks } = sector.closingFairness
  if (!balanceClosings && !balanceSaturdayClosings) return []
  const summary: string[] = []
  if (balanceClosings) summary.push("Fermetures équilibrées")
  if (balanceSaturdayClosings) summary.push("Samedis équilibrés séparément")
  summary.push(`${lookbackWeeks} semaines d’historique`)
  return summary
}

function restSummary(rules: SectorShiftRules): string[] {
  return rules.minimumRestMinutes === null ? [] : [`Repos ${humanMinutes(rules.minimumRestMinutes)}`]
}
