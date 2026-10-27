import { previousWorkFromRecords } from "@/features/planning/flow/previous-work"
import type {
  DateRange,
  HolidayPlanEntry,
  IsoDate,
  OrganizationId,
  PlanningId,
} from "@/features/core/models"

import type { BridgeInput, PlanningInput } from "@/features/core/data-bridge"
import { dataBridge } from "@/features/core/data-bridge"
import type {
  GenerationSettings,
  PlanningGenerationInput,
} from "@/features/core/planning-generator"
import type { StoreConfig } from "@/features/store/schemas/store.schema"
import type { StoreConfiguration } from "@/features/store/models"
import { storeConfigurationService } from "@/features/store/services/store-configuration-service"
import { employeesDuring } from "@/features/employees/models/contract-arrangement"
import type { EmployeeRecord } from "@/features/employees/types/employee.types"
import type { SectorDemandConfiguration } from "@/features/sectors"
import { effectiveMinimumShiftDuration, effectiveWeeklyDistribution } from "@/features/sectors"
import { holidayImpact, weeklyTargetAfterHolidays } from "@/features/planning/holidays/model/holiday-plan"
import { isSunday } from "@/features/planning/holidays/model/holiday-schedule"
import { timeToMinutes, weekDayOf } from "@/features/core/shared"
import type { EmployeeId } from "@/features/core/models"

import type { FlowError } from "@/features/planning/flow/flow-errors"
import { fromMappingErrors, fromZodError } from "@/features/planning/flow/flow-errors"
import {
  DEFAULT_STORE_ID,
  storeConfigurationFromOnboarding,
} from "@/features/planning/flow/store-configuration-from-onboarding"
import { buildDemandInput } from "@/features/planning/flow/demand-builder"
import { buildClosingHistory } from "@/features/planning/closing-history/build-closing-history"
import type { PlanningRecord } from "@/features/planning/persistence/planning-record"
import { eligibleEmployees } from "@/features/planning/flow/generation-scope"
import { resolveHolidaySectorDay } from "@/features/planning/holidays/model/holiday-sector-day"
import {
  planningAbsences,
  snapToStep,
  weeklyTargetAfterAbsences,
} from "@/features/planning/flow/absence-target"
import type { AbsenceRecord } from "@/features/absences/types/absence-record"

function brand<T>(value: string): T {
  return value as unknown as T
}

/** The run scope the UI supplies: which planning, over what horizon, at what clock. */
export interface PlanningScope {
  readonly planningId: string
  readonly period: { readonly start: string; readonly end: string }
  readonly now: string
}

/** Everything the flow needs, collected by the application. */
export interface PlanningFlowRequest {
  readonly store: StoreConfig
  readonly employees: readonly EmployeeRecord[]
  readonly sectors?: readonly SectorDemandConfiguration[]
  readonly scope: PlanningScope
  /**
   * Plannings already saved, for the closing history.
   *
   * Passed in rather than fetched: the flow orchestrates, it owns no
   * repository, and a test must be able to state exactly which weeks exist.
   *
   * OBLIGATOIRE, et le tableau vide est la façon de dire « aucune semaine ».
   * Le champ a longtemps été optionnel, et personne ne le remplissait : l'écran
   * de planning appelait sans lui, l'historique sortait vide, et l'équité des
   * fermetures se réglait sans jamais rien départager. Rien ne le signalait —
   * un historique vide est indistinguable d'un magasin qui démarre. L'exiger
   * force chaque appelant à dire laquelle des deux situations est la sienne.
   */
  readonly savedPlannings: readonly PlanningRecord[]
  /**
   * Les jours fériés de la période, tels que le magasin les a réglés.
   *
   * Fourni plutôt que lu, comme l'historique des fermetures : le flux orchestre,
   * il ne possède aucun dépôt. Absent, rien ne change — ni la disponibilité, ni
   * les objectifs, ni le problème construit.
   */
  readonly holidayPlan?: readonly HolidayPlanEntry[]
  /**
   * Les absences enregistrées, toutes périodes et tous salariés confondus.
   *
   * OBLIGATOIRE, pour la même raison que `savedPlannings` : le champ existait
   * dans le pont depuis le début et personne ne le remplissait. Un salarié en
   * congé était replanifié, et rien ne le signalait — une semaine sans absence
   * ressemble exactement à une semaine dont on a oublié les absences. Le
   * tableau vide est la façon de dire « personne n'est absent ».
   */
  readonly absences: readonly AbsenceRecord[]
}

