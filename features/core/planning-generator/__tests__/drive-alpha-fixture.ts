import { WEEK_DAYS, type EmployeeId } from "@/features/core/models"
import type { PlanningGenerationInput } from "@/features/core/planning-generator"
import { brand, builtInRegistry, contract, demand, employee, requirement, settings, store } from "@/features/core/planning-generator/__tests__/fixtures"

const DATES = ["2026-07-20", "2026-07-21", "2026-07-22", "2026-07-23", "2026-07-24", "2026-07-25"]
const PROFILES = [
  [2, 2, 1, 1, 3, 3, 1, 1, 1, 1, 2, 1, 1, 1], [2, 2, 1, 1, 3, 3, 1, 1, 1, 1, 2, 1, 1, 1],
  [2, 2, 1, 1, 3, 3, 1, 1, 1, 1, 2, 1, 1, 1], [2, 2, 1, 1, 3, 3, 1, 1, 1, 1, 2, 1, 1, 1],
  [2, 1, 3, 1, 4, 1, 1, 1, 1, 1, 3, 2, 1, 1], [4, 1, 1, 1, 1, 4, 1, 1, 1, 1, 1, 1, 1, 1],
] as const

export function driveScenario(): PlanningGenerationInput {
  const people = [
    { ...employee("luca"), capabilities: ["CAN_OPEN", "CAN_CLOSE"] }, { ...employee("valentin"), capabilities: ["CAN_OPEN", "CAN_CLOSE"] },
    { ...employee("erwan"), capabilities: ["CAN_OPEN", "CAN_CLOSE"] }, { ...employee("arthur"), capabilities: ["CAN_OPEN", "CAN_CLOSE", "CAN_SPLIT_SHIFT"] },
    { ...employee("dylan"), capabilities: ["CAN_CLOSE"] },
  ]
  const requirements = DATES.flatMap((date, dayIndex) => PROFILES[dayIndex].map((minimum, slot) => ({ ...requirement(`drive_${dayIndex}_${slot}`, date, minimum), window: { date, start: `${String(6 + slot).padStart(2, "0")}:00`, end: `${String(7 + slot).padStart(2, "0")}:00` } })))
  const configuredStore = { ...store(), openingHours: WEEK_DAYS.map((day) => day === "sunday" ? { day, closed: true, opensAt: null, closesAt: null } : { day, closed: false, opensAt: "06:00" as const, closesAt: "20:00" as const }), planningSettings: { ...store().planningSettings, minShiftDuration: 240, maxShiftDuration: 600, granularity: 15 as const } }
  const days = { luca: WEEK_DAYS.filter((day) => day !== "sunday"), valentin: WEEK_DAYS.filter((day) => day !== "sunday"), erwan: WEEK_DAYS.filter((day) => day !== "sunday"), arthur: ["monday", "tuesday", "wednesday", "friday", "saturday"], dylan: WEEK_DAYS.filter((day) => day !== "sunday") } as const
  const limits = [["luca", "MAX_CLOSINGS", 1], ["valentin", "MAX_OPENINGS", 1], ["valentin", "MAX_CLOSINGS", 1], ["erwan", "MAX_CLOSINGS", 1], ["arthur", "MAX_CLOSINGS", 1], ["dylan", "MAX_CLOSINGS", 2]] as const
  return { store: configuredStore, employees: people, contracts: people.map((person) => ({ ...contract(String(person.id), days[String(person.id) as keyof typeof days]), employeeId: person.id, weeklyMinutes: 2_205, weeklyHours: 36.75 })), demand: demand(requirements), registry: builtInRegistry(), settings: { ...settings(), period: { start: DATES[0], end: "2026-07-26" }, minimumRestMinutes: 720, maximumDailyMinutes: 600, timeIncrementMinutes: 15 }, employeeConstraints: limits.map(([id, type, value], index) => ({ id: brand(`drive_limit_${index}`), employeeId: brand<EmployeeId>(id), type, value })), business: { sectors: [{ id: "drive", name: "Drive", active: true, weeklyDistribution: { monday: 15, tuesday: 15, wednesday: 15, thursday: 15, friday: 22, saturday: 18, sunday: 0 }, minimumShiftDuration: 240, splitShiftAllowed: true, maximumSplitDuration: 90, workEveryNonFixedRestDay: true, assignedEmployeeIds: people.map((person) => person.id), requirementIds: requirements.map((item) => String(item.id)), hours: WEEK_DAYS.map((day) => ({ day, closed: day === "sunday", opensAt: "06:00", closesAt: "20:00" })) }] } }
}
