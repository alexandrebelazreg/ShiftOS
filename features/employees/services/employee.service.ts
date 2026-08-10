import type { EmployeeDraft } from "@/features/employees/schemas/employee.schema"
import type { EmployeeRecord, EmployeeScheduleType } from "@/features/employees/types/employee.types"
import { WEEK_DAYS } from "@/features/core/models"

/**
 * Mock, in-memory data-access layer for employees.
 *
 * Methods are async to mirror a real API so call sites (hooks) won't change
 * when a backend is introduced. State lives in a module-level array and resets
 * on full page reload — acceptable for a UI-only, no-database phase.
 *
 * Deletion is intentionally NOT supported: employees are disabled, never
 * removed (`disable`).
 */

// A new ShiftOS workspace begins empty; the guided first-run flow creates the team.
let employees: EmployeeRecord[] = []
const EMPLOYEES_KEY = "shiftos_employees"
let hydrated = false

function hydrate(): void {
  if (hydrated) return
  hydrated = true
  if (typeof window === "undefined") return
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(EMPLOYEES_KEY) ?? "[]")
    if (Array.isArray(value)) employees = (value as EmployeeRecord[]).map(normalizeContract)
  } catch { employees = [] }
}

function persist(): void {
  if (typeof window !== "undefined") window.localStorage.setItem(EMPLOYEES_KEY, JSON.stringify(employees))
}

function nextId(): string {
  return `emp_${Math.random().toString(36).slice(2, 10)}`
}

function nowIso(): string {
  return new Date().toISOString()
}

export const employeeService = {
  async list(): Promise<EmployeeRecord[]> {
    hydrate()
    return employees.map((employee) => ({ ...employee }))
  },

  async getById(id: string): Promise<EmployeeRecord | null> {
    hydrate()
    const found = employees.find((employee) => employee.id === id)
    return found ? { ...found } : null
  },

  async create(draft: EmployeeDraft): Promise<EmployeeRecord> {
    hydrate()
    const timestamp = nowIso()
    const employee: EmployeeRecord = {
      ...draft,
      schemaVersion: 2,
      weeklyMinutes: draft.weeklyMinutes ?? Math.round(draft.weeklyHours * 60),
      contractMinuteConfirmationRequired: false,
      scheduleType: draft.scheduleType ?? "variable",
      workingDays: WEEK_DAYS.filter((day) => !draft.fixedDaysOff.includes(day)),
      id: nextId(),
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    employees = [employee, ...employees]
    persist()
    return { ...employee }
  },

  async update(id: string, draft: EmployeeDraft): Promise<EmployeeRecord> {
    hydrate()
    const index = employees.findIndex((employee) => employee.id === id)
    if (index === -1) {
      throw new Error(`Employee not found: ${id}`)
    }
    const updated: EmployeeRecord = {
      ...employees[index],
      ...draft,
      schemaVersion: 2,
      weeklyMinutes: draft.weeklyMinutes ?? Math.round(draft.weeklyHours * 60),
      contractMinuteConfirmationRequired: false,
      scheduleType: draft.scheduleType ?? employees[index].scheduleType ?? "variable",
      workingDays: WEEK_DAYS.filter((day) => !draft.fixedDaysOff.includes(day)),
      id,
      updatedAt: nowIso(),
    }
    employees = employees.map((employee, i) => (i === index ? updated : employee))
    persist()
    return { ...updated }
  },

  /** Soft-disable: set status to "inactive". Never deletes. */
  async disable(id: string): Promise<EmployeeRecord> {
    hydrate()
    const index = employees.findIndex((employee) => employee.id === id)
    if (index === -1) {
      throw new Error(`Employee not found: ${id}`)
    }
    const updated: EmployeeRecord = {
      ...employees[index],
      status: "inactive",
      updatedAt: nowIso(),
    }
    employees = employees.map((employee, i) => (i === index ? updated : employee))
    persist()
    return { ...updated }
  },

  /** Small card-level mutation: changing this classification edits no contract. */
  async setScheduleType(id: string, scheduleType: EmployeeScheduleType): Promise<EmployeeRecord> {
    hydrate()
    const index = employees.findIndex((employee) => employee.id === id)
    if (index === -1) throw new Error(`Employee not found: ${id}`)
    const updated = { ...employees[index], scheduleType, updatedAt: nowIso() }
    employees = employees.map((employee, current) => (current === index ? updated : employee))
    persist()
    return { ...updated }
  },
}

export function normalizeContract(employee: EmployeeRecord): EmployeeRecord {
  const scheduleType = employee.scheduleType ?? "variable"
  if (typeof employee.weeklyMinutes === "number") return { ...employee, scheduleType, schemaVersion: 2, weeklyHours: employee.weeklyMinutes / 60, contractMinuteConfirmationRequired: false }
  if (employee.weeklyHours === 36.5) return { ...employee, scheduleType, schemaVersion: 1, weeklyMinutes: null, contractMinuteConfirmationRequired: true }
  const weeklyMinutes = Math.round(employee.weeklyHours * 60)
  return { ...employee, scheduleType, schemaVersion: 2, weeklyMinutes, weeklyHours: weeklyMinutes / 60, contractMinuteConfirmationRequired: false }
}
