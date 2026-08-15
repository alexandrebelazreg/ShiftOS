"use client"

import {
  Check,
  Clock3,
  Link2,
  Loader2,
  Lock,
  Palmtree,
  Plus,
  Printer,
  Sparkles,
  Trash2,
  Unlock,
} from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { PageHeader } from "@/components/layout/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { employeeService } from "@/features/employees/services/employee.service"
import type { EmployeeRecord } from "@/features/employees/types/employee.types"
import {
  campaignWeeks,
  defaultPeriod,
  type PaidLeaveCampaignWeek,
} from "@/features/paid-leave/calendar/campaign-weeks"
import {
  calculatePaidLeaveCoverage,
  type PaidLeaveCoverageSummary,
} from "@/features/paid-leave/coverage/paid-leave-coverage"
import {
  campaignWeekIds,
  createPaidLeaveCampaign,
  effectiveRequestedWeeks,
  linkPriorityEmployees,
  preferenceRank,
  synchronizePaidLeaveCampaign,
  togglePaidLeaveWish,
  wishPlanSizes,
  wishPlansDisagree,
} from "@/features/paid-leave/domain/campaign"
import {
  describePaidLeaveOutcome,
  paidLeaveGenerationWarnings,
} from "@/features/paid-leave/domain/generation-report"
import {
  unlockPaidLeaveCampaign,
  validatePaidLeaveCampaign,
} from "@/features/paid-leave/domain/validation"
import type {
  PaidLeaveCampaign,
  PaidLeavePeriod,
  PaidLeavePeriodKind,
  PaidLeaveRequest,
  PaidLeaveWeekId,
} from "@/features/paid-leave/models/paid-leave-campaign"
import { createPaidLeaveRepository } from "@/features/paid-leave/persistence/paid-leave-repository"
import { applyOptimalPaidLeaveSolution } from "@/features/paid-leave/solver/apply-solution"
import {
  buildPaidLeaveSolveRequest,
  isOptimalPaidLeaveResponse,
  solvePaidLeaveCampaign,
} from "@/features/paid-leave/solver/paid-leave-solver-contract"
import {
  createSectorRepository,
  type SectorDemandConfiguration,
} from "@/features/sectors"
import { cn } from "@/lib/utils"

const selectClassName = "h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus:border-ring focus:ring-3 focus:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"

export function PaidLeavePlanningView() {
  const [employees, setEmployees] = useState<EmployeeRecord[]>([])
  const [sectors, setSectors] = useState<SectorDemandConfiguration[]>([])
  const [campaigns, setCampaigns] = useState<PaidLeaveCampaign[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [creationYear, setCreationYear] = useState(new Date().getFullYear())
  const [creationKind, setCreationKind] = useState<PaidLeavePeriodKind>("summer")
  const [solveStartedAt, setSolveStartedAt] = useState<number | null>(null)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [solveMessage, setSolveMessage] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    async function load() {
      const loadedEmployees = await employeeService.list()
      if (!active) return
      const loadedSectors = createSectorRepository(window.localStorage).list()
      const repository = createPaidLeaveRepository(window.localStorage)
      const stored = repository.list()
      const synchronized = stored.map((campaign) =>
        synchronizePaidLeaveCampaign(campaign, loadedEmployees, loadedSectors, stored)
      )
      synchronized.forEach((campaign) => repository.save(campaign))
      const requestedId = repository.activeId()
      setEmployees(loadedEmployees)
      setSectors(loadedSectors)
      setCampaigns(synchronized)
      setActiveId(
        requestedId && synchronized.some((campaign) => campaign.id === requestedId)
          ? requestedId
          : synchronized[0]?.id ?? null
      )
      setLoaded(true)
    }
    void load()
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (solveStartedAt === null) return
    const update = () => setElapsedSeconds(Math.min(60, Math.floor((Date.now() - solveStartedAt) / 1000)))
    update()
    const timer = window.setInterval(update, 250)
    return () => window.clearInterval(timer)
  }, [solveStartedAt])

  const campaign = campaigns.find((item) => item.id === activeId) ?? null
  const weeks = useMemo(
    () => campaign ? campaignWeeks(campaign.year, campaign.period) : [],
    [campaign]
  )
  const activeEmployees = useMemo(
    () => employees.filter((employee) => employee.status === "active"),
    [employees]
  )
  const activeSectors = useMemo(
    () => sectors.filter((sector) => sector.status === "active"),
    [sectors]
  )

  const saveCampaign = (next: PaidLeaveCampaign) => {
    createPaidLeaveRepository(window.localStorage).save(next)
    setCampaigns((current) =>
      [next, ...current.filter((item) => item.id !== next.id)]
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    )
  }

  const updateCampaign = (update: (current: PaidLeaveCampaign) => PaidLeaveCampaign) => {
    if (!campaign || campaign.status === "validated") return
    saveCampaign(update(campaign))
  }

  const createCampaign = () => {
    const now = new Date().toISOString()
    const next = createPaidLeaveCampaign({
      id: `leave_${crypto.randomUUID()}`,
      year: creationYear,
      kind: creationKind,
      employees,
      sectors,
      previousCampaigns: campaigns,
      now,
    })
    saveCampaign(next)
    createPaidLeaveRepository(window.localStorage).setActiveId(next.id)
    setActiveId(next.id)
  }

  const chooseCampaign = (id: string) => {
    createPaidLeaveRepository(window.localStorage).setActiveId(id)
    setActiveId(id)
    setSolveMessage(null)
  }

  const runSolver = async () => {
    if (!campaign || solveStartedAt !== null) return
    setSolveMessage(null)
    setElapsedSeconds(0)
    setSolveStartedAt(Date.now())
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), 60_000)
    const response = await solvePaidLeaveCampaign(
      buildPaidLeaveSolveRequest({ campaign, employees, sectors, timeoutSeconds: 60 }),
      controller.signal
    )
    window.clearTimeout(timer)
    setSolveStartedAt(null)
    if (isOptimalPaidLeaveResponse(response)) {
      const applied = applyOptimalPaidLeaveSolution(campaign, response, new Date().toISOString())
      saveCampaign(applied)
      // Ce que le calcul a RÉELLEMENT produit, et non sa durée. L'optimum d'un
      // problème où personne ne demande rien est l'ensemble vide, et l'annoncer
      // comme une réussite envoyait chercher ailleurs un défaut qui était là.
      setSolveMessage(
        describePaidLeaveOutcome({
          campaign: applied,
          employees,
          sectors,
          weekIds: campaignWeekIds(applied),
          durationMs: response.durationMs,
        }).message
      )
      return
    }
    setSolveMessage(
      response.status === "infeasible"
        ? "Aucune attribution ne respecte toutes les limites. Ajustez les minima, la tolérance ou les renforts."
        : response.status === "non_optimal"
          ? "Le calcul n’a pas prouvé l’optimalité dans les 60 secondes. Aucune attribution n’a été appliquée."
          : response.message === "This operation was aborted"
            ? "Le calcul a atteint la limite de 60 secondes. Aucune attribution n’a été appliquée."
            : response.message
    )
  }

  if (!loaded) {
    return (
      <div className="flex min-h-64 items-center justify-center gap-3 text-sm text-muted-foreground">
        <Loader2 className="size-5 animate-spin" /> Chargement du module Congés payés…
      </div>
    )
  }

  return (
    <div className="space-y-6 print:space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-4 print:hidden">
        <PageHeader
          title="Congés payés"
          description="RH / Planning · Préparez, arbitrez puis validez les semaines de congés de l’équipe."
        />
        <Badge variant="secondary"><Lock className="size-3" /> Accès manager</Badge>
      </div>

      <CampaignToolbar
        campaigns={campaigns}
        activeId={activeId}
        creationYear={creationYear}
        creationKind={creationKind}
        onChoose={chooseCampaign}
        onYearChange={setCreationYear}
        onKindChange={setCreationKind}
        onCreate={createCampaign}
      />

      {!campaign ? (
        <EmptyCampaign employees={activeEmployees} sectors={activeSectors} />
      ) : (
        <CampaignWorkspace
          campaign={campaign}
          weeks={weeks}
          employees={activeEmployees}
          sectors={activeSectors}
          solveStartedAt={solveStartedAt}
          elapsedSeconds={elapsedSeconds}
          solveMessage={solveMessage}
          onUpdate={updateCampaign}
          onSave={saveCampaign}
          onSolve={runSolver}
        />
      )}
    </div>
  )
}