/**
 * `runPlanningFlow` is gone with the V2 pipeline.
 *
 * It ran `planningGenerator.generate` in process and returned a finished week.
 * There is no in-process generator any more: the one engine answers over the
 * solve endpoint, so a generation is `preparePlanningGeneration` followed by
 * `runV3Generation`, and the two steps are deliberately separate — assembling
 * the input is synchronous and testable, running an engine is neither.
 */

/** Everything assembled for a run, before any engine has been chosen. */
export type PreparedPlanningGeneration =
  | {
      readonly status: "ready"
      readonly configuration: StoreConfiguration
      /**
       * Employment contracts kept for the editor and the board.
       *
       * A generation restricted to one automatically distributed sector can
       * use smaller sector targets in `generationInput`; those targets must
       * never replace the employees' real contracts on screen.
       */
      readonly coreInput: PlanningInput
      readonly settings: GenerationSettings
      /** The scoped input the V3 problem is built from. */
      readonly generationInput: PlanningGenerationInput
      /** Targets of this generation scope when it covers only part of a contract. */
      readonly weeklyTargets?: readonly {
        readonly employeeId: EmployeeId
        readonly minutes: number
        readonly kind: "sector-allocation"
      }[]
    }
  | { readonly status: "error"; readonly errors: readonly FlowError[] }

/**
 * Everything up to the moment the engine runs — and nothing after it.
 *
 * It was extracted from `runPlanningFlow` back when two engines had to consume
 * byte-identical input, and it outlived both the split and `runPlanningFlow`
 * itself, because the reason for the seam was never the second engine: the
 * assembly is synchronous, pure and testable, while running an engine is none
 * of those. Keeping them apart is what lets a test state exactly which week is
 * being posed without spawning a subprocess to find out.
 */
