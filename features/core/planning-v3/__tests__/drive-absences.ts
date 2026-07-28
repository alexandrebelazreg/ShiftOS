import type { EmployeeId, IsoDate } from "@/features/core/models"
import { WEEK_DAYS, type WeekDay } from "@/features/core/models"

import type { PlanningGenerationInput } from "@/features/core/planning-generator/types/generation-input"
import { buildPlanningProblemV3 } from "@/features/core/planning-v3/problem-builder"
import type { PlanningProblemV3 } from "@/features/core/planning-v3/types/problem"

import {
  DRIVE_CANONICAL_DATES,
  DRIVE_CANONICAL_RULES,
  DRIVE_OPEN_WEEK_DAYS,
  DRIVE_SECTOR_DISTRIBUTION,
  DRIVE_TEAM_SHAPE,
  driveCanonicalInput,
} from "@/features/core/planning-v3/__tests__/drive-canonical"

/**
 * The canonical Drive week with two employees absent all week.
 *
 * What this fixture is FOR: proving that a shrunken team produces a legal,
 * degraded schedule rather than a refusal. The normal demand becomes
 * unreachable — that is the point — and the engine must still open the shop.
 *
 * How absences are modelled, and the trap avoided
 * ------------------------------------------------
 * The absence is declared ONCE, as a dated range on the generation input. The
 * builder turns it into `available: false` on the matching employee-days, which
 * makes three things follow on their own:
 *
 * - no shift can be generated for those days — an unavailable day has no
 *   candidate at all, rather than a candidate that is later rejected;
 * - those minutes never enter the day's capacity, because capacity is summed
 *   over AVAILABLE entries only;
 * - the soft target shrinks in proportion, because the rescaling divides what
 *   is actually available over the reference profile's shape.
 *
 * The trap is deducting the absence twice — once by removing the person and
 * again by lowering the budget "to compensate". The daily budgets here are
 * therefore RECOMPUTED from the remaining contracts, not adjusted by hand: the
 * absent employees' contracts leave the problem entirely, and what remains is
 * distributed by the sector's own weekly distribution, exactly as it would be
 * for a smaller team.
 */

/** Who is away, and for how long. Named by id, never by position. */
export const DRIVE_ABSENT_EMPLOYEE_IDS = ["erwan", "valentin"] as const

/**
 * The most minutes one employee can contribute to CONTINUOUS coverage in a day.
 *
 * The continuous cap, for everyone — including the people allowed to split.
 *
 * That is not an oversight. A split adds minutes but subtracts continuity: it
 * puts a 45-to-90 minute hole in the middle of its holder's day, and a hole is
 * exactly what an unbreakable presence floor forbids. Counting split capacity
 * here would say a day can be staffed when it cannot.
 *
 * The Drive Wednesday of this scenario is the worked example. Two people remain
 * and one may split, so raw capacity looks like 600 + 480 = 1 080 minutes. A
 * budget of 990 then forces the splitter past 480, hence into a split, hence
 * into a gap — and the other employee, pinned to the closing, starts far too
 * late to cover it. The day is infeasible while its "capacity" says otherwise.
 * At 2 × 480 both work one straight stretch and the floor holds.
 */
function continuousDailyCeiling(): number {
  const window = DRIVE_CANONICAL_RULES.closesAtMinutes - DRIVE_CANONICAL_RULES.opensAtMinutes
  return Math.min(
    DRIVE_CANONICAL_RULES.maximumShiftMinutes,
    DRIVE_CANONICAL_RULES.maximumContinuousMinutes,
    window
  )
}

/**
 * A weekly distribution a REDUCED team can actually work.
 *
 * The sector's normal distribution is a business shape — Friday heavy, Saturday
 * next — and it is kept wherever the remaining people can absorb it. Where they
 * cannot, the day is capped at its real capacity and the excess moves to the
 * days that still have room, proportionally to that room.
 *
 * This is not a cosmetic adjustment. With two employees away all week, the
 * canonical Thursday keeps only two people, neither of whom may split, so the
 * day tops out at 960 minutes against the 990 a flat distribution still asks
 * of it. Daily budgets are EXACT in this model, so the extra thirty minutes are
 * not a target to miss — they are an instruction nobody can carry out, and the
 * week would be reported infeasible for a reason that has nothing to do with
 * demand.
 *
 * NOTE — this lives in the fixture, not in the builder. Production still
 * computes budgets from the sector percentages alone and would hit the same
 * wall on a real reduced week. Closing that gap is a builder change, and it is
 * out of scope here; the point of this fixture is to exercise the SOLVER on a
 * placeable reduced week.
 */
