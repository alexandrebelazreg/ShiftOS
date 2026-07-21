import { clamp01 } from "@/features/core/fairness-engine"

import type { RankingDimension } from "@/features/core/planning-generator/ranking/ranking-types"

/**
 * Current Workload Balance — during generation, prefer employees who currently
 * have fewer assigned hours, so a single employee does not receive every shift.
 * Applies ONLY to the in-progress generation (not historical hours).
 *
 * Score = `1 - assigned / maxAssigned`. Before anyone is loaded (`maxAssigned`
 * is 0) everyone scores `1` (no preference yet).
 */
export const currentWorkloadDimension: RankingDimension = {
  name: "current_workload_balance",
  weight: 0.3,
  score(employeeId, context) {
    if (context.maxAssignedMinutes <= 0) return 1
    const assigned = context.assignedMinutesByEmployee.get(employeeId) ?? 0
    return clamp01(1 - assigned / context.maxAssignedMinutes)
  },
}
