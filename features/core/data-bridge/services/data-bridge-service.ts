import type {
  BridgeInput,
  MappingResult,
  PlanningInput,
} from "@/features/core/data-bridge/types"
import { validateBridgeInput } from "@/features/core/data-bridge/validators"
import {
  mapAbsence,
  mapAvailabilityRule,
  mapContract,
  mapDemand,
  mapEmployee,
  mapEmployeeConstraints,
  mapHolidays,
  mapStore,
} from "@/features/core/data-bridge/mappers"
import { toDemandId } from "@/features/core/data-bridge/adapters"

/**
 * DataBridge — the single translation layer between the App and the Core.
 *
 * It VALIDATES the application payload, then TRANSLATES it into core models. It
 * never calculates, evaluates, scores or generates: the output is pure domain
 * data (`PlanningInput`) the Planning Generator can consume without ever seeing
 * an application model.
 *
 * `toPlanningInput` fails fast: if validation finds any problem it returns the
 * structured errors and maps nothing, so a caller never acts on a half-translated
 * payload.
 */
export interface DataBridge {
  toPlanningInput(input: BridgeInput): MappingResult<PlanningInput>
  /** Just the validation pass, for previewing problems before translating. */
  validate(input: BridgeInput): MappingResult<BridgeInput>
}

export const dataBridge: DataBridge = {
  validate(input: BridgeInput): MappingResult<BridgeInput> {
    const errors = validateBridgeInput(input)
    return errors.length > 0 ? { ok: false, errors } : { ok: true, value: input }
  },

  toPlanningInput(input: BridgeInput): MappingResult<PlanningInput> {
    const errors = validateBridgeInput(input)
    if (errors.length > 0) return { ok: false, errors }

    const { store, scope } = input
    const { now } = scope
    const storeId = store.storeId
    const config = store.configuration

    const value: PlanningInput = {
      store: mapStore(store, now),
      employees: input.employees.map((record) => mapEmployee(record, storeId, now)),
      contracts: input.employees.map((record) => mapContract(record, config, now)),
      employeeConstraints: input.employees.flatMap((record) =>
        mapEmployeeConstraints(record)
      ),
      availabilityRules: (input.availabilityRules ?? []).map((rule) =>
        mapAvailabilityRule(rule, now)
      ),
      absences: (input.absences ?? []).map((absence) => mapAbsence(absence, now)),
      holidays: mapHolidays(config, storeId, now),
      demand: input.demand
        ? mapDemand(input.demand, storeId)
        : { id: toDemandId(`demand_${scope.planningId}`), storeId, requirements: [] },
    }

    return { ok: true, value }
  },
}
