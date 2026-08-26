"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

import { useEmployees } from "@/features/employees/hooks/useEmployees"
import type { StoreConfig } from "@/features/store/schemas/store.schema"
import {
  preparePlanningGeneration,
  marketZoneSectors,
  resolveGenerationScope,
  selectableSectors,
  type GenerationScope,
  type GenerationScopeVerdict,
} from "@/features/planning/flow"
import { type EditorState } from "@/features/planning/editor"
import { endpointEngineFor } from "@/features/core/planning-v3/types/engine-version"
import type { PlanningRegenerationRequest } from "@/features/planning/board"
import {
  baselineFromEditorState,
  describeV3Engine,
  PLANNING_V3_DEFAULT_TIMEOUT_SECONDS,
  runV3Generation,
  v3TechnicalCaveats,
  type V3AttemptOutcome,
} from "@/features/planning/v3"
import {
  PlanningBoard,
  adaptEditorStateToBoard,
  mondayOf,
  weekPeriod,
} from "@/features/planning/board"
import { weekDayOf } from "@/features/core/shared"
import { holidayStore } from "@/features/planning/holidays/holiday.store"
import type { StoredHolidays } from "@/features/planning/holidays/holiday.repository"
import { frenchHolidaysOf } from "@/features/planning/holidays/model/french-holidays"
import { holidayPlanForPeriod } from "@/features/planning/holidays/model/holiday-plan"
import { evaluateSetupReadiness, useSetupReadiness } from "@/features/onboarding"
import {
  planningStore,
  type PlanningRecord,
} from "@/features/planning/persistence"
import { PlanningGenerationLoader } from "@/features/planning/view/PlanningGenerationLoader"
import {
  planningIdToOpen,
  savedPlanningFor,
} from "@/features/planning/view/displayed-planning"

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

function sameSectorScope(left: readonly string[], right: readonly string[] | undefined): boolean {
  if (!right || left.length !== right.length) return false
  const expected = new Set(right)
  return left.every((id) => expected.has(id))
}

/**
 * PlanningView — the manager-facing planning generation screen. It ORCHESTRATES
 * only: collects the store + employees, prepares the input and runs
 * the one engine over the solve endpoint, and renders the running / refused /
 * result states. No business logic lives here.
 */