function capacityAwareDistribution(
  absent: ReadonlySet<string>
): Readonly<Record<WeekDay, number>> {
  const openDays = DRIVE_OPEN_WEEK_DAYS
  const capacity: Record<string, number> = {}
  for (const weekDay of openDays) {
    capacity[weekDay] = DRIVE_TEAM_SHAPE.filter(
      (person) => !absent.has(person.id) && person.fixedRestDay !== weekDay
    ).reduce((sum) => sum + continuousDailyCeiling(), 0)
  }

  const total = DRIVE_TEAM_SHAPE.filter((person) => !absent.has(person.id)).length *
    DRIVE_CANONICAL_RULES.contractMinutes

  // Start from the sector's own shape.
  const share: Record<string, number> = {}
  for (const weekDay of openDays) {
    share[weekDay] = (DRIVE_SECTOR_DISTRIBUTION[weekDay] / 100) * total
  }

  // Move what does not fit onto the days that still have room. Bounded: every
  // pass strictly reduces the overflow, and it stops when nothing overflows.
  for (let pass = 0; pass < openDays.length; pass++) {
    let overflow = 0
    const headroom: Record<string, number> = {}
    let totalHeadroom = 0
    for (const weekDay of openDays) {
      if (share[weekDay] > capacity[weekDay]) {
        overflow += share[weekDay] - capacity[weekDay]
        share[weekDay] = capacity[weekDay]
        headroom[weekDay] = 0
      } else {
        headroom[weekDay] = capacity[weekDay] - share[weekDay]
        totalHeadroom += headroom[weekDay]
      }
    }
    if (overflow <= 0 || totalHeadroom <= 0) break
    for (const weekDay of openDays) {
      share[weekDay] += overflow * (headroom[weekDay] / totalHeadroom)
    }
  }

  // Percentages must total EXACTLY 100 — the builder refuses anything else, and
  // it is right to: a distribution that does not add up describes a week whose
  // days would not sum to the contracts.
  //
  // Getting there is a floating-point problem, not a business one. Dividing
  // minutes and rounding to four decimals still leaves dust
  // (99.99999999999999), because a decimal like 15.4716 has no exact binary
  // form and six of them do not add back to 100. QUARTERS do: 0.25 is a power
  // of two, so any multiple of it is exact and so is their sum.
  //
  // Each day is floored to a quarter, and the leftover quarters go to the days
  // with the most headroom — never to a day already at its ceiling, which is
  // the whole point of having capped it.
  const QUARTER = 0.25
  const open = new Set<string>(openDays)
  const percent: Record<string, number> = {}
  for (const weekDay of openDays) {
    percent[weekDay] = Math.floor(((share[weekDay] / total) * 100) / QUARTER) * QUARTER
  }

  let leftover = Math.round((100 - openDays.reduce((sum, d) => sum + percent[d], 0)) / QUARTER)
  const headroomOf = (weekDay: string): number =>
    capacity[weekDay] - (percent[weekDay] / 100) * total

  // Deterministic: most headroom first, ties by week-day name.
  while (leftover > 0) {
    const target = [...openDays]
      .filter((weekDay) => headroomOf(weekDay) >= (QUARTER / 100) * total)
      .sort((left, right) => headroomOf(right) - headroomOf(left) || left.localeCompare(right))[0]
    if (target === undefined) break
    percent[target] += QUARTER
    leftover--
  }

  const distribution = {} as Record<WeekDay, number>
  for (const weekDay of WEEK_DAYS) {
    distribution[weekDay] = open.has(weekDay) ? percent[weekDay] : 0
  }
  return distribution
}

const STAMPS = { createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z" }

export function driveWithAbsencesInput(): PlanningGenerationInput {
  const base = driveCanonicalInput()
  const absent = new Set<string>(DRIVE_ABSENT_EMPLOYEE_IDS)
  const sector = base.business?.sectors?.[0]
  if (!sector) throw new Error("La fixture Drive canonique ne déclare aucun secteur.")

  return {
    ...base,
    // The absence itself: a dated range, declared once.
    absences: [...absent].sort().map((employeeId) => ({
      ...STAMPS,
      id: `absence_${employeeId}` as never,
      employeeId: employeeId as unknown as EmployeeId,
      type: "sick_leave" as never,
      range: {
        start: DRIVE_CANONICAL_DATES[0] as IsoDate,
        end: "2026-07-26" as IsoDate,
      },
    })),
    // An absent week is NOT replanned. Their contracted minutes leave the
    // problem, which is the single deduction: capacity falls because they are
    // unavailable, and the week's total falls because their hours are not owed.
    // Deducting on both sides — removing the person AND lowering everyone
    // else's budget "to compensate" — would take the same absence twice.
    contracts: (base.contracts ?? []).map((contract) =>
      absent.has(String(contract.employeeId))
        ? { ...contract, weeklyMinutes: 0, weeklyHours: 0 }
        : contract
    ),
    business: {
      ...base.business,
      sectors: [{ ...sector, weeklyDistribution: capacityAwareDistribution(absent) }],
    },
  }
}

/**
 * The problem, built through the production builder.
 *
 * The daily budgets are NOT written by hand. They fall out of the sector's own
 * weekly distribution applied to the REMAINING contracted minutes, exactly as
 * they would for a smaller permanent team — so the reduction is expressed once,
 * on the contracts, and everything downstream follows from it.
 */
export function buildDriveWithAbsencesProblem(): PlanningProblemV3 {
  const built = buildPlanningProblemV3(driveWithAbsencesInput())
  if (!built.ok) {
    throw new Error(
      `La fixture Drive avec absences ne se construit pas : ${built.errors
        .map((error) => `${error.code} — ${error.message}`)
        .join(" | ")}`
    )
  }

  const overrides = DRIVE_CANONICAL_RULES.earliestStartOverrides as Readonly<
    Record<string, number>
  >

  return {
    ...built.problem,
    employeeDays: built.problem.employeeDays.map((entry) => {
      const override = overrides[String(entry.employeeId)]
      if (override === undefined) return entry
      const earliest = Math.max(entry.earliestStartMinutes, override)
      return {
        ...entry,
        earliestStartMinutes: earliest,
        maximumMinutes: Math.min(
          entry.maximumMinutes,
          Math.max(0, entry.latestEndMinutes - earliest)
        ),
      }
    }),
    rules: {
      ...built.problem.rules,
      maximumContinuousMinutes: DRIVE_CANONICAL_RULES.maximumContinuousMinutes,
      minimumSplitMinutes: DRIVE_CANONICAL_RULES.minimumSplitMinutes,
    },
  }
}

export function serialiseDriveWithAbsencesProblem(): string {
  return `${JSON.stringify(buildDriveWithAbsencesProblem(), null, 2)}\n`
}
