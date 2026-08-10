import type { Assignment, Shift, StoreId } from "@/features/core/models"
import { buildEmptyPlanning } from "@/features/core/planning-generator"
import type { EmployeeRecord } from "@/features/employees/types/employee.types"
import type { StoreConfig } from "@/features/store/schemas/store.schema"

import { createEditorState, type EditorState } from "@/features/planning/editor"
import { preparePlanningGeneration, type PlanningScope } from "@/features/planning/flow"

/**
 * An `EditorState` built WITHOUT running an engine.
 *
 * These fixtures used to call `runPlanningFlow`, which generated a real week
 * through the V2 pipeline and handed back its output. That was convenient and
 * quietly wrong for the tests that used it: the editor and the persistence
 * layer do not care how a schedule was produced, and pinning them to an engine
 * meant an engine change broke tests about neither. It also meant they could
 * not run at all once the in-process generator was deleted.
 *
 * So the shifts are placed here, by hand and by rule: one block per employee
 * per open day, sized to their contract and STAGGERED across the opening window
 * so the first starts at opening and the last ends at closing. Two properties
 * follow, and both are what the tests using this actually depend on: the week
 * matches every contract, and the floor is covered end to end. A fixture that
 * quietly broke either would make every test assert around a warning it never
 * meant to create.
 *
 * Deterministic, engine-free and readable — if a test about moving a shift
 * fails, the shift it moved is right here.
 */
export function editorStateFixture(options: {
  readonly store: StoreConfig
  readonly employees: readonly EmployeeRecord[]
  readonly scope: PlanningScope
  /**
   * Minutes each placed shift lasts. Defaults to the employee's contracted week
   * spread evenly over the open days, which is what makes the fixture evaluate
   * GREEN — a fixture that quietly breaks the contract would make every test
   * using it assert around a warning it never meant to create.
   */
  readonly shiftMinutes?: number
}): EditorState {
  const prepared = preparePlanningGeneration({
    store: options.store,
    employees: options.employees,
    scope: options.scope,
  })
  if (prepared.status === "error") {
    throw new Error(
      `Fixture impossible à préparer : ${prepared.errors.map((error) => error.message).join(" | ")}`
    )
  }

  const { coreInput, configuration, settings } = prepared
  const storeId = coreInput.store.id as StoreId
  const planning = buildEmptyPlanning(storeId, settings)

  const openDates = datesBetween(options.scope.period.start, options.scope.period.end).filter(
    (date) => {
      const day = coreInput.store.openingHours.find((entry) => entry.day === weekDayOf(date))
      return day !== undefined && !day.closed && day.opensAt !== null
    }
  )

  const shifts: Shift[] = []
  const assignments: Assignment[] = []
  const step = 15

  /** The employee's week, split evenly across the open days and put on the step. */
  const dailyMinutesFor = (employeeId: string): number => {
    if (options.shiftMinutes !== undefined) return options.shiftMinutes
    const contract = coreInput.contracts.find((entry) => String(entry.employeeId) === employeeId)
    const weekly = contract?.weeklyMinutes ?? Math.round((contract?.weeklyHours ?? 35) * 60)
    if (openDates.length === 0) return 0
    return Math.round(weekly / openDates.length / step) * step
  }

  for (const [dayIndex, date] of openDates.entries()) {
    const hours = coreInput.store.openingHours.find((entry) => entry.day === weekDayOf(date))!
    const opensAt = hours.opensAt ?? "09:00"
    const closesAt = hours.closesAt ?? "17:00"
    const window = minutesOf(closesAt) - minutesOf(opensAt)
    const people = coreInput.employees.length

    for (const [index, employee] of coreInput.employees.entries()) {
      const minutes = dailyMinutesFor(String(employee.id))
      // Spread the starts from opening to "as late as still ends at closing",
      // and ROTATE the order day by day. Without the rotation the same person
      // opens every morning and the same person locks up every evening, which
      // is a legal week and a plainly unfair one — the fairness engine says so,
      // and every test built on this fixture would then be asserting around a
      // warning the fixture created rather than the case under test.
      const slack = Math.max(0, window - minutes)
      const rotated = people <= 1 ? 0 : (index + dayIndex) % people
      const offset = people <= 1 ? 0 : Math.round((slack * rotated) / (people - 1) / step) * step
      const startsAt = addMinutes(opensAt, offset)
      const shiftId = `shift_${date}_${String(employee.id)}`
      shifts.push({
        id: shiftId as Shift["id"],
        storeId,
        templateId: null,
        date: date as Shift["date"],
        source: "dynamic",
        segments: [{ startTime: startsAt, endTime: addMinutes(startsAt, minutes) }],
        createdAt: settings.now,
        updatedAt: settings.now,
      })
      assignments.push({
        id: `assignment_${shiftId}` as Assignment["id"],
        planningId: planning.id,
        shiftId: shiftId as Shift["id"],
        employeeId: employee.id,
        status: "confirmed",
        createdAt: settings.now,
        updatedAt: settings.now,
      })
    }
  }

  return createEditorState({ coreInput, configuration, planning, shifts, assignments })
}

const WEEK_DAY_BY_INDEX = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const

function weekDayOf(date: string) {
  return WEEK_DAY_BY_INDEX[new Date(`${date}T00:00:00Z`).getUTCDay()]
}

function datesBetween(start: string, end: string): string[] {
  const dates: string[] = []
  for (
    let time = Date.parse(`${start}T00:00:00Z`);
    time <= Date.parse(`${end}T00:00:00Z`);
    time += 24 * 60 * 60 * 1000
  ) {
    dates.push(new Date(time).toISOString().slice(0, 10))
  }
  return dates
}

function minutesOf(time: string): number {
  const [hours, mins] = time.split(":").map(Number)
  return hours * 60 + mins
}

function addMinutes(time: string, minutes: number): string {
  const [hours, mins] = time.split(":").map(Number)
  const total = hours * 60 + mins + minutes
  return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`
}
