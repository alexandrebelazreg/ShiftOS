"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { PageHeader } from "@/components/layout/page-header"

import { useEmployees } from "@/features/employees/hooks/useEmployees"
import type { StoreConfig } from "@/features/store/schemas/store.schema"
import {
  preparePlanningGeneration,
  resolveGenerationScope,
  runPlanningFlow,
  selectableSectors,
  type GenerationScope,
  type GenerationScopeVerdict,
  type PlanningFlowResult,
} from "@/features/planning/flow"
import { createEditorState, type EditorState } from "@/features/planning/editor"
import {
  CURRENT_PLANNING_ENGINE_VERSION,
  PLANNING_ENGINE_LABELS,
  type PlanningEngineVersion,
} from "@/features/core/planning-v3/types/engine-version"
import type { PlanningRegenerationRequest } from "@/features/planning/board"
import {
  baselineFromEditorState,
  describeV3Engine,
  PLANNING_V3_DEFAULT_TIMEOUT_SECONDS,
  runV3Generation,
  v3TechnicalCaveats,
  type V3AttemptOutcome,
} from "@/features/planning/v3"
import { EngineSelector } from "@/features/planning/view/EngineSelector"
import type { PlanningIssue } from "@/features/core/planning-generator/types/business-pipeline"
import { PlanningEditor } from "@/features/planning/editor/ui"
import {
  PlanningBoard,
  PlanningPublishDialog,
  PlanningSectorMenu,
  adaptEditorStateToBoard,
  buildPlanningBoard,
  decidePublication,
  hasPlanningForWeek,
  listWeekOptions,
  mondayOf,
  weekPeriod,
  type WeekOption,
} from "@/features/planning/board"
import { evaluateSetupReadiness, useSetupReadiness } from "@/features/onboarding"
import {
  planningStore,
  type PlanningRecord,
  type PlanningStatus,
  type PlanningSummary,
} from "@/features/planning/persistence"

type GenerationState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; result: PlanningFlowResult }

/**
 * What the LAST V3 attempt did — never what is on screen.
 *
 * Held apart from `editorState` on purpose. A failed attempt must leave the
 * displayed planning exactly as it was, so failure lives here and nowhere else;
 * only an accepted attempt is ever allowed to touch the schedule.
 */
type V3State =
  | { readonly status: "idle" }
  | { readonly status: "running" }
  | { readonly status: "accepted"; readonly outcome: Extract<V3AttemptOutcome, { status: "accepted" }> }
  | { readonly status: "rejected"; readonly outcome: Extract<V3AttemptOutcome, { status: "rejected" }> }

/** The planning to restore when the manager backs out of V3. */
interface V2Snapshot {
  readonly state: EditorState
  readonly record: PlanningRecord | null
  readonly generation: GenerationState
}

/** ISO date `n` days from `date` (UTC), as YYYY-MM-DD. */
function isoDate(date: Date, addDays = 0): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + addDays))
  return d.toISOString().slice(0, 10)
}

/** A one-week planning scope starting today (temporary default until a picker exists). */
/**
 * A planning period is always Monday → Sunday.
 *
 * Anchoring on "today" produced a week running Tuesday 21 → Monday 27 while
 * being labelled week 30, so the columns, the dates and the number all
 * disagreed. `weekPeriod` snaps to the ISO Monday.
 */
function scopeForWeek(monday: string) {
  const period = weekPeriod(monday)
  return {
    planningId: `planning_${period.start}`,
    period,
    now: new Date().toISOString(),
  }
}

/**
 * PlanningView — the manager-facing planning generation screen. It ORCHESTRATES
 * only: collects the store + employees, calls `runPlanningFlow` (which drives
 * every engine), and renders the loading / error / result states. No business
 * logic lives here.
 */
