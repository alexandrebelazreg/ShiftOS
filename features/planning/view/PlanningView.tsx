"use client"

import { useEffect, useState } from "react"
import Link from "next/link"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { PageHeader } from "@/components/layout/page-header"

import { useEmployees } from "@/features/employees/hooks/useEmployees"
import type { StoreConfig } from "@/features/store/schemas/store.schema"
import { runPlanningFlow, type PlanningFlowResult } from "@/features/planning/flow"
import { createEditorState, type EditorState } from "@/features/planning/editor"
import { PlanningEditor } from "@/features/planning/editor/ui"
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
function defaultScope() {
  const today = new Date()
  return {
    planningId: "planning_1",
    period: { start: isoDate(today), end: isoDate(today, 6) },
    now: new Date().toISOString(),
  }
}

function GenerationDiagnostics({ generation }: { generation: Extract<PlanningFlowResult, { status: "success" }>["generation"] }) {
  const technicalCodes = new Set(["coverage_surplus_detail", "daily_distribution_imperfect"])
  const mainIssues = generation.issues.filter((issue) => !technicalCodes.has(issue.code))
  const technicalIssues = generation.issues.filter((issue) => technicalCodes.has(issue.code))
  const repair = generation.repairAttempts.filter((attempt) => attempt.generated > 0)
  return <><p className="text-sm text-muted-foreground">{generation.status === "blocked" ? `${generation.issues.filter((issue) => issue.code === "contract_inexact").length} contrat(s) inexact(s) ou violation(s) bloquante(s). Les affectations affichées sont provisoires et ne constituent pas un planning valide.` : "Le meilleur plan trouvé sous l’objectif borné a été conservé. Aucun écart n’a été masqué."}</p><ul className="mt-3 list-disc space-y-1 pl-5 text-sm">{mainIssues.map((issue, index) => <li key={`${issue.code}-${index}`}>{issue.message}</li>)}</ul>{technicalIssues.length || repair.length ? <details className="mt-4 rounded-lg border p-3 text-sm"><summary className="cursor-pointer font-medium">Diagnostic technique</summary><ul className="mt-3 list-disc space-y-1 pl-5">{technicalIssues.map((issue, index) => <li key={`${issue.code}-${index}`}>{issue.message}</li>)}{repair.map((attempt) => <li key={attempt.family}>{attempt.family} : {attempt.generated} générés, {attempt.rejected} rejetés, {attempt.evaluated} évalués, {attempt.accepted} acceptés</li>)}</ul></details> : null}</>
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
  const [degradedAccepted, setDegradedAccepted] = useState(false)

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
        scope: defaultScope(),
      })
      if (result.status === "success") {
        setDegradedAccepted(false)
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

  function handlePublish() {
    const generationStatus = state.status === "done" && state.result.status === "success" ? state.result.generation.status : null
    if (generationStatus === "blocked" || (generationStatus === "degraded" && !degradedAccepted)) return
    void withPersistence(async () => {
      const saved = await persistCurrent()
      if (!saved) return
      const published = await planningStore.publish(saved.id)
      setRecord(published)
      await refreshSavedPlannings()
    })
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
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageHeader
          title="Planning"
          description="Générez un planning à partir de la configuration du magasin et de votre équipe."
        />
        <Button
          onClick={handleGenerate}
          disabled={!initialStore || !setup.ready || setup.isLoading || isLoading || state.status === "loading"}
        >
          {state.status === "loading" ? "Génération…" : "Générer le planning"}
        </Button>
      </div>

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

      {state.status === "done" && state.result.status === "success" && (state.result.generation.status !== "complete" || state.result.generation.issues.length > 0) ? (
        <Card>
          <CardHeader><CardTitle className="text-base">{state.result.generation.status === "blocked" ? "Proposition de diagnostic — génération bloquée" : state.result.generation.status === "degraded" ? "Planning dégradé" : "Compromis métier et informations"}</CardTitle></CardHeader>
          <CardContent><GenerationDiagnostics generation={state.result.generation} />{state.result.generation.status === "degraded" ? <label className="mt-4 flex items-start gap-2 text-sm"><input type="checkbox" checked={degradedAccepted} onChange={(event) => setDegradedAccepted(event.target.checked)} /><span>J’accepte explicitement les écarts de couverture ou de répartition avant publication.</span></label> : null}</CardContent>
        </Card>
      ) : null}

      {editorState ? (
        <>
          <Card>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
              <div className="flex items-center gap-3">
                <StatusBadge status={currentStatus} />
                <span className="text-sm text-muted-foreground">
                  {isDirty ? "● Modifications non enregistrées" : "✓ Enregistré"}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {currentStatus === "draft" ? (
                  <>
                    <Button size="sm" variant="outline" onClick={handleSave} disabled={isPersisting || !isDirty}>
                      Enregistrer
                    </Button>
                    <Button size="sm" onClick={handlePublish} disabled={isPersisting || (state.status === "done" && state.result.status === "success" && (state.result.generation.status === "blocked" || (state.result.generation.status === "degraded" && !degradedAccepted)))}>
                      Publier
                    </Button>
                  </>
                ) : null}
                {currentStatus === "published" ? (
                  <Button size="sm" onClick={handleEditPublished} disabled={isPersisting}>
                    Modifier dans un nouveau brouillon
                  </Button>
                ) : null}
                {currentStatus === "published" ? (
                  <Button size="sm" variant="outline" onClick={handleArchive} disabled={isPersisting}>
                    Archiver
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>

          {persistenceError ? <p role="alert" className="text-sm text-destructive">{persistenceError}</p> : null}

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
        </>
      ) : null}
    </div>
  )
}

function StatusBadge({ status }: { status: PlanningStatus }) {
  const labels: Record<PlanningStatus, string> = {
    draft: "Brouillon",
    published: "Publié",
    archived: "Archivé",
  }
  return <Badge variant={status === "draft" ? "outline" : status === "published" ? "default" : "secondary"}>{labels[status]}</Badge>
}