export function preparePlanningGeneration(
  request: PlanningFlowRequest
): PreparedPlanningGeneration {
  try {
    const selectedSectors = (request.sectors ?? []).filter((sector) => sector.status === "active")
    // Les aménagements temporaires — mi-temps thérapeutique et semblables — sont
    // appliqués ICI, une fois, avant tout le reste : contrats, contraintes,
    // préférences et historique lisent ensuite un salarié ordinaire, et rien en
    // aval n'a besoin de connaître la notion.
    //
    // Sans aménagement en vigueur, `employeesDuring` rend les enregistrements
    // INCHANGÉS — c'est ce qui garantit qu'aucun planning existant ne bouge.
    const eligible = request.sectors === undefined
      ? request.employees
      : eligibleEmployees(request.employees, selectedSectors)
    const planningEmployees = employeesDuring(eligible, request.scope.period.start)

    // Build StoreConfiguration and validate it.
    const configuration = storeConfigurationFromOnboarding(request.store)
    const configValidation = storeConfigurationService.validate(configuration)
    if (!configValidation.success) {
      return { status: "error", errors: fromZodError(configValidation.error) }
    }

    // Les fériés de la période, ramenés à ce que chaque contrat doit encore
    // porter. Un jour férié retire une journée à ce que le moteur a À PLACER,
    // que ces heures soient perdues (JF, horaires variables) ou dues en heures
    // fériées (HF, horaires fixes) : dans les deux cas elles ne se planifient
    // pas, et les laisser dans l'objectif tasserait un contrat entier sur six
    // jours. Ce que la paie en fait se lit dans les codes, pas ici.
    const holidayPlan = (request.holidayPlan ?? []).filter(
      (entry) =>
        entry.date >= request.scope.period.start && entry.date <= request.scope.period.end
    )

    // Collect application data → build the bridge input (incl. derived demand).
    // Les fériés d'abord : un rayon qui règle son jour férié pose son propre
    // besoin ce jour-là, et la demande doit le lire.
    const demand = buildDemandInput(configuration, request.scope.period, request.scope.planningId, request.sectors, holidayPlan)
    const bridgeInput: BridgeInput = {
      store: {
        storeId: DEFAULT_STORE_ID,
        organizationId: brand<OrganizationId>("org_1"),
        configuration,
        address: request.store.address,
        city: request.store.city,
        postalCode: request.store.postalCode,
      },
      employees: planningEmployees,
      demand,
      absences: planningAbsences(
        request.absences,
        new Set(planningEmployees.map((employee) => employee.id)),
        request.scope.period
      ),
      scope: request.scope,
    }

    const ambiguousContracts = planningEmployees.filter((employee) => employee.contractMinuteConfirmationRequired || (employee.weeklyMinutes == null && employee.weeklyHours === 36.5))
    if (ambiguousContracts.length) return { status: "error", errors: ambiguousContracts.map((employee) => ({ code: "legacy_contract_confirmation_required", path: `employees.${employee.id}.weeklyMinutes`, message: `${employee.firstName} ${employee.lastName} : confirmez explicitement 36 h 30 (2 190 min) ou 36 h 45 (2 205 min) avant de générer.` })) }

    // Data Bridge → Core models only.
    const bridged = dataBridge.toPlanningInput(bridgeInput)
    if (!bridged.ok) {
      return { status: "error", errors: fromMappingErrors(bridged.errors) }
    }
    // Integer minutes are authoritative. Legacy decimal hours remain only as a
    // compatibility projection for frozen consumers.
    // Lus avant les contrats : l'objectif de chacun se ramène sur le pas de la
    // grille, et c'est ce réglage qui le donne.
    const settings = storeConfigurationService.toGenerationSettings(configuration, {
      planningId: brand<PlanningId>(request.scope.planningId),
      period: request.scope.period as DateRange,
      now: request.scope.now,
    })
    const step =
      settings.timeIncrementMinutes ?? bridged.value.store.planningSettings.granularity ?? 15
    const isOpen = (date: IsoDate): boolean => {
      const day = request.store.openingHours.find((hours) => hours.day === weekDayOf(date))
      return day !== undefined && !day.closed
    }

    const coreInput = {
      ...bridged.value,
      contracts: bridged.value.contracts.map((contract) => {
        const employee = planningEmployees.find((item) => item.id === contract.employeeId)
        const contractMinutes = employee?.weeklyMinutes ?? Math.round(contract.weeklyHours * 60)
        const impacts = holidayPlan.map((entry) =>
          holidayImpact({
            entry,
            employeeId: String(contract.employeeId),
            profile: {
              scheduleType: employee?.scheduleType,
              student: employee?.student,
              forfaitJour: employee?.forfaitJour,
            },
            contractMinutes,
            sunday: isSunday(entry.date),
            storeOpensSundays: storeOpensSundays(request.store),
            usuallyWorksSundays: !(employee?.fixedDaysOff ?? []).includes("sunday"),
            usualRestDay: (employee?.fixedDaysOff ?? []).includes(weekDayOf(entry.date)),
          })
        )
        const afterHolidays = weeklyTargetAfterHolidays(contractMinutes, impacts)
        // Les fériés qui ont DÉJÀ retiré quelque chose à CE salarié — et à lui
        // seul. Un volontaire n'en perd aucune heure : il est censé travailler
        // ce jour-là. Tous les fériés étaient sautés pour tout le monde, si bien
        // qu'un volontaire en arrêt maladie gardait sa journée fériée dans son
        // objectif, sans aucun jour pour la placer : semaine impossible.
        const holidayDates = new Set<string>(
          impacts.filter((impact) => impact.reducedMinutes > 0).map((impact) => String(impact.date))
        )
        // Puis les absences, et l'ensemble ramené sur la grille une seule fois,
        // à la fin : arrondir chaque déduction séparément cumulerait les écarts.
        const afterAbsences = weeklyTargetAfterAbsences({
          contractMinutes,
          targetMinutes: afterHolidays,
          workingDays: contract.workingDays,
          fixedDaysOff: employee?.fixedDaysOff ?? [],
          period: request.scope.period,
          isOpen,
          holidayDates,
          absences: (bridgeInput.absences ?? []).filter(
            (absence) => absence.employeeId === String(contract.employeeId)
          ),
        })
        const weeklyMinutes =
          afterAbsences === contractMinutes ? contractMinutes : snapToStep(afterAbsences, step)
        return { ...contract, weeklyMinutes, weeklyHours: weeklyMinutes / 60 }
      }),
    }

    // The generation scope has already retained only employees whose FIRST
    // sector belongs to the selected scope. Their complete contracts now belong
    // to that run: a solo Charcuterie planning uses the full contracts of its
    // Charcuterie-first team, and a Zone marché run counts every shared contract
    // once across the whole group. Demand remains a coverage target, not a cap.
    const planningCoreInput = coreInput

    // Configure the engines from the store configuration.
    const registry = storeConfigurationService.toConstraintRegistry(configuration)

    const generationInput: PlanningGenerationInput = {
      store: planningCoreInput.store,
      employees: planningCoreInput.employees,
      demand: planningCoreInput.demand,
      registry,
      settings,
      contracts: planningCoreInput.contracts,
      availabilityRules: planningCoreInput.availabilityRules,
      absences: planningCoreInput.absences,
      holidays: planningCoreInput.holidays,
      // Absent, le constructeur retombe sur `holidays` et construit exactement
      // le problème qu'il construisait avant.
      ...(holidayPlan.length > 0 ? { holidayPlan } : {}),
      employeeConstraints: planningCoreInput.employeeConstraints,
      // Reduced here, from records the caller supplied, and handed to the core
      // as integers. The builder owns no repository and neither does any solver.
      previousWork: previousWorkFromRecords(request.savedPlannings, request.scope.period.start,
        Math.round((request.store.minRestBetweenShifts ?? 0) * 60)),
      closingHistory: closingHistoryFor({ ...request, employees: planningEmployees }),
      business: {
        // Calls that predate sector-aware planning remain an explicit V2 API
        // shape. Once sectors are supplied (including []), Sprint 3D is mandatory.
        pipelineMode: request.sectors === undefined ? "legacy-v2" : "sprint-3d",
        employeePreferences: planningEmployees.map((employee) => ({
          employeeId: brand<EmployeeId>(employee.id),
          prefersClosing: employee.preferClosing,
          ...(employee.preferOpening ? { prefersOpening: true } : {}),
          ...timePreferences(employee),
          sectorIds: (employee.sectors ?? []).flatMap((name) => {
            const sector = request.sectors?.find((entry) => entry.name === name)
            return sector ? [sector.id] : []
          }),
        })),
        sectors: request.sectors?.map((sector) => ({
          id: sector.id,
          name: sector.name,
          active: sector.status === "active",
          weeklyDistribution: effectiveWeeklyDistribution(sector),
          // Historical sectors (the Drive included) keep the exact daily
          // distribution they were already solving.  Only a sector whose
          // manager disabled the daily percentages receives flexible targets.
          // This boundary is deliberately decided before the multi-sector
          // builder: adding another feature must not silently move the Drive
          // onto the much wider flexible-allocation search.
          ...(sector.weeklyDistributionEnabled === false
            ? { dailyBudgetMode: "target" as const }
            : {}),
          minimumShiftDuration: effectiveMinimumShiftDuration(sector, request.store) ?? 0,
          splitShiftAllowed: sector.shiftRules.splitShiftAllowed,
          maximumSplitDuration: sector.shiftRules.maximumSplitDuration,
          maximumOpeningsPerWeek: sector.shiftRules.maximumOpeningsPerWeek ?? null,
          maximumClosingsPerWeek: sector.shiftRules.maximumClosingsPerWeek ?? null,
          maximumDailyDuration: sector.shiftRules.maximumDailyDuration,
          maximumContinuousDuration: sector.shiftRules.maximumContinuousDuration,
          minimumSplitDuration: sector.shiftRules.minimumSplitDuration,
          maximumSplitsPerDay: sector.shiftRules.maximumSplitsPerDay,
          minimumOpeningsPerDay: sector.shiftRules.minimumOpeningsPerDay,
          requiredClosingsPerDay: sector.shiftRules.requiredClosingsPerDay,
          minimumRestMinutes: sector.shiftRules.minimumRestMinutes,
          closingFairness: sector.closingFairness,
          // The unbreakable floors, translated into the shape the builder reads.
          // An entry covering every open day carries no `day`; one covering the
          // whole opening carries neither `from` nor `to`.
          minimumPresence: sector.minimumPresence.flatMap((rule) =>
            (rule.days.length === 0 ? [undefined] : rule.days).map((day) => ({
              ...(day === undefined ? {} : { day }),
              ...(rule.from === null ? {} : { from: rule.from }),
              ...(rule.to === null ? {} : { to: rule.to }),
              employees: rule.employees,
            }))
          ),
          assignedEmployeeIds: planningEmployees
            .filter((employee) => employee.status === "active" && employee.sectors?.includes(sector.name))
            .map((employee) => employee.id)
            .map((employeeId) => brand<EmployeeId>(employeeId)),
          requirementIds: demand.requirements.filter((requirement) => requirement.id.startsWith(`req_${sector.id}_`)).map((requirement) => requirement.id),
          workEveryNonFixedRestDay: sector.workEveryNonFixedRestDay,
          hours: sector.hours,
          ...holidayHoursOf(sector, holidayPlan),
        })),
      },
    }

    // The solver needs the scoped sector quotas above. The board needs the
    // same selected roster, but with the employment contracts restored. Mixing
    // these two values is what made a 21 h Fruits allocation appear as a
    // 21 h employment contract (and display a false green tick).
    const employmentContractByEmployee = new Map(
      coreInput.contracts.map((contract) => [String(contract.employeeId), contract])
    )
    const editorCoreInput: PlanningInput = {
      ...planningCoreInput,
      contracts: planningCoreInput.contracts.map(
        (contract) => employmentContractByEmployee.get(String(contract.employeeId)) ?? contract
      ),
    }
    return {
      status: "ready",
      configuration,
      coreInput: editorCoreInput,
      settings,
      generationInput,
    }
  } catch (error) {
    return {
      status: "error",
      errors: [
        {
          code: "unexpected_error",
          path: "",
          message: error instanceof Error ? error.message : "Unexpected error during generation",
        },
      ],
    }
  }
}

