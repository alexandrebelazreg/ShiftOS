import { enumerateDates, weekDayOf } from "@/features/core/shared"

import type { StoreConfiguration } from "@/features/store/models"
import type { DemandInput, DemandRequirementInput } from "@/features/core/data-bridge"
import type { SectorDemandConfiguration } from "@/features/sectors"

/**
 * Derive a demand from the store's opening hours over the period: one coverage
 * requirement per OPEN day, spanning that day's opening window, needing the
 * configured default headcount.
 *
 * This is a TEMPORARY V1 demand source (there is no demand editor yet) — pure
 * input assembly from existing configuration, not a scheduling decision. The
 * demand engine still computes coverage; this only builds its input.
 */
export function buildDemandInput(
  config: StoreConfiguration,
  period: { start: string; end: string },
  planningId: string
  , sectors?: readonly SectorDemandConfiguration[]
): DemandInput {
  const requirements: DemandRequirementInput[] = []

  if (sectors?.some((sector) => sector.status === "active")) {
    for (const sector of sectors.filter((item) => item.status === "active")) {
      for (const date of enumerateDates(period.start, period.end)) {
        const weekDay = weekDayOf(date)
        const day = sector.hours.find((item) => item.day === weekDay)
        if (!day || day.closed) continue
        for (const slot of sector.coverage.profiles[weekDay] ?? []) {
          requirements.push({ id: `req_${sector.id}_${date}_${slot.start.replace(":", "")}`, date, start: slot.start, end: slot.end, minEmployees: slot.employees })
        }
      }
    }
    return { id: `demand_${planningId}`, requirements }
  }

  for (const date of enumerateDates(period.start, period.end)) {
    const weekDay = weekDayOf(date)
    const day = config.openingHours.find((d) => d.day === weekDay)
    if (!day || day.closed || day.ranges.length === 0) continue

    const start = day.ranges.reduce((min, r) => (r.start < min ? r.start : min), day.ranges[0].start)
    const end = day.ranges.reduce((max, r) => (r.end > max ? r.end : max), day.ranges[0].end)

    requirements.push({
      id: `req_${date}`,
      date,
      start,
      end,
      minEmployees: config.coverage.defaultMinEmployeesPerShift,
    })
  }

  return { id: `demand_${planningId}`, requirements }
}
