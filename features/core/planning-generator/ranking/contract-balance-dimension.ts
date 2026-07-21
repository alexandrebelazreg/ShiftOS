import { clamp01 } from "@/features/core/fairness-engine"
import { contractualMinutes } from "@/features/core/models"

import type { RankingDimension } from "@/features/core/planning-generator/ranking/ranking-types"

/**
 * Contract Balance — prefer employees whose resulting hours stay closest to
 * (and within) their contractual hours, avoiding overload.
 *
 * Score = `1 - resultingUtilization`, where utilization is
 * `(alreadyAssigned + thisShift) / contractMinutes`. An employee this shift
 * would push to/over their contract scores near `0` (avoid overloading); one
 * with plenty of room scores high. Unknown contract capacity ⇒ `0` (do not
 * overload someone whose limit is unknown).
 */
export const contractBalanceDimension: RankingDimension = {
  name: "contract_balance",
  weight: 0.4,
  score(employeeId, context) {
    const contract = context.contractByEmployee.get(employeeId)
    const contractMinutes = contract ? contractualMinutes(contract) : 0
    if (contractMinutes <= 0) return 0

    const assigned = context.assignedMinutesByEmployee.get(employeeId) ?? 0
    const resultingUtilization = (assigned + context.shiftMinutes) / contractMinutes
    return clamp01(1 - resultingUtilization)
  },
}