export function PlanningView({
  initialStore,
  initialWeek,
  initialPlanningId,
}: {
  readonly initialStore: StoreConfig | null
  readonly initialWeek?: string
  readonly initialPlanningId?: string
}) {
  const { employees, isLoading } = useEmployees()
  const setup = useSetupReadiness(initialStore)
  // Le nom du moteur ne s'affiche plus en tête de grille : il vit dans le
  // panneau technique, sous « Voir le détail », où `describeV3Engine` le lit
  // depuis la RÉPONSE du moteur plutôt que depuis un registre. C'est la seule
  // lecture qui dit ce qui a tourné, et non ce qui aurait dû tourner.
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
  const [record, setRecord] = useState<PlanningRecord | null>(null)
  const [editorState, setEditorState] = useState<EditorState | null>(null)
  const [isDirty, setIsDirty] = useState(false)
  const [isPersisting, setIsPersisting] = useState(false)
  const [persistenceError, setPersistenceError] = useState<string | null>(null)
  // Which week the next generation targets. The engine handles one week at a
  // time today, but making the choice explicit means a future week costs no UI
  // change when it becomes possible.
  const [targetWeek, setTargetWeek] = useState<string>(() =>
    initialWeek ?? mondayOf(new Date().toISOString().slice(0, 10))
  )
  /** Only active sectors can be planned, so only they can be picked. */
  const pickableSectors = useMemo(() => selectableSectors(setup.sectors ?? []), [setup.sectors])
  const marketZoneIds = useMemo(
    () => marketZoneSectors(pickableSectors).map((sector) => sector.id),
    [pickableSectors]
  )
  /** Prefer the historical/manual sector (the Drive) over a newly-created automatic aisle. */
  const defaultSectorIds = useMemo(() => {
    const sector = pickableSectors.find((entry) =>
      entry.id.trim().toLocaleLowerCase("fr-FR") === "drive"
      || entry.name.trim().toLocaleLowerCase("fr-FR") === "drive"
    )
      ?? pickableSectors.find((entry) => entry.weeklyDistributionEnabled !== false)
      ?? pickableSectors[0]
    return sector ? [sector.id] : []
  }, [pickableSectors])
  /**
   * The effective selection: the first configured sector until the manager
   * explicitly widens it.  This keeps the historical Drive on its proven
   * mono-sector path when a new aisle is added; multi-sector is an intentional
   * action, never a side effect of activating another sector.
   *
   * DERIVED, not initialised in an effect. `null` means "never chosen", and it
   * resolves to the protected default sector; `[]` means "chosen none" and stays empty.
   * Keeping the two apart is what stops a transient empty list — the sector
   * repository still loading — from being read as a deliberate choice and
   * overwriting one the manager had already made.
   */
  const selection = useMemo(
    () => selectedSectorIds ?? defaultSectorIds,
    [selectedSectorIds, defaultSectorIds]
  )
  const sectorChoices = useMemo(
    () =>
      pickableSectors.map((sector) => ({
        id: sector.id,
        name: sector.name || "Sans nom",
        selected: selection.includes(sector.id),
        marketZone: sector.marketZone,
      })),
    [pickableSectors, selection]
  )

  const toggleSector = (sectorId: string): void =>
    setSelectedSectorIds((current) => {
      const next = new Set(current ?? defaultSectorIds)
      if (next.has(sectorId)) next.delete(sectorId)
      else next.add(sectorId)
      return [...next]
    })

  const toggleAllSectors = (selectAll: boolean): void =>
    setSelectedSectorIds(selectAll ? pickableSectors.map((sector) => sector.id) : [])

  /**
   * Zone marché is one generation scope, not an additive filter. Selecting it
   * replaces Drive (or any other scope) so a single click cannot accidentally
   * hand Drive to the multi-sector builder.
   */
  const toggleMarketZone = (selectAll: boolean): void =>
    setSelectedSectorIds(selectAll ? marketZoneIds : [])

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
  /**
   * Ce que la grille doit savoir des fériés de la semaine affichée.
   *
   * L'intention n'a pas changé : le gérant peut régler un férié dans l'onglet
   * voisin, revenir ici, et la grille doit dire son dernier réglage sans qu'il
   * ait à régénérer. La lecture au rendu ne le permet plus — elle part vers la
   * base — donc la valeur est tenue en état et RELUE au retour sur l'onglet.
   * Sans ce rechargement, la grille afficherait un réglage périmé sans le dire.
   */
  const [storedHolidays, setStoredHolidays] = useState<StoredHolidays>({})

  useEffect(() => {
    if (typeof window === "undefined") return
    let active = true
    const load = (): void => {
      void holidayStore.read().then((stored) => {
        if (active) setStoredHolidays(stored)
      })
    }
    load()
    window.addEventListener("focus", load)
    return () => {
      active = false
      window.removeEventListener("focus", load)
    }
  }, [])

  const holidayContext = useMemo(() => {
    if (!editorState) return undefined
    const period = {
      start: editorState.planning.periodStart,
      end: editorState.planning.periodEnd,
    }
    const stored = storedHolidays
    const holidays = holidayPlanForPeriod(period, stored, (date) => {
      const day = initialStore?.openingHours.find((hours) => hours.day === weekDayOf(date))
      return day && !day.closed && day.opensAt && day.closesAt
        ? { opensAt: day.opensAt, closesAt: day.closesAt }
        : null
    })
    if (holidays.length === 0) return undefined
    const sunday = initialStore?.openingHours.find((hours) => hours.day === "sunday")
    return {
      holidays: holidays.map((entry) => ({
        date: entry.date,
        name: holidayNameOf(entry.date),
        opening: entry.opening,
        volunteerIds: entry.volunteerIds,
      })),
      storeOpensSundays: sunday !== undefined && !sunday.closed,
      profiles: Object.fromEntries(
        employees.map((employee) => [
          employee.id,
          {
            scheduleType: employee.scheduleType,
            student: employee.student,
            forfaitJour: employee.forfaitJour,
            fixedRestDays: employee.fixedDaysOff,
          },
        ])
      ),
    }
  }, [editorState, employees, initialStore, storedHolidays])

  const boardInput = useMemo(
    () =>
      editorState
        ? adaptEditorStateToBoard(
            editorState,
            // Les horaires voyagent avec le secteur : c'est eux qui décident où
            // commence et finit la journée sur la grille, pas ceux du magasin.
            (setup.sectors ?? [])
              .filter((sector) => {
                const planned = editorState.sectorScope?.sectorIds ?? record?.sectorIds ?? selection
                return planned.includes(sector.id)
              })
              .map((sector) => ({ id: sector.id, name: sector.name, marketZone: sector.marketZone, hours: sector.hours, color: sector.color })),
            buildV3BoardDiagnostics(v3),
            holidayContext
          )
        : null,
    [editorState, record?.sectorIds, selection, setup.sectors, v3, holidayContext]
  )
  // Raised by the board when local shift edits break a contract or produce an
  // impossible schedule: saving stays barred until they are fixed.
  const [editsBlockPersistence, setEditsBlockPersistence] = useState(false)
  /**
   * L'identifiant porté par l'adresse n'ouvre QU'UNE FOIS.
   *
   * Il restait vrai tant que la page vivait, et le chargement par affichage
   * plus bas s'interdisait de tourner tant qu'il était là. Arrivé du tableau de
   * bord, changer de semaine ou de rayon ne rouvrait donc plus rien : la S36 du
   * Drive, pourtant enregistrée, s'affichait vide, et rien ne le disait.
   *
   * `openedFromUrl` retient ce que cette page a déjà honoré — ouvert, ou
   * cherché en vain. La règle elle-même est pure et vérifiée à côté.
   */
  const [openedFromUrl, setOpenedFromUrl] = useState<string | null>(null)
  const openRequest = planningIdToOpen(initialPlanningId, openedFromUrl)

  useEffect(() => {
    if (!openRequest) return

    let active = true
    void planningStore.reopen(openRequest)
      .then((reopened) => {
        if (!active) return
        if (!reopened) throw new Error("Planning introuvable.")
        setRecord(reopened)
        setEditorState(reopened.state)
        setSelectedSectorIds(reopened.sectorIds ?? null)
        setTargetWeek(mondayOf(reopened.periodStart))
        setIsDirty(false)
        setV3({ status: "idle" })
      })
      .catch((error: unknown) => {
        if (active) {
          setPersistenceError(
            error instanceof Error ? error.message : "Impossible d’ouvrir le planning."
          )
        }
      })
      .finally(() => {
        if (!active) return
        setIsPersisting(false)
        setOpenedFromUrl(openRequest)
      })

    return () => {
      active = false
    }
  }, [openRequest])

  /**
   * Le planning déjà enregistré pour la semaine et les rayons affichés.
   *
   * L'écran n'ouvrait un planning que si l'adresse en portait l'identifiant —
   * c'est-à-dire en venant du tableau de bord. Cliquer sur « Planning » dans le
   * menu tombait sur une grille vide alors qu'un planning existait pour cette
   * semaine et ce rayon, et rien ne le disait : il fallait deviner qu'il
   * fallait repasser par le tableau de bord.
   *
   * Le chargement suit donc ce qui est AFFICHÉ — semaine et rayons — et non ce
   * que l'adresse contient. Changer de semaine ou de rayon rouvre ce qui y est
   * enregistré, ou vide la grille quand il n'y a rien.
   *
   * TROIS SITUATIONS OÙ IL NE FAUT SURTOUT PAS CHARGER, parce que l'écran
   * porte alors un travail que personne n'a encore enregistré :
   * une génération en cours, un résultat fraîchement produit, ou des retouches
   * non sauvegardées. Les écraser ferait perdre la minute de calcul qu'on vient
   * d'attendre.
   */
  useEffect(() => {
    if (openRequest) return
    if (isDirty || v3.status !== "idle") return
    // Les rayons n'ont pas fini de charger : une sélection vide à cet instant
    // n'est pas un choix, et chercher un planning « sans rayon » n'aurait aucun
    // sens.
    if (selectedSectorIds === null && pickableSectors.length === 0) return

    let active = true

    void planningStore
      .records()
      .then((records) => {
        if (!active) return
        const found = savedPlanningFor(records, targetWeek, selection)

        if (found) {
          if (found.id === record?.id) return
          setRecord(found)
          setEditorState(found.state)
          setIsDirty(false)
          return
        }
        // Rien pour cette semaine et ces rayons : la grille se vide, sinon on
        // lirait le planning de la semaine précédente sous le nouveau titre.
        if (record !== null || editorState !== null) {
          setRecord(null)
          setEditorState(null)
        }
      })
      .catch(() => undefined)

    return () => {
      active = false
    }
  }, [
    openRequest,
    targetWeek,
    selection,
    selectedSectorIds,
    pickableSectors.length,
    isDirty,
    v3.status,
    record,
    editorState,
  ])

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
      return
    }
    setScopeRefusal(null)
    void handleGenerateV3(verdict.scope, regeneration)
  }

  async function handleGenerateV3(
    generationScope: GenerationScope,
    regeneration?: PlanningRegenerationRequest
  ) {
    if (!initialStore) return
    setV3({ status: "running" })

    // Only the selected sector and only the people eligible for it. Passing the
    // whole configuration here is what made an unselected sector able to break
    // a selected one.
    // Les fériés de LA SEMAINE générée, lus au moment de générer. Le dépôt est
    // consulté ici plutôt que gardé en état : le gérant peut régler un férié
    // dans l'autre onglet et revenir générer, et c'est son dernier réglage qui
    // doit valoir.
    const scope = scopeForWeek(targetWeek)
    const holidayPlan = holidayPlanForPeriod(
      scope.period,
      // Relu ici plutôt que pris dans l'état : la génération doit partir du
      // dernier réglage, y compris s'il vient d'être changé dans l'autre onglet
      // pendant que cet écran attendait.
      await holidayStore.read(),
      (date) => {
        const day = initialStore.openingHours.find((hours) => hours.day === weekDayOf(date))
        return day && !day.closed && day.opensAt && day.closesAt
          ? { opensAt: day.opensAt, closesAt: day.closesAt }
          : null
      }
    )

    // Les semaines déjà publiées, dont se déduit l'historique des fermetures.
    // Sans elles, `buildClosingHistory` ne compte rien, tout le monde ressort à
    // égalité et le classement d'équité ne départage personne : le réglage
    // paraît actif alors qu'il n'a aucune matière. Relu au moment de générer,
    // comme les fériés, pour qu'une semaine publiée juste avant compte déjà.
    const savedPlannings = await planningStore.records()

    const prepared = preparePlanningGeneration({
      store: initialStore,
      employees: generationScope.employees,
      sectors: generationScope.sectors,
      scope,
      savedPlannings,
      holidayPlan,
    })
    if (prepared.status === "error") {
      setV3({
        status: "rejected",
        outcome: {
          status: "rejected",
          title: "La configuration ne permet pas de préparer une génération",
          message: "Le planning affiché est inchangé.",
          details: prepared.errors.map((error) => error.message),
        },
      })
      return
    }

    // The reference the locks, the retouches and the stability objective all
    // point at: what is on screen right now, edits included.
    // Switching from Drive to Zone marché (or to a solo counter) is a fresh
    // scope, even on the same week. Reusing Drive locks or stability penalties
    // there would make an unrelated planning constrain the new group.
    const scopedRegeneration = sameSectorScope(
      generationScope.sectorIds,
      editorState?.sectorScope?.sectorIds
    ) ? regeneration : undefined
    const baseline =
      scopedRegeneration !== undefined && editorState !== null
        ? baselineFromEditorState(editorState)
        : undefined

    const outcome = await runV3Generation({
      prepared,
      regeneration: scopedRegeneration,
      baseline,
      solve: { engine: endpointEngineFor() },
    })

    if (outcome.status === "rejected") {
      // NOTHING is touched. Not the editor state, not the record, not the
      // generation report, not the saved plannings. The manager's V2 planning is
      // exactly where they left it, and the only new thing on screen is an
      // explanation and a way out.
      setV3({ status: "rejected", outcome })
      return
    }

    setRecord(null)
    setEditorState(outcome.editorState)
    setIsDirty(true)
    setV3({ status: "accepted", outcome })
  }

  /**
   * TEMPORARY, and deliberately so: a saved planning does not record WHICH
   * engine produced it, nor the V3 validation report.
   *
   * `PlanningRecord` stores an `EditorState` plus the sector selection, and
   * nothing beside it.
   *
   * What that costs is smaller than it was, now that one engine remains: a
   * reopened planning can only have come from that engine. It stops being
   * harmless the day a second one exists, and the fix is one optional field on
   * `PlanningRecord` — the same place `sectorIds` already lives.
   */
  async function persistCurrent(): Promise<PlanningRecord | null> {
    if (!editorState) return null
    const saved = record
      ? await planningStore.save(record.id, editorState, selection)
      // The sector selection is captured here or nowhere: no shift, assignment
      // or planning carries it, so a record saved without it can never feed a
      // sector's closing history.
      : await planningStore.createDraft(editorState, selection)
    setRecord(saved)
    setIsDirty(false)
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

  const busyGenerating = v3.status === "running"

  return (
    <div className="space-y-6">
      {/* LA barre de commande, toujours là et toujours en tête.
          Semaine, rayons, action : elle ne dépend pas de l'existence d'un
          planning, sinon franchir la frontière d'une semaine vide ferait
          disparaître les flèches — au moment précis où l'on veut revenir. */}
      <PlanningBoard
        input={boardInput}
        selectedWeek={targetWeek}
        onChangeWeek={setTargetWeek}
        onSaveRequest={saveAndReport}
        onGenerate={handleGenerate}
        sectorIds={selection}
        sectorChoices={sectorChoices}
        onToggleSector={toggleSector}
        onToggleAllSectors={toggleAllSectors}
        onToggleMarketZone={toggleMarketZone}
        generating={busyGenerating}
        // Deliberately NOT gated by sector readiness. `setup.ready` is a single
        // boolean over every active sector, so one incomplete sector killed the
        // button for every other one — and a dead button explains nothing.
        // Clicking now produces a precise reason. Only a missing or still
        // loading store leaves genuinely nothing to generate from.
        canGenerate={Boolean(initialStore) && !setup.isLoading && !isLoading}
        dirty={isDirty}
        onPersistenceBlockChange={setEditsBlockPersistence}
        // UN SEUL geste, et il est déjà fait ou il reste à faire.
        //
        // Publier, Nouveau brouillon et Archiver ont disparu : trois boutons
        // pour un cycle de vie que personne ne parcourait, et une semaine
        // pouvait rester « enregistrée mais pas publiée » sans que rien ne
        // dise que le travail n'était pas fini. Enregistrer suffit désormais à
        // rendre un rayon affichable ; le bouton grisé DIT que c'est déjà le
        // cas, ce qu'un bouton absent n'aurait pas dit.
        actions={
          <Button
            size="sm"
            onClick={handleSave}
            disabled={isPersisting || !isDirty || editsBlockPersistence}
          >
            {isDirty || editsBlockPersistence ? "Enregistrer" : "Enregistré"}
          </Button>
        }
      />

      {persistenceError ? <p role="alert" className="text-sm text-destructive">{persistenceError}</p> : null}

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

      {/* Rien à dire de la configuration quand aucun rayon n'est choisi.
          Le verdict n'était pas faux, la question l'était : on lui soumettait
          la liste des rayons SÉLECTIONNÉS, donc une liste vide, et il
          répondait « créez au moins un secteur » alors que le magasin en
          compte huit. Une sélection vide est un choix d'affichage, pas un
          défaut de configuration. */}
      {initialStore && !setup.isLoading && selection.length > 0 && !selectionReadiness.ready ? (
        <Card>
          <CardHeader><CardTitle className="text-base">Configuration requise avant la génération</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Complétez les éléments suivants dans le parcours de configuration :</p>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">{selectionReadiness.blockers.map((blocker) => <li key={blocker.message}>{blocker.message}</li>)}</ul>
            <div className="mt-4 flex flex-wrap gap-2"><Button variant="outline" render={<Link href="/configuration/secteurs" />}>Configurer les secteurs</Button><Button variant="outline" render={<Link href="/configuration/employes" />}>Affecter les salariés</Button></div>
          </CardContent>
        </Card>
      ) : null}

      {busyGenerating ? (
        <PlanningGenerationLoader maxSeconds={PLANNING_V3_DEFAULT_TIMEOUT_SECONDS} />
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

      {v3.status === "rejected" ? (
        <Card role="alert" className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-base text-destructive">{v3.outcome.title}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm">{v3.outcome.message}</p>
            {v3.outcome.details.length > 0 ? (
              <ul className="space-y-2 text-sm">
                {v3.outcome.details.map((detail, index) => (
                  <li key={index} className="flex gap-3 rounded-md border border-destructive/20 bg-destructive/5 p-3">
                    <span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-destructive" />
                    <span>{detail}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            {/* No automatic retry and no automatic V2 run. The engine failed;
                what happens next is the manager's decision, not the screen's. */}
            <p className="text-sm text-muted-foreground">
              Votre planning actuel est conservé : aucune tentative automatique ne l’a remplacé.
            </p>
            {/* No automatic retry: the engine failed, and what happens next
                is the manager's decision. There is nothing to fall back TO any
                more, so the only offer is to try again. */}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => handleGenerate()} disabled={busyGenerating}>
                Relancer la génération
              </Button>
            </div>
          </CardContent>
        </Card>
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
/** Le nom du férié qui tombe à cette date, ou la date à défaut. */
function holidayNameOf(date: string): string {
  const year = Number(date.slice(0, 4))
  return frenchHolidaysOf(year).find((holiday) => holiday.date === date)?.name ?? date
}

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
