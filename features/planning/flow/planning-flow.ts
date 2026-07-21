import type { DateRange, OrganizationId, PlanningId } from "@/features/core/models"

import type { BridgeInput, PlanningInput } from "@/features/core/data-bridge"
import { dataBridge } from "@/features/core/data-bridge"
import type { PlanningGenerationResult } from "@/features/core/planning-generator"
import { planningGenerator } from "@/features/core/planning-generator"
import type { StatisticsReport } from "@/features/core/statistics-engine"
import { statisticsService } from "@/features/core/statistics-engine"
import type { StoreConfig } from "@/features/store/schemas/store.schema"
import type { StoreConfiguration } from "@/features/store/models"
import { storeConfigurationService } from "@/features/store/services/store-configuration-service"
import type { EmployeeRecord } from "@/features/employees/types/employee.types"
import type { SectorDemandConfiguration } from "@/features/sectors"
import { effectiveMinimumShiftDuration } from "@/features/sectors"
import type { EmployeeId } from "@/features/core/models"

import type { FlowError } from "@/features/planning/flow/flow-errors"
import { fromMappingErrors, fromZodError } from "@/features/planning/flow/flow-errors"
import {
  DEFAULT_STORE_ID,
  storeConfigurationFromOnboarding,
} from "@/features/planning/flow/store-configuration-from-onboarding"
import { buildDemandInput } from "@/features/planning/flow/demand-builder"

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
}

/** The flow's outcome: a full generation report, or structured errors. */
export type PlanningFlowResult =
  | {
      readonly status: "success"
      readonly configuration: StoreConfiguration
      readonly coreInput: PlanningInput
      readonly generation: PlanningGenerationResult
      readonly statistics: StatisticsReport
      readonly durationMs: number
    }
  | { readonly status: "error"; readonly errors: readonly FlowError[] }

/**
 * runPlanningFlow — the application orchestration for one planning generation.
 * It ONLY orchestrates: it collects data, translates it through the data bridge,
 * configures and runs the existing engines, and returns their reports. It holds
 * no business logic and duplicates no calculation — every figure comes from an
 * engine.
 *
 * Wrapped end-to-end in a try/catch so the UI never crashes: any unexpected
 * failure becomes a structured error.
 */
export function runPlanningFlow(request: PlanningFlowRequest): PlanningFlowResult {
  try {
    // Build StoreConfiguration and validate it.
    const configuration = storeConfigurationFromOnboarding(request.store)
    const configValidation = storeConfigurationService.validate(configuration)
    if (!configValidation.success) {
      return { status: "error", errors: fromZodError(configValidation.error) }
    }

    // Collect application data → build the bridge input (incl. derived demand).
    const demand = buildDemandInput(configuration, request.scope.period, request.scope.planningId, request.sectors)
    const bridgeInput: BridgeInput = {
      store: {
        storeId: DEFAULT_STORE_ID,
        organizationId: brand<OrganizationId>("org_1"),
        configuration,
        address: request.store.address,
        city: request.store.city,
        postalCode: request.store.postalCode,
      },
      employees: request.employees,
      demand,
      scope: request.scope,
    }

    const ambiguousContracts = request.employees.filter((employee) => employee.contractMinuteConfirmationRequired || (employee.weeklyMinutes == null && employee.weeklyHours === 36.5))
    if (ambiguousContracts.length) return { status: "error", errors: ambiguousContracts.map((employee) => ({ code: "legacy_contract_confirmation_required", path: `employees.${employee.id}.weeklyMinutes`, message: `${employee.firstName} ${employee.lastName} : confirmez explicitement 36 h 30 (2 190 min) ou 36 h 45 (2 205 min) avant de générer.` })) }

    // Data Bridge → Core models only.
    const bridged = dataBridge.toPlanningInput(bridgeInput)
    if (!bridged.ok) {
      return { status: "error", errors: fromMappingErrors(bridged.errors) }
    }
    // Integer minutes are authoritative. Legacy decimal hours remain only as a
    // compatibility projection for frozen consumers.
    const coreInput = {
      ...bridged.value,
      contracts: bridged.value.contracts.map((contract) => {
        const employee = request.employees.find((item) => item.id === contract.employeeId)
        const weeklyMinutes = employee?.weeklyMinutes ?? Math.round(contract.weeklyHours * 60)
        return { ...contract, weeklyMinutes, weeklyHours: weeklyMinutes / 60 }
      }),
    }

    // Configure the engines from the store configuration.
    const registry = storeConfigurationService.toConstraintRegistry(configuration)
    const settings = storeConfigurationService.toGenerationSettings(configuration, {
      planningId: brand<PlanningId>(request.scope.planningId),
      period: request.scope.period as DateRange,
      now: request.scope.now,
    })

    // Planning Generator → Constraint / Coverage / Fairness / Scoring engines.
    const started = Date.now()
    const generation = planningGenerator.generate({
      store: coreInput.store,
      employees: coreInput.employees,
      demand: coreInput.demand,
      registry,
      settings,
      contracts: coreInput.contracts,
      availabilityRules: coreInput.availabilityRules,
      absences: coreInput.absences,
      holidays: coreInput.holidays,
      employeeConstraints: coreInput.employeeConstraints,
      business: {
        employeePreferences: request.employees.map((employee) => ({ employeeId: brand<EmployeeId>(employee.id), prefersClosing: employee.preferClosing })),
        sectors: request.sectors?.map((sector) => ({
          id: sector.id,
          name: sector.name,
          active: sector.status === "active",
          weeklyDistribution: sector.weeklyDistribution,
          minimumShiftDuration: effectiveMinimumShiftDuration(sector, request.store) ?? 0,
          splitShiftAllowed: sector.shiftRules.splitShiftAllowed,
          maximumSplitDuration: sector.shiftRules.maximumSplitDuration,
          assignedEmployeeIds: request.employees.filter((employee) => employee.status === "active" && employee.sectors?.includes(sector.name)).map((employee) => brand<EmployeeId>(employee.id)),
          requirementIds: demand.requirements.filter((requirement) => requirement.id.startsWith(`req_${sector.id}_`)).map((requirement) => requirement.id),
          workEveryNonFixedRestDay: sector.workEveryNonFixedRestDay,
          hours: sector.hours,
        })),
      },
    })
    const durationMs = Date.now() - started

    // Statistics Engine — per-employee facts for display (single source of truth).
    const statistics = statisticsService.compute({
      planning: generation.planning,
      employees: coreInput.employees,
      assignments: generation.assignments,
      shifts: generation.shifts,
      store: coreInput.store,
      calendar: { holidays: coreInput.holidays, absences: coreInput.absences },
      coverage: generation.coverage,
    })

    return { status: "success", configuration, coreInput, generation, statistics, durationMs }
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