function CampaignToolbar({
  campaigns,
  activeId,
  creationYear,
  creationKind,
  onChoose,
  onYearChange,
  onKindChange,
  onCreate,
}: {
  readonly campaigns: readonly PaidLeaveCampaign[]
  readonly activeId: string | null
  readonly creationYear: number
  readonly creationKind: PaidLeavePeriodKind
  readonly onChoose: (id: string) => void
  readonly onYearChange: (year: number) => void
  readonly onKindChange: (kind: PaidLeavePeriodKind) => void
  readonly onCreate: () => void
}) {
  return (
    <Card className="print:hidden">
      <CardContent className="flex flex-wrap items-end gap-3">
        <Field label="Campagne ouverte" className="min-w-52 flex-1">
          <select className={selectClassName} value={activeId ?? ""} onChange={(event) => onChoose(event.target.value)}>
            {campaigns.length === 0 ? <option value="">Aucune campagne</option> : null}
            {campaigns.map((campaign) => (
              <option key={campaign.id} value={campaign.id}>
                {campaign.name} · {campaign.status === "validated" ? "validée" : "en préparation"}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Nouvelle période" className="w-48">
          <select className={selectClassName} value={creationKind} onChange={(event) => onKindChange(event.target.value as PaidLeavePeriodKind)}>
            <option value="summer">Été · S18 à S43</option>
            <option value="winter">Hiver · S44 à S17</option>
            <option value="custom">Personnalisée</option>
          </select>
        </Field>
        <Field label="Année de départ" className="w-32">
          <Input type="number" min={2020} max={2100} value={creationYear} onChange={(event) => onYearChange(Number(event.target.value))} />
        </Field>
        <Button onClick={onCreate}><Plus /> Créer</Button>
      </CardContent>
    </Card>
  )
}

function EmptyCampaign({ employees, sectors }: { readonly employees: readonly EmployeeRecord[]; readonly sectors: readonly SectorDemandConfiguration[] }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <Palmtree className="size-8 text-muted-foreground" />
        <p className="font-medium">Créez la première campagne de congés payés</p>
        <p className="max-w-xl text-sm text-muted-foreground">
          {employees.length} personne{employees.length === 1 ? "" : "s"} active{employees.length === 1 ? "" : "s"} et {sectors.length} secteur{sectors.length === 1 ? "" : "s"} seront repris depuis ShiftOS.
        </p>
      </CardContent>
    </Card>
  )
}

function CampaignWorkspace({
  campaign,
  weeks,
  employees,
  sectors,
  solveStartedAt,
  elapsedSeconds,
  solveMessage,
  onUpdate,
  onSave,
  onSolve,
}: {
  readonly campaign: PaidLeaveCampaign
  readonly weeks: readonly PaidLeaveCampaignWeek[]
  readonly employees: readonly EmployeeRecord[]
  readonly sectors: readonly SectorDemandConfiguration[]
  readonly solveStartedAt: number | null
  readonly elapsedSeconds: number
  readonly solveMessage: string | null
  readonly onUpdate: (update: (campaign: PaidLeaveCampaign) => PaidLeaveCampaign) => void
  readonly onSave: (campaign: PaidLeaveCampaign) => void
  readonly onSolve: () => void
}) {
  const locked = campaign.status === "validated"
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">{campaign.name}</h2>
          <p className="text-sm text-muted-foreground">{weeks[0]?.rangeLabel} à {weeks.at(-1)?.rangeLabel} · {weeks.length} semaines</p>
        </div>
        <Badge variant={locked ? "default" : "outline"}>
          {locked ? <Check /> : <Clock3 />}{locked ? " Validée et verrouillée" : " En préparation"}
        </Badge>
      </div>

      {locked ? (
        <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950 print:hidden dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100">
          <Lock className="size-5 shrink-0" />
          Le tableau de bord utilise la version validée du {formatDateTime(campaign.validatedSnapshot?.validatedAt)}. Déverrouillez pour préparer une modification ; l’ancienne version restera affichée jusqu’à la prochaine validation.
        </div>
      ) : null}

      <Tabs defaultValue="configuration">
        <TabsList variant="line" className="w-full justify-start overflow-x-auto print:hidden">
          <TabsTrigger value="configuration">1. Configuration</TabsTrigger>
          <TabsTrigger value="employees">2. Employés</TabsTrigger>
          <TabsTrigger value="wishes">3. Vœux</TabsTrigger>
          <TabsTrigger value="validation">4. Validation</TabsTrigger>
        </TabsList>
        <TabsContent value="configuration">
          <ConfigurationTab campaign={campaign} weeks={weeks} sectors={sectors} locked={locked} onUpdate={onUpdate} />
        </TabsContent>
        <TabsContent value="employees">
          <EmployeesTab campaign={campaign} employees={employees} sectors={sectors} locked={locked} onUpdate={onUpdate} />
        </TabsContent>
        <TabsContent value="wishes">
          <WishesTab campaign={campaign} weeks={weeks} employees={employees} sectors={sectors} locked={locked} onUpdate={onUpdate} />
        </TabsContent>
        <TabsContent value="validation">
          <ValidationTab
            campaign={campaign}
            weeks={weeks}
            employees={employees}
            sectors={sectors}
            locked={locked}
            solveStartedAt={solveStartedAt}
            elapsedSeconds={elapsedSeconds}
            solveMessage={solveMessage}
            onUpdate={onUpdate}
            onSave={onSave}
            onSolve={onSolve}
          />
        </TabsContent>
      </Tabs>
    </>
  )
}

function ConfigurationTab({ campaign, weeks, sectors, locked, onUpdate }: TabProps & { readonly weeks: readonly PaidLeaveCampaignWeek[] }) {
  const updatePeriod = (period: PaidLeavePeriod) => onUpdate((current) => invalidateCampaign({ ...current, period }))
  return (
    <div className="space-y-5 pt-4">
      <Card>
        <CardHeader>
          <CardTitle>Période de la campagne</CardTitle>
          <CardDescription>Les périodes été et hiver suivent automatiquement les semaines ISO prévues.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <Field label="Type de période">
            <select disabled={locked} className={selectClassName} value={campaign.period.kind} onChange={(event) => updatePeriod(defaultPeriod(event.target.value as PaidLeavePeriodKind))}>
              <option value="summer">Été · S18 à S43</option>
              <option value="winter">Hiver · S44 à S17</option>
              <option value="custom">Personnalisée</option>
            </select>
          </Field>
          {campaign.period.kind === "custom" ? (
            <>
              <Field label="Semaine de début"><Input disabled={locked} type="number" min={1} max={53} value={campaign.period.startWeek} onChange={(event) => updatePeriod({ ...campaign.period, startWeek: clampWeek(event.target.value) })} /></Field>
              <Field label="Semaine de fin"><Input disabled={locked} type="number" min={1} max={53} value={campaign.period.endWeek} onChange={(event) => updatePeriod({ ...campaign.period, endWeek: clampWeek(event.target.value) })} /></Field>
            </>
          ) : (
            <div className="sm:col-span-2 rounded-lg bg-muted/60 p-3 text-sm text-muted-foreground">
              {weeks[0]?.shortLabel} · {weeks[0]?.rangeLabel} → {weeks.at(-1)?.shortLabel} · {weeks.at(-1)?.rangeLabel}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Couverture minimale par secteur</CardTitle>
          <CardDescription>Vert : minimum atteint. Orange : déficit toléré. Rouge : limite interdite.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {sectors.map((sector) => (
            <CoverageRuleGrid key={sector.id} campaign={campaign} weeks={weeks} sector={sector} locked={locked} onUpdate={onUpdate} />
          ))}
          {sectors.length === 0 ? <EmptyLine>Configurez au moins un secteur actif dans ShiftOS.</EmptyLine> : null}
        </CardContent>
      </Card>

      <ReinforcementPools campaign={campaign} weeks={weeks} sectors={sectors} locked={locked} onUpdate={onUpdate} />
    </div>
  )
}

function CoverageRuleGrid({ campaign, weeks, sector, locked, onUpdate }: { readonly campaign: PaidLeaveCampaign; readonly weeks: readonly PaidLeaveCampaignWeek[]; readonly sector: SectorDemandConfiguration; readonly locked: boolean; readonly onUpdate: TabProps["onUpdate"] }) {
  const firstRule = campaign.coverage[sector.id]?.[weeks[0]?.id]
  const applyAll = (minimumHours: number, toleratedDeficitHours: number) => onUpdate((current) => invalidateCampaign({
    ...current,
    coverage: {
      ...current.coverage,
      [sector.id]: Object.fromEntries(weeks.map((week) => [week.id, { minimumHours, toleratedDeficitHours }])),
    },
  }))
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="font-medium">{sector.name}</h3>
          <p className="text-xs text-muted-foreground">Saisissez le nombre d’heures hebdomadaires qui doivent rester disponibles.</p>
        </div>
        <div className="grid w-full grid-cols-2 items-end gap-2 sm:w-auto sm:grid-cols-[8rem_8rem_auto]">
          <Field label="Minimum commun"><Input id={`minimum-${sector.id}`} disabled={locked} type="number" min={0} step={0.5} defaultValue={firstRule?.minimumHours ?? 0} /></Field>
          <Field label="Marge orange"><Input id={`margin-${sector.id}`} disabled={locked} type="number" min={0} step={0.5} defaultValue={firstRule?.toleratedDeficitHours ?? 0} /></Field>
          <Button className="col-span-2 sm:col-span-1" disabled={locked} variant="outline" onClick={() => {
            const minimum = numberFromInput(`minimum-${sector.id}`)
            const margin = numberFromInput(`margin-${sector.id}`)
            applyAll(minimum, margin)
          }}>Appliquer partout</Button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        {weeks.map((week) => {
          const rule = campaign.coverage[sector.id]?.[week.id] ?? { minimumHours: 0, toleratedDeficitHours: 0 }
          return (
            <div key={week.id} className="min-w-0 rounded-lg border bg-muted/20 p-2">
              <div className="mb-2 min-w-0">
                <p className="text-xs font-semibold">{week.shortLabel}</p>
                <p className="truncate text-[10px] text-muted-foreground" title={week.rangeLabel}>{week.rangeLabel}</p>
              </div>
              <div className="grid grid-cols-2 gap-1">
                <label className="grid gap-0.5 text-[10px] text-muted-foreground">
                  Minimum
                  <Input aria-label={`Minimum ${sector.name} ${week.shortLabel}`} disabled={locked} className="h-7 px-1.5 text-xs" type="number" min={0} step={0.5} value={rule.minimumHours} onChange={(event) => updateCoverageRule(onUpdate, sector.id, week.id, Number(event.target.value), rule.toleratedDeficitHours)} />
                </label>
                <label className="grid gap-0.5 text-[10px] text-muted-foreground">
                  Marge
                  <Input aria-label={`Tolérance ${sector.name} ${week.shortLabel}`} disabled={locked} className="h-7 px-1.5 text-xs" type="number" min={0} step={0.5} value={rule.toleratedDeficitHours} onChange={(event) => updateCoverageRule(onUpdate, sector.id, week.id, rule.minimumHours, Number(event.target.value))} />
                </label>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function ReinforcementPools({ campaign, weeks, sectors, locked, onUpdate }: { readonly campaign: PaidLeaveCampaign; readonly weeks: readonly PaidLeaveCampaignWeek[]; readonly sectors: readonly SectorDemandConfiguration[]; readonly locked: boolean; readonly onUpdate: TabProps["onUpdate"] }) {
  const [label, setLabel] = useState("Renfort saisonnier")
  const [hours, setHours] = useState(0)
  const [scope, setScope] = useState<"global" | "sector">("global")
  const [sectorId, setSectorId] = useState(sectors[0]?.id ?? "")
  const [startWeekId, setStartWeekId] = useState<PaidLeaveWeekId | "">(weeks[0]?.id ?? "")
  const [endWeekId, setEndWeekId] = useState<PaidLeaveWeekId | "">(weeks.at(-1)?.id ?? "")
  const effectiveStartWeekId = weeks.some((week) => week.id === startWeekId)
    ? startWeekId
    : weeks[0]?.id ?? ""
  const effectiveEndWeekId = weeks.some((week) => week.id === endWeekId)
    ? endWeekId
    : weeks.at(-1)?.id ?? ""
  const add = () => {
    if (!effectiveStartWeekId || !effectiveEndWeekId || hours <= 0 || (scope === "sector" && !sectorId)) return
    const [normalizedStartWeekId, normalizedEndWeekId] =
      effectiveStartWeekId <= effectiveEndWeekId
        ? [effectiveStartWeekId, effectiveEndWeekId]
        : [effectiveEndWeekId, effectiveStartWeekId]
    onUpdate((current) => invalidateCampaign({
      ...current,
      reinforcementPools: [...current.reinforcementPools, {
        id: `pool_${crypto.randomUUID()}`,
        label: label.trim() || "Renfort",
        totalHours: hours,
        startWeekId: normalizedStartWeekId,
        endWeekId: normalizedEndWeekId,
        scope,
        sectorId: scope === "sector" ? sectorId : null,
      }],
    }))
    setHours(0)
  }
  return (
    <Card>
      <CardHeader><CardTitle>Réserve d’heures de renfort</CardTitle><CardDescription>CDD saisonnier et avenant alimentent la même réserve. Le calcul les place librement, sans obligation de tout utiliser.</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-6">
          <Field label="Libellé" className="md:col-span-2"><Input disabled={locked} value={label} onChange={(event) => setLabel(event.target.value)} /></Field>
          <Field label="Heures"><Input disabled={locked} type="number" min={0} step={1} value={hours} onChange={(event) => setHours(Number(event.target.value))} /></Field>
          <Field label="Portée"><select disabled={locked} className={selectClassName} value={scope} onChange={(event) => setScope(event.target.value as "global" | "sector")}><option value="global">Globale</option><option value="sector">Un secteur</option></select></Field>
          {scope === "sector" ? <Field label="Secteur"><select disabled={locked} className={selectClassName} value={sectorId} onChange={(event) => setSectorId(event.target.value)}>{sectors.map((sector) => <option key={sector.id} value={sector.id}>{sector.name}</option>)}</select></Field> : <div />}
          <div className="flex items-end"><Button disabled={locked || hours <= 0} className="w-full" onClick={add}><Plus /> Ajouter</Button></div>
          <Field label="De"><WeekSelect disabled={locked} weeks={weeks} value={effectiveStartWeekId} onChange={(value) => setStartWeekId(value)} /></Field>
          <Field label="À"><WeekSelect disabled={locked} weeks={weeks} value={effectiveEndWeekId} onChange={(value) => setEndWeekId(value)} /></Field>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {campaign.reinforcementPools.map((pool) => (
            <div key={pool.id} className="flex items-start justify-between gap-3 rounded-lg border p-3">
              <div><p className="font-medium">{pool.label}</p><p className="text-xs text-muted-foreground">{formatHours(pool.totalHours)} · {pool.scope === "global" ? "tous les secteurs" : sectors.find((sector) => sector.id === pool.sectorId)?.name ?? "secteur indisponible"} · {shortWeek(pool.startWeekId)} à {shortWeek(pool.endWeekId)}</p></div>
              <Button aria-label={`Supprimer ${pool.label}`} disabled={locked} size="icon-sm" variant="ghost" onClick={() => onUpdate((current) => invalidateCampaign({ ...current, reinforcementPools: current.reinforcementPools.filter((item) => item.id !== pool.id) }))}><Trash2 /></Button>
            </div>
          ))}
          {campaign.reinforcementPools.length === 0 ? <EmptyLine>Aucune heure supplémentaire prévue.</EmptyLine> : null}
        </div>
      </CardContent>
    </Card>
  )
}

function EmployeesTab({ campaign, employees, sectors, locked, onUpdate }: EmployeeTabProps) {
  return (
    <div className="space-y-3 pt-4">
      <Card size="sm"><CardHeader><CardTitle>Paramètres des employés</CardTitle><CardDescription>Le premier secteur ShiftOS est le secteur principal. « Prioritaire » est indépendant du lien entre deux personnes ; le lien reste réciproque.</CardDescription></CardHeader></Card>
      {groupEmployees(employees, sectors).map(({ sectorName, employees: team }) => (
        <Card key={sectorName} size="sm">
          <CardHeader className="flex-row items-center justify-between"><CardTitle>{sectorName}</CardTitle><CardDescription>{team.length} personne{team.length === 1 ? "" : "s"}</CardDescription></CardHeader>
          <CardContent className="space-y-2">
            {team.map((employee) => {
              const settings = campaign.employeeSettings[employee.id]
              const linkedName = employeeName(employees.find((item) => item.id === settings?.linkedEmployeeId))
              return (
                <div key={employee.id} className="grid gap-2 rounded-lg border p-2 sm:grid-cols-2 xl:grid-cols-[minmax(11rem,1.2fr)_auto_9.5rem_7.5rem_minmax(10rem,1fr)] xl:items-end">
                  <div className="min-w-0 sm:col-span-2 xl:col-span-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="truncate font-medium">{employeeName(employee)}</p>
                      {settings?.linkedEmployeeId ? <Badge variant="outline"><Link2 /> {linkedName}</Badge> : null}
                    </div>
                    <p className="text-xs text-muted-foreground">{formatHours(contractHours(employee))} / semaine</p>
                  </div>
                  <label className="flex h-8 items-center gap-2 rounded-lg border px-2 text-xs font-medium">
                    <input
                      aria-label={`Prioritaire — ${employeeName(employee)}`}
                      checked={settings?.priority ?? false}
                      className="size-4 accent-primary"
                      disabled={locked}
                      type="checkbox"
                      onChange={(event) => updateEmployeeSettings(onUpdate, employee.id, { priority: event.target.checked })}
                    />
                    Prioritaire
                  </label>
                  <Field label="Date d’entrée"><Input disabled={locked} type="date" value={settings?.entryDate ?? ""} onChange={(event) => updateEmployeeSettings(onUpdate, employee.id, { entryDate: event.target.value })} /></Field>
                  <Field label="Vœux 1 obtenus"><Input disabled={locked} type="number" min={0} step={1} value={settings?.firstChoiceHistory ?? 0} onChange={(event) => updateEmployeeSettings(onUpdate, employee.id, { firstChoiceHistory: Math.max(0, Math.round(Number(event.target.value))) })} /></Field>
                  <Field label="Personne liée"><select disabled={locked} className={selectClassName} value={settings?.linkedEmployeeId ?? ""} onChange={(event) => onUpdate((current) => invalidateCampaign({ ...current, employeeSettings: linkPriorityEmployees(current.employeeSettings, employee.id, event.target.value || null) }))}><option value="">Aucune</option>{employees.filter((item) => item.id !== employee.id).map((item) => <option key={item.id} value={item.id}>{employeeName(item)}</option>)}</select></Field>
                  </div>
              )
            })}
          </CardContent>
        </Card>
      ))}
      {employees.length === 0 ? <EmptyLine>Aucun employé actif.</EmptyLine> : null}
    </div>
  )
}

function WishesTab({ campaign, weeks, employees, sectors, locked, onUpdate }: EmployeeTabProps & { readonly weeks: readonly PaidLeaveCampaignWeek[] }) {
  const weekIds = campaignWeekIds(campaign)
  return (
    <div className="space-y-3 pt-4">
      <Card size="sm"><CardHeader><CardTitle>Vœux de congés</CardTitle><CardDescription>Chaque vœu est un plan complet de la même absence : cochez le <strong>même nombre de semaines</strong> dans Vœu 1, Vœu 2 et Vœu 3. Ce nombre est celui qui sera attribué — il n’y a rien d’autre à saisir.</CardDescription></CardHeader></Card>
      {groupEmployees(employees, sectors).map(({ sectorName, employees: team }) => (
        <Card key={sectorName} size="sm">
          <CardHeader><CardTitle>{sectorName}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {team.map((employee) => {
              const request = campaign.requests[employee.id]
              const effective = effectiveRequestedWeeks(request, weekIds)
              const sizes = wishPlanSizes(request, weekIds)
              const disagrees = wishPlansDisagree(request, weekIds)
              return (
                <section key={employee.id} className="space-y-2 rounded-lg border p-2.5">
                  {/* Plus de champ à remplir : le nombre de semaines dues se
                      LIT dans les vœux. Il ne reste qu'à le montrer, et à
                      signaler quand les rangs ne décrivent pas la même absence. */}
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="font-medium">{employeeName(employee)}</h3>
                    <p className={cn("text-xs", disagrees ? "font-medium text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>
                      {effective === 0
                        ? "Aucune semaine demandée"
                        : `${effective} semaine${effective > 1 ? "s" : ""} demandée${effective > 1 ? "s" : ""}`}
                      {disagrees ? ` · vœux inégaux (${sizes.filter((size) => size > 0).join(" / ")})` : null}
                    </p>
                  </div>
                  <WishWeekGrid employee={employee} request={request} weeks={weeks} disabled={locked} onToggle={(rank, weekId) => toggleWish(onUpdate, employee.id, rank, weekId)} />
                </section>
              )
            })}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function WishWeekGrid({ employee, request, weeks, disabled, onToggle }: { readonly employee: EmployeeRecord; readonly request: PaidLeaveRequest | undefined; readonly weeks: readonly PaidLeaveCampaignWeek[]; readonly disabled: boolean; readonly onToggle: (rank: 1 | 2 | 3, weekId: PaidLeaveWeekId) => void }) {
  return (
    <div className="space-y-1.5">
      {([1, 2, 3] as const).map((rank) => (
        <div key={rank} className="grid gap-1.5 rounded-lg border bg-muted/20 p-1.5 sm:grid-cols-[4.5rem_1fr] sm:items-center">
          <p className={cn(
            "rounded-md px-2 py-1 text-center text-xs font-semibold",
            rank === 1 && "bg-emerald-100 text-emerald-800",
            rank === 2 && "bg-amber-100 text-amber-900",
            rank === 3 && "bg-sky-100 text-sky-800"
          )}>Vœu {rank}</p>
          <div className="grid grid-cols-7 gap-1 sm:grid-cols-[repeat(13,minmax(0,1fr))] xl:grid-cols-[repeat(26,minmax(0,1fr))]">
            {weeks.map((week) => {
              const selected = request?.[`wish${rank}`].includes(week.id) ?? false
              return (
                <Button
                  key={week.id}
                  aria-label={`${employeeName(employee)} · ${week.shortLabel} · vœu ${rank}`}
                  aria-pressed={selected}
                  className={cn(
                    "h-7 min-w-0 px-0 text-xs font-semibold",
                    selected && rank === 1 && "border-emerald-700 bg-emerald-600 text-white hover:bg-emerald-700",
                    selected && rank === 2 && "border-amber-700 bg-amber-500 text-amber-950 hover:bg-amber-600",
                    selected && rank === 3 && "border-sky-700 bg-sky-600 text-white hover:bg-sky-700"
                  )}
                  disabled={disabled}
                  size="xs"
                  title={`${week.shortLabel} · ${week.rangeLabel}`}
                  variant="outline"
                  onClick={() => onToggle(rank, week.id)}
                >
                  {week.weekNumber}
                </Button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

function ValidationTab({ campaign, weeks, employees, sectors, locked, solveStartedAt, elapsedSeconds, solveMessage, onUpdate, onSave, onSolve }: EmployeeTabProps & { readonly weeks: readonly PaidLeaveCampaignWeek[]; readonly solveStartedAt: number | null; readonly elapsedSeconds: number; readonly solveMessage: string | null; readonly onSave: (campaign: PaidLeaveCampaign) => void; readonly onSolve: () => void }) {
  const [comparison, setComparison] = useState<"granted" | "wish1">("granted")
  const grants = comparison === "granted" ? campaign.grants : wishOneScenario(campaign, employees)
  const declaredAllocations = comparison === "granted" ? campaign.solution?.reinforcementAllocations : undefined
  const coverage = calculatePaidLeaveCoverage({ campaign, employees, sectors, grants, reinforcementAllocations: declaredAllocations })
  const weekIds = campaignWeekIds(campaign)
  const warnings = paidLeaveGenerationWarnings({ campaign, employees, sectors, weekIds })
  const incomplete = employees.filter((employee) => (campaign.grants[employee.id]?.length ?? 0) !== effectiveRequestedWeeks(campaign.requests[employee.id], weekIds))
  const sectorNames = new Set(sectors.map((sector) => sector.name))
  const withoutPrimarySector = employees.filter(
    (employee) => !employee.sectors?.[0] || !sectorNames.has(employee.sectors[0])
  )
  const canValidate = !locked && sectors.length > 0 && withoutPrimarySector.length === 0 && incomplete.length === 0 && coverage.redCellCount === 0 && solveStartedAt === null

  const validate = () => onSave(validatePaidLeaveCampaign(campaign, new Date().toISOString(), coverage.reinforcementAllocations))
  const unlock = () => onSave(unlockPaidLeaveCampaign(campaign, new Date().toISOString()))
  return (
    <div className="space-y-5 pt-4 print:pt-0">
      <Card className="print:hidden">
        <CardHeader><CardTitle>Calcul et validation globale</CardTitle><CardDescription>Seule une solution mathématiquement optimale est appliquée. La recherche s’arrête au bout de 60 secondes sans remplacer les attributions en cours.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          {solveStartedAt !== null ? (
            <div className="rounded-xl border bg-muted/40 p-4">
              <div className="flex items-center gap-3"><Loader2 className="size-5 animate-spin text-primary" /><div><p className="font-medium">Recherche de la meilleure attribution…</p><p className="text-xs text-muted-foreground">Priorités communes, ancienneté, vœux, couverture et équité · {elapsedSeconds} / 60 s</p></div></div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${Math.max(2, elapsedSeconds / 60 * 100)}%` }} /></div>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Ce qui faussera le calcul, dit AVANT de le lancer : personne
                  ne doit découvrir après soixante secondes que la moitié de
                  l'équipe ne pesait sur aucun minimum. Des avertissements et
                  non un blocage — on peut vouloir une proposition pendant que
                  deux fiches restent à compléter. */}
              {warnings.length > 0 ? (
                <ul className="space-y-1 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                  {warnings.map((warning) => (
                    <li key={warning.kind}>{warning.message}</li>
                  ))}
                </ul>
              ) : null}
              <div className="flex flex-wrap items-center gap-3"><Button disabled={locked} onClick={onSolve}><Sparkles /> Générer l’attribution optimale</Button>{solveMessage ? <p className="text-sm text-muted-foreground">{solveMessage}</p> : null}</div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Attributions par personne</CardTitle><CardDescription>Utilisez les raccourcis de vœux ou ajustez chaque semaine manuellement avant la validation.</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          {employees.map((employee) => <GrantEditor key={employee.id} campaign={campaign} employee={employee} weeks={weeks} locked={locked} onUpdate={onUpdate} />)}
          {employees.length === 0 ? <EmptyLine>Aucun employé actif.</EmptyLine> : null}
        </CardContent>
      </Card>

      <CoverageReport campaign={campaign} coverage={coverage} sectors={sectors} comparison={comparison} onComparison={setComparison} />

      {campaign.solution?.compromises.length ? (
        <Card><CardHeader><CardTitle>Compte rendu des compromis</CardTitle></CardHeader><CardContent className="grid gap-2 md:grid-cols-2">{campaign.solution.compromises.map((item) => <div key={item.employeeId} className="rounded-lg border p-3"><p className="font-medium">{employeeName(employees.find((employee) => employee.id === item.employeeId))}</p><p className="text-xs text-muted-foreground">{item.message}</p></div>)}</CardContent></Card>
      ) : null}

      <Card className="print:hidden">
        <CardContent className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="font-medium">{locked ? "Campagne validée" : canValidate ? "Prête à être validée" : "Validation impossible pour le moment"}</p>
            <p className="text-xs text-muted-foreground">{locked ? `Version du ${formatDateTime(campaign.validatedSnapshot?.validatedAt)}` : sectors.length === 0 ? "Aucun secteur actif n’est configuré." : withoutPrimarySector.length > 0 ? `${withoutPrimarySector.length} personne(s) n’ont pas de secteur principal actif.` : incomplete.length > 0 ? `${incomplete.length} attribution(s) incomplète(s).` : coverage.redCellCount > 0 ? `${coverage.redCellCount} semaine(s) sont encore en rouge.` : "Les attributions et la couverture sont cohérentes."}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => window.print()}><Printer /> Imprimer / enregistrer en PDF</Button>
            {locked ? <Button variant="outline" onClick={unlock}><Unlock /> Déverrouiller</Button> : <Button disabled={!canValidate} onClick={validate}><Check /> Valider globalement</Button>}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function GrantEditor({ campaign, employee, weeks, locked, onUpdate }: { readonly campaign: PaidLeaveCampaign; readonly employee: EmployeeRecord; readonly weeks: readonly PaidLeaveCampaignWeek[]; readonly locked: boolean; readonly onUpdate: TabProps["onUpdate"] }) {
  const request = campaign.requests[employee.id]
  const weekIds = campaignWeekIds(campaign)
  const target = effectiveRequestedWeeks(request, weekIds)
  const granted = campaign.grants[employee.id] ?? []
  return (
    <section className="rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><p className="font-medium">{employeeName(employee)}</p><p className="text-xs text-muted-foreground">{granted.length} / {target} semaine{target === 1 ? "" : "s"} accordée{target === 1 ? "" : "s"}</p></div>
        <div className="flex gap-1 print:hidden">{([1, 2, 3] as const).map((rank) => <Button key={rank} disabled={locked || target === 0} size="xs" variant="outline" onClick={() => setRankGrants(onUpdate, employee.id, request, rank, weekIds)}>Accorder V{rank}</Button>)}</div>
      </div>
      <div className="mt-3 flex gap-1 overflow-x-auto pb-2">
        {weeks.map((week) => {
          const checked = granted.includes(week.id)
          const rank = request ? preferenceRank(request, week.id) : null
          return <Button key={week.id} disabled={locked || (!checked && granted.length >= target)} size="sm" variant={checked ? "default" : "outline"} className={cn("h-auto min-w-20 flex-col py-1", !rank && !checked && "opacity-50")} aria-pressed={checked} onClick={() => toggleGrant(onUpdate, employee.id, week.id, target)}><span>{week.shortLabel}</span><span className="text-[10px] font-normal opacity-75">{rank ? `V${rank}` : "manuel"}</span></Button>
        })}
      </div>
    </section>
  )
}

function CoverageReport({ campaign, coverage, sectors, comparison, onComparison }: { readonly campaign: PaidLeaveCampaign; readonly coverage: PaidLeaveCoverageSummary; readonly sectors: readonly SectorDemandConfiguration[]; readonly comparison: "granted" | "wish1"; readonly onComparison: (value: "granted" | "wish1") => void }) {
  return (
    <Card>
      <CardHeader><CardTitle>Couverture hebdomadaire</CardTitle><CardDescription>Les heures affichées comprennent le renfort placé. Orange reste autorisé ; rouge bloque la validation.</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
          <div className="flex gap-2"><Badge className="bg-emerald-100 text-emerald-800">Vert · minimum atteint</Badge><Badge className="bg-orange-100 text-orange-800">Orange · toléré</Badge><Badge className="bg-red-100 text-red-800">Rouge · interdit</Badge></div>
          <div className="flex rounded-lg bg-muted p-1"><Button size="sm" variant={comparison === "granted" ? "secondary" : "ghost"} onClick={() => onComparison("granted")}>Accordé</Button><Button size="sm" variant={comparison === "wish1" ? "secondary" : "ghost"} onClick={() => onComparison("wish1")}>Tous en V1</Button></div>
        </div>
        {sectors.map((sector) => {
          const cells = coverage.cells.filter((cell) => cell.sectorId === sector.id)
          return <section key={sector.id}><h3 className="mb-2 font-medium">{sector.name}</h3><div className="flex gap-2 overflow-x-auto pb-2">{cells.map((cell) => <div key={cell.weekId} className={cn("min-w-28 rounded-lg border p-2 text-xs", cell.state === "green" && "border-emerald-200 bg-emerald-50 text-emerald-950", cell.state === "orange" && "border-orange-200 bg-orange-50 text-orange-950", cell.state === "red" && "border-red-200 bg-red-50 text-red-950")}><p className="font-medium">{shortWeek(cell.weekId)}</p><p>{formatHours(cell.totalHours)} / {formatHours(cell.minimumHours)}</p>{cell.reinforcementHours > 0 ? <p className="opacity-70">+{formatHours(cell.reinforcementHours)} renfort</p> : null}</div>)}</div></section>
        })}
        {coverage.pools.length > 0 ? <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{coverage.pools.map((pool) => <div key={pool.poolId} className="rounded-lg bg-muted/50 p-3 text-xs"><p className="font-medium">{pool.label}</p><p className="text-muted-foreground">{formatHours(pool.usedHours)} utilisées · {formatHours(pool.remainingHours)} restantes sur {formatHours(pool.totalHours)}</p></div>)}</div> : null}
        <p className="text-xs text-muted-foreground">Vue : {comparison === "granted" ? "semaines accordées" : "simulation si chacun obtenait d’abord ses vœux 1"} · campagne {campaign.name}</p>
      </CardContent>
    </Card>
  )
}

interface TabProps {
  readonly campaign: PaidLeaveCampaign
  readonly sectors: readonly SectorDemandConfiguration[]
  readonly locked: boolean
  readonly onUpdate: (update: (campaign: PaidLeaveCampaign) => PaidLeaveCampaign) => void
}
interface EmployeeTabProps extends TabProps { readonly employees: readonly EmployeeRecord[] }

function updateCoverageRule(onUpdate: TabProps["onUpdate"], sectorId: string, weekId: PaidLeaveWeekId, minimumHours: number, toleratedDeficitHours: number) {
  onUpdate((current) => invalidateCampaign({ ...current, coverage: { ...current.coverage, [sectorId]: { ...current.coverage[sectorId], [weekId]: { minimumHours: positive(minimumHours), toleratedDeficitHours: positive(toleratedDeficitHours) } } } }))
}

function updateEmployeeSettings(onUpdate: TabProps["onUpdate"], employeeId: string, patch: Partial<{ priority: boolean; entryDate: string; firstChoiceHistory: number }>) {
  onUpdate((current) => invalidateCampaign({ ...current, employeeSettings: { ...current.employeeSettings, [employeeId]: { ...current.employeeSettings[employeeId], ...patch } } }))
}

function toggleWish(onUpdate: TabProps["onUpdate"], employeeId: string, rank: 1 | 2 | 3, weekId: PaidLeaveWeekId) {
  onUpdate((current) => {
    const request = current.requests[employeeId]
    return invalidateCampaign({ ...current, requests: { ...current.requests, [employeeId]: togglePaidLeaveWish(request, rank, weekId) } })
  })
}

function setRankGrants(onUpdate: TabProps["onUpdate"], employeeId: string, request: PaidLeaveRequest | undefined, rank: 1 | 2 | 3, weekIds: ReadonlySet<PaidLeaveWeekId>) {
  if (!request) return
  const target = effectiveRequestedWeeks(request, weekIds)
  const choices = request[`wish${rank}`]
  onUpdate((current) => ({ ...current, grants: { ...current.grants, [employeeId]: choices.slice(0, target) }, solution: null, updatedAt: new Date().toISOString() }))
}

function toggleGrant(onUpdate: TabProps["onUpdate"], employeeId: string, weekId: PaidLeaveWeekId, target: number) {
  onUpdate((current) => {
    const granted = current.grants[employeeId] ?? []
    const next = granted.includes(weekId) ? granted.filter((item) => item !== weekId) : granted.length < target ? [...granted, weekId].sort() : granted
    return { ...current, grants: { ...current.grants, [employeeId]: next }, solution: null, updatedAt: new Date().toISOString() }
  })
}

function wishOneScenario(campaign: PaidLeaveCampaign, employees: readonly EmployeeRecord[]): Readonly<Record<string, readonly PaidLeaveWeekId[]>> {
  const weekIds = campaignWeekIds(campaign)
  return Object.fromEntries(employees.map((employee) => {
    const request = campaign.requests[employee.id]
    return [employee.id, request ? request.wish1.slice(0, effectiveRequestedWeeks(request, weekIds)) : []]
  }))
}

function invalidateCampaign(campaign: PaidLeaveCampaign): PaidLeaveCampaign {
  return { ...campaign, grants: {}, solution: null, updatedAt: new Date().toISOString() }
}

function groupEmployees(employees: readonly EmployeeRecord[], sectors: readonly SectorDemandConfiguration[]) {
  const known = sectors.map((sector) => ({ sectorName: sector.name, employees: employees.filter((employee) => employee.sectors?.[0] === sector.name) })).filter((group) => group.employees.length > 0)
  const names = new Set(sectors.map((sector) => sector.name))
  const unassigned = employees.filter((employee) => !employee.sectors?.[0] || !names.has(employee.sectors[0]))
  return unassigned.length > 0 ? [...known, { sectorName: "Sans secteur principal", employees: unassigned }] : known
}

function WeekSelect({ weeks, value, onChange, disabled }: { readonly weeks: readonly PaidLeaveCampaignWeek[]; readonly value: PaidLeaveWeekId | ""; readonly onChange: (value: PaidLeaveWeekId) => void; readonly disabled: boolean }) {
  return <select disabled={disabled} className={selectClassName} value={value} onChange={(event) => onChange(event.target.value as PaidLeaveWeekId)}>{weeks.map((week) => <option key={week.id} value={week.id}>{week.shortLabel} · {week.rangeLabel}</option>)}</select>
}

function Field({ label, className, children }: { readonly label: string; readonly className?: string; readonly children: React.ReactNode }) {
  return <label className={cn("grid gap-1 text-xs font-medium", className)}><span>{label}</span>{children}</label>
}

function EmptyLine({ children }: { readonly children: React.ReactNode }) {
  return <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">{children}</div>
}

function numberFromInput(id: string): number {
  const element = document.getElementById(id) as HTMLInputElement | null
  return positive(Number(element?.value ?? 0))
}

function positive(value: number): number { return Number.isFinite(value) ? Math.max(0, value) : 0 }
function clampWeek(value: string): number { return Math.min(53, Math.max(1, Math.round(Number(value) || 1))) }
function employeeName(employee: EmployeeRecord | undefined): string { return employee ? `${employee.firstName} ${employee.lastName}`.trim() : "Personne indisponible" }
function contractHours(employee: EmployeeRecord): number { return typeof employee.weeklyMinutes === "number" ? employee.weeklyMinutes / 60 : employee.weeklyHours }
function formatHours(hours: number): string { return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(hours)} h` }
function shortWeek(weekId: PaidLeaveWeekId): string { return `S${Number(weekId.slice(-2))}` }
function formatDateTime(value: string | undefined): string { return value ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "date inconnue" }
