import { WEEK_DAYS, type WeekDay } from "@/features/core/models"

export interface DailyDistributionTarget {
  readonly day: WeekDay
  readonly percentage: number
  readonly targetMinutes: number
}

/** Allocate an exact 15-minute total using deterministic largest remainders. */
export function allocateDailyContractMinutes(totalMinutes: number, distribution: Readonly<Record<WeekDay, number>>, increment = 15): readonly DailyDistributionTarget[] {
  if (!Number.isInteger(totalMinutes) || totalMinutes < 0 || totalMinutes % increment !== 0) throw new Error(`Le total contractuel ${totalMinutes} doit être un multiple de ${increment} minutes.`)
  const percentageTotal = WEEK_DAYS.reduce((sum, day) => sum + distribution[day], 0)
  if (percentageTotal !== 100) throw new Error(`La répartition hebdomadaire doit totaliser 100 %, reçu ${percentageTotal} %.`)
  const units = totalMinutes / increment
  const rows = WEEK_DAYS.map((day, index) => { const exact = units * distribution[day] / 100, floor = Math.floor(exact); return { day, index, percentage: distribution[day], units: floor, remainder: exact - floor } })
  let remaining = units - rows.reduce((sum, row) => sum + row.units, 0)
  for (const row of [...rows].sort((left, right) => right.remainder - left.remainder || left.index - right.index)) { if (remaining <= 0) break; row.units++; remaining-- }
  return rows.map(({ day, percentage, units: targetUnits }) => ({ day, percentage, targetMinutes: targetUnits * increment }))
}