export function PlanningView({ initialStore }: { initialStore: StoreConfig | null }) {
  const { employees, isLoading } = useEmployees()
  const setup = useSetupReadiness(initialStore)
  const [state, setState] = useState<GenerationState>({ status: "idle" })
  // Which engine the NEXT generation will use. Defaults to V2 and stays there
  // unless the manager deliberately picks otherwise.
  const [engine, setEngine] = useState<PlanningEngineVersion>(CURRENT_PLANNING_ENGINE_VERSION)
  // Which engine produced what is CURRENTLY on screen. Different from `engine`
  // between choosing V3 and a V3 run actually succeeding — which is precisely
  // the window in which the screen must not lie about what it is showing.
  const [activeEngine, setActiveEngine] = useState<PlanningEngineVersion>("v2")
  const [v3, setV3] = useState<V3State>({ status: "idle" })
  // Why the last attempt was refused before any engine ran. Held apart from
  // every engine result: it is about the selection and the configuration, not
  // about a run, and it must never disturb the planning currently displayed.
  const [scopeRefusal, setScopeRefusal] = useState<
    Extract<GenerationScopeVerdict, { kind: "refused" }> | null
  >(null)
  /**
   * THE selection — the single source of truth for both the grid and the engines.
   *
   * `null` until the sectors have loaded, which is what tells the initialising
   * effect below that it has not run yet. Without that distinction an empty
   * selection during loading would look like a deliberate "nothing selected"
   * and would be overwritten every render.
   */
  const [selectedSectorIds, setSelectedSectorIds] = useState<readonly string[] | null>(null)
  // Blocking issues a V2 run reported. Previously computed and then dropped on
  // the floor: the screen filtered them out of the technical drawer and showed
  // nothing in their place, so a refused generation looked like a bad one.
  const [v2Blocking, setV2Blocking] = useState<readonly string[]>([])
  const [v2Snapshot, setV2Snapshot] = useState<V2Snapshot | null>(null)
  const [savedPlannings, setSavedPlannings] = useState<readonly PlanningSummary[]>([])
  const [record, setRecord] = useState<PlanningRecord | null>(null)
  const [editorState, setEditorState] = useState<EditorState | null>(null)
  const [editorInstance, setEditorInstance] = useState(0)
  const [isDirty, setIsDirty] = useState(false)
  const [isPersisting, setIsPersisting] = useState(false)
  const [persistenceError, setPersistenceError] = useState<string | null>(null)
  // Which week the next generation targets. The engine handles one week at a
  // time today, but making the choice explicit means a future week costs no UI
  // change when it becomes possible.
  const [targetWeek, setTargetWeek] = useState<string>(() =>
    mondayOf(new Date().toISOString().slice(0, 10))
  )
  const weekOptions = useMemo(() => listWeekOptions(targetWeek), [targetWeek])
  /** Only active sectors can be planned, so only they can be picked. */
  const pickableSectors = useMemo(() => selectableSectors(setup.sectors ?? []), [setup.sectors])
  /**
   * The effective selection: every active sector until the manager narrows.
   *
   * DERIVED, not initialised in an effect. `null` means "never chosen", and it
   * resolves to all pickable sectors; `[]` means "chosen none" and stays empty.
   * Keeping the two apart is what stops a transient empty list — the sector
   * repository still loading — from being read as a deliberate choice and
   * overwriting one the manager had already made.
   */
  const selection = useMemo(
    () => selectedSectorIds ?? pickableSectors.map((sector) => sector.id),
    [selectedSectorIds, pickableSectors]
  )
  const sectorChoices = useMemo(
    () =>
      pickableSectors.map((sector) => ({
        id: sector.id,
        name: sector.name || "Sans nom",
        selected: selection.includes(sector.id),
      })),
    [pickableSectors, selection]
  )

  const toggleSector = (sectorId: string): void =>
    setSelectedSectorIds((current) => {
      const next = new Set(current ?? pickableSectors.map((sector) => sector.id))
      if (next.has(sectorId)) next.delete(sectorId)
      else next.add(sectorId)
      return [...next]
    })

  const toggleAllSectors = (selectAll: boolean): void =>
    setSelectedSectorIds(selectAll ? pickableSectors.map((sector) => sector.id) : [])

  /**
   * Readiness for what is SELECTED, not for the whole configuration.
   *
   * `setup.ready` folds every active sector into one boolean, so an incomplete
   * Accueil made the screen announce "configuration required" while the manager
   * was looking at a perfectly configured Drive.
   */
  const selectionReadiness = useMemo(
    () =>
      evaluateSetupReadiness({
        store: initialStore,
        employees,
        sectors: pickableSectors.filter((sector) => selection.includes(sector.id)),
      }),
    [initialStore, employees, pickableSectors, selection]
  )
  const boardInput = useMemo(
    () =>
      editorState
        ? adaptEditorStateToBoard(
            editorState,
            (setup.sectors ?? []).map((sector) => ({ id: sector.id, name: sector.name })),
            // Whichever engine produced the schedule on screen describes it.
            // Reading V2's report under a V3 planning would put the wrong
            // reserves and the wrong technical facts under the right week.
            activeEngine === "v3" ? buildV3BoardDiagnostics(v3) : buildBoardDiagnostics(state)
          )
        : null,
    [editorState, setup.sectors, state, activeEngine, v3]
  )
  // The publish dialog restates the reserves, so it reads the same summary the
  // banner under the schedule does — one computation, no second wording.
  const boardSummary = useMemo(
    () =>
      boardInput
        ? buildPlanningBoard(boardInput, {
            view: "sector",
            // The publish gate weighs the whole planning, so the summary reads
            // every sector, not whichever ones the board happens to be filtered to.
            sectorIds: boardInput.sectors.map((sector) => sector.id),
            date: null,
            employeeId: null,
          }).summary
        : null,
    [boardInput]
  )
  const [publishDialogOpen, setPublishDialogOpen] = useState(false)
  const [publishBlocked, setPublishBlocked] = useState(false)
  // Raised by the board when local shift edits break a contract or produce an
  // impossible schedule: saving and publishing stay barred until they are fixed.
  const [editsBlockPersistence, setEditsBlockPersistence] = useState(false)
  // What the "Publier" button is allowed to do. Decided by a pure function over
  // the run's diagnostics and the recomputed shortfalls — never over the display
  // status, which cannot tell a hard violation from a coverage reserve.
  const publishDecision = useMemo(
    () =>
      decidePublication({
        hasBlockingViolation: boardInput?.diagnostics?.blocking,
        requiresExplicitAcceptance: boardInput?.diagnostics?.requiresAcceptance,
        underCoveredSlots: boardSummary?.deficits.length,
      }),
    [boardInput, boardSummary]
  )

  useEffect(() => {
    void planningStore
      .list()
      .then(setSavedPlannings)
      .catch(() => setPersistenceError("Impossible de charger les plannings enregistrés."))
  }, [])

  async function refreshSavedPlannings() {
    try {
      setSavedPlannings(await planningStore.list())
    } catch {
      setPersistenceError("Impossible de charger les plannings enregistrés.")
    }
  }

  /**
   * Generate or regenerate with the SELECTED engine. Never with the other one.
   *
   * The two branches share nothing but their trigger: V2 replaces the schedule
   * synchronously as it always has, while V3 prepares a whole result off to the
   * side and swaps it in only once every acceptance condition holds. Neither
   * branch can reach the other — a failed V3 run ends in a message and a button,
   * not in a V2 generation nobody asked for.
   */
  function handleGenerate(regeneration?: PlanningRegenerationRequest) {
    // Resolved ONCE, before either engine, from the SELECTION — never from every
    // active sector. A sector the manager did not select has no say in whether
    // this generation may run, and a sector that cannot be planned cannot be
    // planned by either engine, so both get the same sentence.
    const verdict = resolveGenerationScope({
      store: initialStore,
      sectors: setup.sectors ?? [],
      employees,
      selectedSectorIds: selection,
    })

    if (verdict.kind === "refused") {
      // Nothing is generated and NOTHING is replaced. A refusal must not cost
      // the manager the planning already on screen.
      setScopeRefusal(verdict)
      setV2Blocking([])
      return
    }
    setScopeRefusal(null)

    if (engine === "v3") {
      void handleGenerateV3(verdict.scope, regeneration)
      return
    }
    handleGenerateV2(verdict.scope)
  }

  async function handleGenerateV3(
    generationScope: GenerationScope,
    regeneration?: PlanningRegenerationRequest
  ) {
    if (!initialStore) return
    setV3({ status: "running" })
    setPublishBlocked(false)

    // Only the selected sector and only the people eligible for it. Passing the
    // whole configuration here is what made an unselected sector able to break
    // a selected one.
    const prepared = preparePlanningGeneration({
      store: initialStore,
      employees: generationScope.employees,
      sectors: generationScope.sectors,
      scope: scopeForWeek(targetWeek),
    })
    if (prepared.status === "error") {
      setV3({
        status: "rejected",
        outcome: {
          status: "rejected",
          title: "La configuration ne permet pas de préparer une génération",
          message: "Le planning affiché est inchangé.",
          details: prepared.errors.map((error) => `${error.code} — ${error.message}`),
        },
      })
      return
    }

    // The reference the locks, the retouches and the stability objective all
    // point at: what is on screen right now, edits included.
    const baseline =
      regeneration !== undefined && editorState !== null
        ? baselineFromEditorState(editorState)
        : undefined

    const outcome = await runV3Generation({ prepared, regeneration, baseline })

    if (outcome.status === "rejected") {
      // NOTHING is touched. Not the editor state, not the record, not the
      // generation report, not the saved plannings. The manager's V2 planning is
      // exactly where they left it, and the only new thing on screen is an
      // explanation and a way out.
      setV3({ status: "rejected", outcome })
      return
    }

    // Accepted: keep what V2 had, so backing out is a restore rather than a
    // regeneration the manager would have to wait for a second time.
    if (activeEngine === "v2" && editorState !== null) {
      setV2Snapshot({ state: editorState, record, generation: state })
    }
    setPublishDialogOpen(false)
    setRecord(null)
    setEditorState(outcome.editorState)
    setEditorInstance((value) => value + 1)
    setIsDirty(true)
    setActiveEngine("v3")
    setState({ status: "idle" })
    setV3({ status: "accepted", outcome })
  }

  /**
   * Leave V3 behind, in one click.
   *
   * Restores the exact V2 planning that was on screen before the switch when
   * there was one; otherwise clears the V3 schedule rather than leaving it
   * under a "V2 stable" label. It never regenerates: putting the manager back
   * where they were must not cost them another wait, and must not quietly
   * produce a schedule they did not ask for.
   */
  function handleReturnToV2() {
    setEngine("v2")
    setV3({ status: "idle" })
    setPublishBlocked(false)
    setPublishDialogOpen(false)

    if (v2Snapshot !== null) {
      setEditorState(v2Snapshot.state)
      setRecord(v2Snapshot.record)
      setState(v2Snapshot.generation)
      setEditorInstance((value) => value + 1)
      setV2Snapshot(null)
      setActiveEngine("v2")
      return
    }

    if (activeEngine === "v3") {
      setEditorState(null)
      setRecord(null)
      setState({ status: "idle" })
      setEditorInstance((value) => value + 1)
    }
    setActiveEngine("v2")
  }

  function handleGenerateV2(generationScope: GenerationScope) {
    if (!initialStore) return
    setState({ status: "loading" })
    // Defer so the loading state paints before the (synchronous) engines run.
    setTimeout(() => {
      const result = runPlanningFlow({
        store: initialStore,
        employees: generationScope.employees,
        sectors: generationScope.sectors,
        scope: scopeForWeek(targetWeek),
      })
      // A blocked run is a REFUSAL, not a schedule with warnings. Its blocking
      // issues used to be computed and then dropped — the technical drawer
      // filtered them out and nothing took their place — so the manager saw an
      // unusable week replace a working one with no explanation. It is now
      // reported, and it replaces nothing.
      const blocking =
        result.status === "success" && result.generation.status === "blocked"
          ? result.generation.issues
              .filter((issue: PlanningIssue) => issue.severity === "blocking")
              .map((issue: PlanningIssue) => issue.message)
          : []
      setV2Blocking(blocking)

      if (result.status === "success" && blocking.length === 0) {
        setPublishDialogOpen(false)
        setPublishBlocked(false)
        setRecord(null)
        // A successful V2 run is the manager choosing V2 outright: the V3
        // attempt and the snapshot it was guarding are both spent.
        setActiveEngine("v2")
        setV3({ status: "idle" })
        setV2Snapshot(null)
        setEditorState(
          createEditorState({
            coreInput: result.coreInput,
            configuration: result.configuration,
            planning: result.generation.planning,
            shifts: result.generation.shifts,
            assignments: result.generation.assignments,
          })
        )
        setEditorInstance((value) => value + 1)
        setIsDirty(true)
        setState({ status: "done", result })
        return
      }

      // Failed or refused: the previous planning stays exactly where it is.
      setState(editorState === null ? { status: "done", result } : { status: "idle" })
    }, 0)
  }

  /**
   * TEMPORARY, and deliberately so: a saved planning does not record WHICH
   * engine produced it, nor the V3 validation report.
   *
   * `PlanningRecord` stores an `EditorState` and nothing beside it, so carrying
   * the engine would mean threading a field through the record, the lifecycle,
   * the repository and the serialisation — four files and their tests, for a
   * mode that is explicitly experimental and switched off by default. This
   * sprint was told not to invent a persistence layer, so it did not.
   *
   * What that costs, precisely: reopening a saved planning shows it as V2,
   * because `activeEngine` resets with the session. The schedule itself is
   * complete and correct — the shifts, the assignments and the period are all
   * there — only its provenance is lost. Anything published from a reopened V3
   * planning is re-audited by the same publish gate as any other, so nothing
   * unsafe follows from the gap; it is a traceability hole, not a safety one.
   *
   * Closing it is one optional field on `PlanningRecord` plus a migration of
   * the stored payload, and it should happen before V3 stops being a toggle.
   */
  async function persistCurrent(): Promise<PlanningRecord | null> {
    if (!editorState) return null
    const saved = record
      ? await planningStore.save(record.id, editorState)
      : await planningStore.createDraft(editorState)
    setRecord(saved)
    setIsDirty(false)
    await refreshSavedPlannings()
    return saved
  }

  async function withPersistence(action: () => Promise<void>) {
    setIsPersisting(true)
    setPersistenceError(null)
    try {
      await action()
    } catch (error) {
      setPersistenceError(error instanceof Error ? error.message : "Impossible d’enregistrer le planning.")
    } finally {
      setIsPersisting(false)
    }
  }

  function handleSave() {
    void withPersistence(async () => {
      await persistCurrent()
    })
  }

  /** Save and report whether it succeeded — for the board's "save then change week". */
  async function saveAndReport(): Promise<boolean> {
    let ok = false
    await withPersistence(async () => {
      await persistCurrent()
      ok = true
    })
    return ok
  }

  function publishNow() {
    // Second reading of the same gate, with the acceptance granted. The dialog
    // can only be reached through `handlePublish`, but publication is the one
    // irreversible action here, so it checks rather than trusts its caller.
    if (
      decidePublication({
        hasBlockingViolation: boardInput?.diagnostics?.blocking,
        requiresExplicitAcceptance: boardInput?.diagnostics?.requiresAcceptance,
        underCoveredSlots: boardSummary?.deficits.length,
        acceptedDegradations: true,
      }) !== "publish-directly"
    ) {
      setPublishDialogOpen(false)
      setPublishBlocked(true)
      return
    }
    setPublishDialogOpen(false)
    void withPersistence(async () => {
      const saved = await persistCurrent()
      if (!saved) return
      const published = await planningStore.publish(saved.id)
      setRecord(published)
      await refreshSavedPlannings()
    })
  }

  /**
   * A clean schedule publishes on the first click. One carrying reserves opens
   * the confirmation, which is the only place the acceptance is ever asked for.
   * One breaking a hard rule publishes nowhere and says why.
   */
  function handlePublish() {
    // Local edits that break a contract or the day itself bar publication just
    // as a generated hard violation does — no acceptance overrides either.
    if (editsBlockPersistence) {
      setPublishDialogOpen(false)
      setPublishBlocked(true)
      return
    }
    switch (publishDecision) {
      case "block-publication":
        setPublishDialogOpen(false)
        setPublishBlocked(true)
        return
      case "require-explicit-acceptance":
        setPublishBlocked(false)
        setPublishDialogOpen(true)
        return
      case "publish-directly":
        setPublishBlocked(false)
        publishNow()
    }
  }

  function handleArchive() {
    void withPersistence(async () => {
      const target = !record || (record.status === "draft" && isDirty) ? await persistCurrent() : record
      if (!target) return
      const archived = await planningStore.archive(target.id)
      setRecord(archived)
      await refreshSavedPlannings()
    })
  }

  function handleOpen(id: string) {
    void withPersistence(async () => {
      const reopened = await planningStore.reopen(id)
      if (!reopened) throw new Error("Planning introuvable.")
      setRecord(reopened)
      setEditorState(reopened.state)
      setEditorInstance((value) => value + 1)
      setIsDirty(false)
      setState({ status: "idle" })
    })
  }

  function handleEditPublished() {
    if (!record) return
    void withPersistence(async () => {
      const draft = await planningStore.editPublished(record.id)
      setRecord(draft)
      setEditorState(draft.state)
      setEditorInstance((value) => value + 1)
      setIsDirty(false)
      await refreshSavedPlannings()
    })
  }

  const busyGenerating = state.status === "loading" || v3.status === "running"
  /** What the screen says it is showing. Read from the run, never assumed. */
  const activeEngineLabel =
    activeEngine === "v3" && v3.status === "accepted"
      ? describeV3Engine(v3.outcome.response)
      : PLANNING_ENGINE_LABELS[activeEngine]
  // Offered whenever V3 is involved at all — a live V3 planning, or a failed
  // attempt sitting on top of an untouched V2 one.
  const canReturnToV2 = activeEngine === "v3" || v3.status === "rejected"
  const currentStatus: PlanningStatus = record?.status ?? "draft"
  const readOnly = currentStatus !== "draft"
  // The loaded planning belongs to one week; when the manager is looking at any
  // other week, nothing tied to it — grid, detailed editor, publish dialog —
  // may render, so the S30 planning never appears under an S31 header.
  const selectedWeekHasPlanning = hasPlanningForWeek(
    targetWeek,
    boardInput ? boardInput.periodStart : null
  )

  return (
    <div className="space-y-6">
      {/* Once a planning exists the control bar carries the title and the
          actions, so this header would only push the schedule down. */}
      {editorState ? null : (
        <div className="flex flex-wrap items-end justify-between gap-4">
          <PageHeader
            title="Planning"
            description="Générez un planning à partir de la configuration du magasin et de votre équipe."
          />
          <div className="flex flex-wrap items-center gap-2">
            <EngineSelector value={engine} onChange={setEngine} disabled={busyGenerating} />
            {/* The same control the board shows, on the same state: before the
                first generation there is no board, and the sector to plan still
                has to be choosable. */}
            <PlanningSectorMenu
              sectors={sectorChoices}
              onToggleSector={toggleSector}
              onToggleAll={toggleAllSectors}
            />
            <select
              value={targetWeek}
              onChange={(event) => setTargetWeek(event.target.value)}
              className="rounded-md border bg-background px-2 py-1.5 text-sm"
              aria-label="Semaine à générer"
            >
              {weekOptions.map((option: WeekOption) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <Button
              onClick={() => handleGenerate()}
              // Deliberately NOT disabled by sector readiness. `setup.ready` is a
              // single boolean over every active sector, so one incomplete
              // sector killed the button for every other one — and a dead
              // button explains nothing. Clicking now produces a precise reason.
              disabled={!initialStore || setup.isLoading || isLoading || busyGenerating}
            >
              {busyGenerating ? "Génération…" : "Générer"}
            </Button>
          </div>
        </div>
      )}

      {!initialStore ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Magasin non configuré</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Terminez la configuration du magasin avant de générer un planning.
          </CardContent>
        </Card>
      ) : null}

      {initialStore && !setup.isLoading && !selectionReadiness.ready ? (
        <Card>
          <CardHeader><CardTitle className="text-base">Configuration requise avant la génération</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Complétez les éléments suivants dans le parcours de configuration :</p>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">{selectionReadiness.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>
            <div className="mt-4 flex flex-wrap gap-2"><Button variant="outline" render={<Link href="/configuration/secteurs" />}>Configurer les secteurs</Button><Button variant="outline" render={<Link href="/configuration/employes" />}>Affecter les salariés</Button></div>
          </CardContent>
        </Card>
      ) : null}

      {savedPlannings.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Plannings enregistrés</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {savedPlannings.map((planning) => (
              <div key={planning.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
                <div>
                  <p className="text-sm font-medium">{planning.label}</p>
                  <p className="text-xs text-muted-foreground">{planning.periodStart} → {planning.periodEnd}</p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={planning.status} />
                  <Button size="sm" variant="outline" onClick={() => handleOpen(planning.id)} disabled={isPersisting}>
                    Ouvrir
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {busyGenerating ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {v3.status === "running"
              ? `Résolution CP-SAT en cours, jusqu'à ${PLANNING_V3_DEFAULT_TIMEOUT_SECONDS} secondes… le planning actuel reste affiché tant qu'aucun résultat V3 n'est validé.`
              : "Génération du planning…"}
          </CardContent>
        </Card>
      ) : null}

      {scopeRefusal !== null ? (
        <Card role="alert" className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-base text-destructive">{scopeRefusal.message}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {scopeRefusal.details.length > 0 ? (
              <ul className="space-y-1 text-sm">
                {scopeRefusal.details.map((problem, index) => (
                  <li key={`${problem.code}_${index}`}>{problem.message}</li>
                ))}
              </ul>
            ) : null}
            {/* Neither engine was called, so nothing about the week itself has
                been established — and nothing on screen has been touched. */}
            <p className="text-sm text-muted-foreground">
              Aucun moteur n’a été appelé et le planning affiché n’a pas été modifié.
            </p>
            {scopeRefusal.code === "sector-configuration" ? (
              <Button variant="outline" size="sm" render={<Link href="/configuration/secteurs" />}>
                Configurer les secteurs
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {v2Blocking.length > 0 ? (
        <Card role="alert" className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-base text-destructive">
              Le moteur V2 a refusé de générer
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <ul className="space-y-1 text-sm">
              {v2Blocking.map((message, index) => (
                <li key={index}>{message}</li>
              ))}
            </ul>
            <p className="text-sm text-muted-foreground">
              Le planning affiché n’a pas été modifié.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {v3.status === "rejected" ? (
        <Card role="alert" className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-base text-destructive">{v3.outcome.title}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm">{v3.outcome.message}</p>
            {v3.outcome.details.length > 0 ? (
              <ul className="space-y-1 text-sm text-muted-foreground">
                {v3.outcome.details.map((detail, index) => (
                  <li key={index} className="font-mono text-xs">
                    {detail}
                  </li>
                ))}
              </ul>
            ) : null}
            {/* No automatic retry and no automatic V2 run. The engine failed;
                what happens next is the manager's decision, not the screen's. */}
            <p className="text-sm text-muted-foreground">
              Aucun repli automatique n’a été effectué : le planning affiché n’a pas été modifié.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={handleReturnToV2}>
                Revenir à V2
              </Button>
              <Button size="sm" variant="outline" onClick={() => handleGenerate()} disabled={busyGenerating}>
                Réessayer en V3
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {state.status === "done" && state.result.status === "error" ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base text-destructive">
              Échec de la génération ({state.result.errors.length} problème
              {state.result.errors.length === 1 ? "" : "s"})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {state.result.errors.map((error, index) => (
                <li key={index} className="text-sm">
                  <span className="font-mono text-xs text-muted-foreground">
                    {error.path || error.code}
                  </span>
                  <span className="ml-2">{error.message}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {editorState && boardInput ? (
        <>
          {persistenceError ? <p role="alert" className="text-sm text-destructive">{persistenceError}</p> : null}

          {publishBlocked ? (
            <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              Publication impossible : des règles obligatoires — couverture dure ou contrats — ne
              sont pas respectées. Corrigez le planning avant de le publier ; aucune acceptation ne
              permet de passer outre.
            </p>
          ) : null}

          {/* New planning board: engine-agnostic, read-only for now. It renders
              a ViewModel built outside React, so the V3 swap will only replace
              the adapter above it. */}
          {/* Which engine made THIS schedule, next to the schedule itself.
              A manager must never have to remember which button they pressed
              five minutes ago to know what they are about to publish. */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2">
            <div className="flex items-center gap-2 text-sm">
              <Badge variant={activeEngine === "v3" ? "secondary" : "outline"}>
                {activeEngineLabel}
              </Badge>
              {activeEngine === "v3" ? (
                <span className="text-xs text-muted-foreground">
                  Mode expérimental — détails dans le panneau technique.
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <EngineSelector value={engine} onChange={setEngine} disabled={busyGenerating} />
              {canReturnToV2 ? (
                <Button size="sm" variant="outline" onClick={handleReturnToV2}>
                  Revenir à V2
                </Button>
              ) : null}
            </div>
          </div>

          <PlanningBoard
            input={boardInput}
            selectedWeek={targetWeek}
            onChangeWeek={setTargetWeek}
            onSaveRequest={saveAndReport}
            onGenerate={handleGenerate}
            sectorIds={selection}
            onToggleSector={toggleSector}
            onToggleAllSectors={toggleAllSectors}
            generating={busyGenerating}
            dirty={isDirty}
            onPersistenceBlockChange={setEditsBlockPersistence}
            actions={
              <>
                {currentStatus === "draft" ? (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleSave}
                      disabled={isPersisting || !isDirty || editsBlockPersistence}
                    >
                      Enregistrer
                    </Button>
                    {/* Left clickable even when publication is barred: a dead
                        button explains nothing, whereas the click produces the
                        reason below the schedule. */}
                    <Button size="sm" onClick={handlePublish} disabled={isPersisting}>
                      Publier
                    </Button>
                  </>
                ) : null}
                {currentStatus === "published" ? (
                  <>
                    <Button size="sm" onClick={handleEditPublished} disabled={isPersisting}>
                      Nouveau brouillon
                    </Button>
                    <Button size="sm" variant="outline" onClick={handleArchive} disabled={isPersisting}>
                      Archiver
                    </Button>
                  </>
                ) : null}
              </>
            }
          />

          {selectedWeekHasPlanning ? (
            <details className="rounded-lg border p-3 text-sm">
              <summary className="cursor-pointer font-medium">Éditeur détaillé (existant)</summary>
              <div className="mt-3">
                <PlanningEditor
                  key={`${record?.id ?? "new"}_${editorInstance}`}
                  initialState={editorState}
                  readOnly={readOnly}
                  diagnostic={state.status === "done" && state.result.status === "success" && state.result.generation.status === "blocked"}
                  onStateChange={(next) => {
                    setEditorState(next)
                    setIsDirty(true)
                  }}
                />
              </div>
            </details>
          ) : null}

          {selectedWeekHasPlanning && boardSummary ? (
            <PlanningPublishDialog
              open={publishDialogOpen}
              summary={boardSummary}
              busy={isPersisting}
              onCancel={() => setPublishDialogOpen(false)}
              onConfirm={publishNow}
            />
          ) : null}
        </>
      ) : null}
    </div>
  )
}


/**
 * Reduce a generation run to the three things the board needs: can it be
 * published, does someone have to accept something, and what belongs in the
 * technical drawer. Everything else the engine says stays where it was.
 */
/**
 * The same three questions, answered from a V3 run.
 *
 * `blocking` is always false here and that is not an oversight: a V3 result
 * only ever reaches the board after `acceptV3Result` has confirmed the
 * independent validator found no hard violation. A blocking V3 answer never
 * becomes a planning at all — it becomes the error card.
 */
function buildV3BoardDiagnostics(v3: V3State) {
  if (v3.status !== "accepted") return undefined
  const { response, problem, acceptance } = v3.outcome
  return {
    blocking: false,
    requiresAcceptance: acceptance.requiresExplicitAcceptance,
    technical: [
      { label: "Moteur", value: describeV3Engine(response) },
      ...v3TechnicalCaveats(response, problem),
    ],
  }
}

function buildBoardDiagnostics(state: GenerationState) {
  if (state.status !== "done" || state.result.status !== "success") return undefined
  const generation = state.result.generation
  const technical = generation.issues
    .filter((issue: PlanningIssue) => issue.severity !== "blocking")
    .map((issue: PlanningIssue) => ({ label: issue.code, value: issue.message }))
  return {
    blocking: generation.status === "blocked",
    requiresAcceptance: generation.status === "degraded",
    technical,
  }
}

function StatusBadge({ status }: { status: PlanningStatus }) {
  const labels: Record<PlanningStatus, string> = {
    draft: "Brouillon",
    published: "Publié",
    archived: "Archivé",
  }
  return <Badge variant={status === "draft" ? "outline" : status === "published" ? "default" : "secondary"}>{labels[status]}</Badge>
}
