"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { PageHeader } from "@/components/layout/page-header"

import { useEmployees } from "@/features/employees/hooks/useEmployees"
import type { StoreConfig } from "@/features/store/schemas/store.schema"
import { runPlanningFlow, type PlanningFlowResult } from "@/features/planning/flow"
import { createEditorState, type EditorState } from "@/features/planning/editor"
import type { PlanningIssue } from "@/features/core/planning-generator/types/business-pipeline"
import { PlanningEditor } from "@/features/planning/editor/ui"
import {
  PlanningBoard,
  PlanningPublishDialog,
  adaptEditorStateToBoard,
  buildPlanningBoard,
  decidePublication,
  listWeekOptions,
  mondayOf,
  weekPeriod,
  type WeekOption,
} from "@/features/planning/board"
import { useSetupReadiness } from "@/features/onboarding"
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
  const boardInput = useMemo(
    () =>
      editorState
        ? adaptEditorStateToBoard(
            editorState,
            (setup.sectors ?? []).map((sector) => ({ id: sector.id, name: sector.name })),
            buildBoardDiagnostics(state)
          )
        : null,
    [editorState, setup.sectors, state]
  )
  // The publish dialog restates the reserves, so it reads the same summary the
  // banner under the schedule does — one computation, no second wording.
  const boardSummary = useMemo(
    () =>
      boardInput
        ? buildPlanningBoard(boardInput, {
            view: "sector",
            sectorId: null,
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

  function handleGenerate() {
    if (!initialStore || !setup.ready) return
    setState({ status: "loading" })
    // Defer so the loading state paints before the (synchronous) engines run.
    setTimeout(() => {
      const result = runPlanningFlow({
        store: initialStore,
        employees,
        sectors: setup.sectors,
        scope: scopeForWeek(targetWeek),
      })
      if (result.status === "success") {
        setPublishDialogOpen(false)
        setPublishBlocked(false)
        setRecord(null)
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
      }
      setState({ status: "done", result })
    }, 0)
  }

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

  const currentStatus: PlanningStatus = record?.status ?? "draft"
  const readOnly = currentStatus !== "draft"

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
          <div className="flex items-center gap-2">
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
              onClick={handleGenerate}
              disabled={!initialStore || !setup.ready || setup.isLoading || isLoading || state.status === "loading"}
            >
              {state.status === "loading" ? "Génération…" : "Générer"}
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

      {initialStore && !setup.isLoading && !setup.ready ? (
        <Card>
          <CardHeader><CardTitle className="text-base">Configuration requise avant la génération</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Complétez les éléments suivants dans le parcours de configuration :</p>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">{setup.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>
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

      {state.status === "loading" ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Génération du planning…
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
          <PlanningBoard
            input={boardInput}
            weekOptions={weekOptions}
            selectedWeek={targetWeek}
            onSelectWeek={setTargetWeek}
            onPersistenceBlockChange={setEditsBlockPersistence}
            actions={
              <>
                <StatusBadge status={currentStatus} />
                <span className="text-xs text-muted-foreground">
                  {isDirty ? "● Non enregistré" : "✓ Enregistré"}
                </span>
                <Button
                  size="sm"
                  onClick={handleGenerate}
                  disabled={!initialStore || !setup.ready || setup.isLoading || isLoading || state.status === "loading"}
                >
                  {state.status === "loading" ? "Génération…" : "Générer"}
                </Button>
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

          {boardSummary ? (
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