/**
 * The closing history the generated week is measured against.
 *
 * Une série indépendante par rayon : un salarié partagé qui ferme Fruits
 * n'est pas enregistré comme fermeur de Charcuterie au même instant.
 */
/**
 * Le magasin ouvre-t-il HABITUELLEMENT le dimanche ?
 *
 * L'ouverture ordinaire, pas celle du dimanche férié lui-même : c'est elle que
 * le second tableau de la documentation interroge pour décider entre un repos
 * hebdomadaire et des heures fériées.
 */
/**
 * Les horaires de CE rayon les jours fériés de la période, quand il en règle.
 *
 * Absent pour un rayon qui n'a ni jour férié type ni ajustement : le
 * constructeur garde alors les horaires de férié du magasin, comme avant.
 */
function holidayHoursOf(
  sector: SectorDemandConfiguration,
  holidayPlan: readonly HolidayPlanEntry[]
) {
  const entries = holidayPlan.flatMap((entry) => {
    const day = resolveHolidaySectorDay(entry, sector)
    if (day === null) return []
    return [[String(entry.date), {
      closed: day.closed,
      opensAtMinutes: day.closed ? null : timeToMinutes(day.opensAt),
      closesAtMinutes: day.closed ? null : timeToMinutes(day.closesAt),
    }] as const]
  })
  return entries.length > 0 ? { holidayHours: Object.fromEntries(entries) } : {}
}

