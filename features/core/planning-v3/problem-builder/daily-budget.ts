import { WEEK_DAYS, type WeekDay } from "@/features/core/models"

/**
 * Exact daily budgets, derived from a weekly distribution.
 *
 * The total contracted minutes of a week are split across the week days by
 * percentage. Percentages almost never divide evenly, so the split is done in
 * whole time steps with the largest-remainder method: every day gets its floor
 * share, then the leftover steps go to the days with the biggest fractional
 * part, ties broken by calendar order.
 *
 * Two properties matter and both are guaranteed here:
 * - the budgets sum to EXACTLY the total, so no minute is invented or lost;
 * - the result is a pure function of its inputs, so the same week always
 *   produces the same budgets.
 *
 * This is a V3-owned computation. It intentionally duplicates no V2 code: the
 * validator must be able to disagree with the generator, which it cannot do if
 * both call the same function.
 */

export interface DailyBudgetV3 {
  readonly day: WeekDay
  readonly percentage: number
  readonly budgetMinutes: number
}

export type DailyBudgetResultV3 =
  | { readonly ok: true; readonly budgets: readonly DailyBudgetV3[] }
  | { readonly ok: false; readonly error: string }

export function computeDailyBudgets(
  totalMinutes: number,
  distribution: Readonly<Record<WeekDay, number>>,
  timeStepMinutes: number
): DailyBudgetResultV3 {
  if (!Number.isInteger(timeStepMinutes) || timeStepMinutes <= 0) {
    return { ok: false, error: `Le pas de temps ${timeStepMinutes} doit être un entier positif.` }
  }
  if (!Number.isInteger(totalMinutes) || totalMinutes < 0) {
    return { ok: false, error: `Le total contractuel ${totalMinutes} doit être un entier positif.` }
  }
  if (totalMinutes % timeStepMinutes !== 0) {
    return {
      ok: false,
      error: `Le total contractuel ${totalMinutes} doit être un multiple de ${timeStepMinutes} minutes.`,
    }
  }

  const percentages = WEEK_DAYS.map((day) => distribution[day])
  if (percentages.some((value) => !Number.isFinite(value) || value < 0)) {
    return { ok: false, error: "La répartition hebdomadaire ne peut pas contenir de pourcentage négatif." }
  }
  const percentageTotal = percentages.reduce((sum, value) => sum + value, 0)
  if (percentageTotal !== 100) {
    return {
      ok: false,
      error: `La répartition hebdomadaire doit totaliser 100 %, reçu ${percentageTotal} %.`,
    }
  }

  const totalSteps = totalMinutes / timeStepMinutes
  const rows = WEEK_DAYS.map((day, index) => {
    const exact = (totalSteps * distribution[day]) / 100
    const floor = Math.floor(exact)
    return { day, index, percentage: distribution[day], steps: floor, remainder: exact - floor }
  })

  let leftover = totalSteps - rows.reduce((sum, row) => sum + row.steps, 0)
  const byRemainder = [...rows].sort(
    (left, right) => right.remainder - left.remainder || left.index - right.index
  )
  for (const row of byRemainder) {
    if (leftover <= 0) break
    row.steps++
    leftover--
  }

  return {
    ok: true,
    budgets: rows.map(({ day, percentage, steps }) => ({
      day,
      percentage,
      budgetMinutes: steps * timeStepMinutes,
    })),
  }
}
