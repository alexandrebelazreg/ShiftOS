import type {
  AvailabilityRule,
  IsoDate,
  TimeWindow,
  WeekDay,
} from "@/features/core/models"
import { enumerateDates, isDateInRange, weekDayOf } from "@/features/core/shared"

import type {
  AvailabilityWindow,
  DailyAvailability,
  EmployeeAvailability,
} from "@/features/core/employee-engine/models"
import type {
  AvailabilityCalculator,
  AvailabilityInput,
} from "@/features/core/employee-engine/calculators/availability-calculator"
import type { UnavailableReason } from "@/features/core/employee-engine/types"

function unavailable(
  date: IsoDate,
  weekDay: WeekDay,
  reason: UnavailableReason
): DailyAvailability {
  return { date, weekDay, status: "unavailable", unavailableReason: reason, windows: [] }
}

function ruleMatchesDate(rule: AvailabilityRule, date: IsoDate): boolean {
  if (rule.kind === "date") return rule.date === date
  if (rule.kind === "date_range") {
    return rule.range != null && isDateInRange(date, rule.range.start, rule.range.end)
  }
  return false
}

/**
 * The production AvailabilityCalculator.
 *
 * Resolves availability for every calendar date in the period from facts already
 * modeled in the core: store schedule + holidays, contract working days,
 * employee constraints, absences and availability rules. It invents no business
 * rule; each `unavailable` day carries the exact reason.
 *
 * Precedence (first match wins). Physical/organizational closure and explicit
 * per-date decisions rank above the recurring weekly pattern:
 *   1. store closed        → store_closed
 *   2. public holiday      → public_holiday
 *   3. date rule OFF       → date_exception   (one-day / temporary unavailability)
 *   4. absence covers date → absence
 *   5. date rule ON        → available         (one-day exceptional availability)
 *   6. no contract         → missing_contract
 *   7. not a working day   → not_a_working_day (recurring rules can add/remove days)
 *   8. forbidden day       → forbidden_day
 *   9. fixed day off       → fixed_day_off
 *  10. otherwise           → available (store window, or the rule's window)
 */
export const availabilityCalculator: AvailabilityCalculator = {
  calculate(input: AvailabilityInput): EmployeeAvailability {
    const { employeeId, period, store, contract, constraints } = input

    const scheduleByDay = new Map(store.openingHours.map((s) => [s.day, s]))
    const holidayDates = new Set(
      input.holidays
        .filter((h) => h.storeId === store.id)
        .map((h) => h.date)
    )
    const absences = input.absences.filter((a) => a.employeeId === employeeId)
    const rules = input.availabilityRules.filter((r) => r.employeeId === employeeId)
    const dayConstraints = constraints.filter(
      (c) => c.employeeId === employeeId && c.day != null
    )

    const days: DailyAvailability[] = enumerateDates(period.start, period.end).map(
      (date) => {
        const weekDay = weekDayOf(date)
        const schedule = scheduleByDay.get(weekDay)

        // 1. Store closed that weekday.
        if (
          !schedule ||
          schedule.closed ||
          schedule.opensAt === null ||
          schedule.closesAt === null
        ) {
          return unavailable(date, weekDay, "store_closed")
        }

        const storeWindow: AvailabilityWindow = {
          start: schedule.opensAt,
          end: schedule.closesAt,
        }

        // 2. Public holiday.
        if (holidayDates.has(date)) {
          return unavailable(date, weekDay, "public_holiday")
        }

        // Gather the date-specific and recurring rules that apply.
        const dateRuleOff = rules.find(
          (r) => r.effect === "unavailable" && ruleMatchesDate(r, date)
        )
        const dateRuleOn = rules.find(
          (r) => r.effect === "available" && ruleMatchesDate(r, date)
        )
        const recurringOff = rules.find(
          (r) =>
            r.effect === "unavailable" &&
            r.kind === "recurring" &&
            r.weekDay === weekDay
        )
        const recurringOn = rules.find(
          (r) =>
            r.effect === "available" &&
            r.kind === "recurring" &&
            r.weekDay === weekDay
        )

        // 3. Explicit one-day / range unavailability.
        if (dateRuleOff) return unavailable(date, weekDay, "date_exception")

        // 4. Absence.
        if (
          absences.some((a) =>
            isDateInRange(date, a.range.start, a.range.end)
          )
        ) {
          return unavailable(date, weekDay, "absence")
        }

        // 5. Explicit one-day exceptional availability (overrides weekly rules).
        if (dateRuleOn) {
          return availableDay(date, weekDay, dateRuleOn.window ?? null, storeWindow)
        }

        // 6. No contract → cannot establish working days.
        if (contract === null) {
          return unavailable(date, weekDay, "missing_contract")
        }

        // 7. Weekly working pattern (recurring rules can add or remove a day).
        const baseAvailable =
          (contract.workingDays.includes(weekDay) || recurringOn != null) &&
          recurringOff == null
        if (!baseAvailable) {
          return unavailable(date, weekDay, "not_a_working_day")
        }

        // 8–9. Day-level constraints.
        if (dayConstraints.some((c) => c.day === weekDay && c.type === "FORBIDDEN_DAY")) {
          return unavailable(date, weekDay, "forbidden_day")
        }
        if (dayConstraints.some((c) => c.day === weekDay && c.type === "FIXED_DAY_OFF")) {
          return unavailable(date, weekDay, "fixed_day_off")
        }

        // 10. Available.
        return availableDay(date, weekDay, recurringOn?.window ?? null, storeWindow)
      }
    )

    return { employeeId, period, days }
  },
}

function availableDay(
  date: IsoDate,
  weekDay: WeekDay,
  ruleWindow: TimeWindow | null,
  storeWindow: AvailabilityWindow
): DailyAvailability {
  return {
    date,
    weekDay,
    status: "available",
    windows: [ruleWindow ?? storeWindow],
  }
}