/**
 * Les heures souhaitées de la fiche, en minutes. Une moitié manquante — un sens
 * sans heure, une heure illisible — ne produit rien plutôt qu'un souhait deviné.
 */
function timePreferences(employee: EmployeeRecord) {
  const read = (side?: "before" | "after" | null, time?: string | null) => {
    if (!side || !time) return undefined
    const minutes = timeToMinutes(time)
    return minutes === null ? undefined : { side, minutes }
  }
  const start = read(employee.preferredStartSide, employee.preferredStartTime)
  const end = read(employee.preferredEndSide, employee.preferredEndTime)
  return {
    ...(start ? { preferredStart: start } : {}),
    ...(end ? { preferredEnd: end } : {}),
  }
}

function storeOpensSundays(store: StoreConfig): boolean {
  const sunday = store.openingHours.find((hours) => hours.day === "sunday")
  return sunday !== undefined && !sunday.closed
}

function closingHistoryFor(request: PlanningFlowRequest) {
  const sectors = (request.sectors ?? []).filter((sector) => sector.status === "active")
  return sectors.flatMap((sector) => {
    const fairness = sector.closingFairness
    if (!fairness.balanceClosings && !fairness.balanceSaturdayClosings) return []
    return buildClosingHistory({
      records: request.savedPlannings,
      sectorId: sector.id,
      weekStart: request.scope.period.start as IsoDate,
      lookbackWeeks: fairness.lookbackWeeks,
      employeeIds: request.employees
        .filter((employee) => employee.status === "active" && employee.sectors?.includes(sector.name))
        .map((employee) => employee.id),
      minimumRestMinutes:
        sector.shiftRules.minimumRestMinutes ?? Math.round((request.store.minRestBetweenShifts ?? 0) * 60),
    }).map((entry) => ({
      ...entry,
      sectorId: sector.id,
      employeeId: brand<EmployeeId>(String(entry.employeeId)),
    }))
  })
}
