import { ADVANCED_CONSTRAINTS_DEFAULTS } from "@/features/employees/utils/advanced-constraints"
import type { EmployeeDraft } from "@/features/employees/schemas/employee.schema"
import type {
  EmployeeRecord,
  EmployeeFormValues,
} from "@/features/employees/types/employee.types"

/** Blank form values for the "create employee" flow. */
export function createEmptyEmployeeFormValues(): EmployeeFormValues {
  return {
    firstName: "",
    lastName: "",
    phone: "",
    email: "",
    status: "active",

    weeklyHours: "",
    weeklyMinuteRemainder: "0",
    contractConfirmationRequired: false,
    legacyContractMinutes: "",
    contractType: "full_time",
    scheduleType: "variable",
    sectors: [],
    competencies: {},

    // Read from the house rules rather than restated, so the form and the
    // summary that reports departures from them can never disagree.
    ...ADVANCED_CONSTRAINTS_DEFAULTS,
    fixedDaysOff: [],
    forbiddenDays: [],
    maxOpenings: "",
    maxClosings: "",
    earliestStartTime: "",
    latestEndTime: "",
    startTimeIsExact: false,
    endTimeIsExact: false,
    openingDays: [],
    closingDays: [],

    preferOpening: false,
    preferClosing: false,
    notes: "",
  }
}

/** Map a persisted employee into editable form values (numbers → strings). */
export function employeeToFormValues(employee: EmployeeRecord): EmployeeFormValues {
  // The contract is stored in minutes; the form splits it into whole hours plus
  // a 0/15/30/45 remainder.
  const contractMinutes =
    employee.weeklyMinutes ?? Math.round(employee.weeklyHours * 60)

  return {
    firstName: employee.firstName,
    lastName: employee.lastName,
    phone: employee.phone,
    email: employee.email,
    status: employee.status,

    weeklyHours: String(Math.floor(contractMinutes / 60)),
    weeklyMinuteRemainder: String(contractMinutes % 60),
    contractConfirmationRequired: employee.contractMinuteConfirmationRequired === true,
    legacyContractMinutes: "",
    contractType: employee.contractType,
    scheduleType: employee.scheduleType ?? "variable",
    sectors: [...(employee.sectors ?? [])],
    competencies: { ...(employee.competencies ?? {}) },

    canOpen: employee.canOpen,
    canClose: employee.canClose,
    splitShiftAllowed: employee.splitShiftAllowed,
    fixedDaysOff: [...employee.fixedDaysOff],
    forbiddenDays: [...employee.forbiddenDays],
    maxOpenings: employee.maxOpenings === null ? "" : String(employee.maxOpenings),
    maxClosings: employee.maxClosings === null ? "" : String(employee.maxClosings),
    // Employees saved before the advanced constraints existed carry neither
    // field; an absent bound and an empty one are the same "no restriction".
    earliestStartTime: employee.earliestStartTime ?? "",
    latestEndTime: employee.latestEndTime ?? "",
    startTimeIsExact: employee.startTimeIsExact ?? false,
    endTimeIsExact: employee.endTimeIsExact ?? false,
    openingDays: [...(employee.openingDays ?? [])],
    closingDays: [...(employee.closingDays ?? [])],

    preferOpening: employee.preferOpening,
    preferClosing: employee.preferClosing,
    notes: employee.notes,
  }
}

/**
 * The Zod-validated draft already matches the entity fields — this is a thin
 * pass-through kept as a single place to adapt if the shapes diverge later.
 */
export function draftToEntityFields(draft: EmployeeDraft): EmployeeDraft {
  return draft
}
