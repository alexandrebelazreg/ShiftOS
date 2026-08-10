import { preferenceRank } from "@/features/paid-leave/domain/campaign"
import type {
  PaidLeaveCampaign,
  PaidLeaveCompromise,
  PaidLeaveReinforcementAllocation,
  PaidLeaveWeekId,
} from "@/features/paid-leave/models/paid-leave-campaign"
import type { PaidLeaveSolveResponse } from "@/features/paid-leave/solver/paid-leave-solver-contract"

export function applyOptimalPaidLeaveSolution(
  campaign: PaidLeaveCampaign,
  response: Extract<PaidLeaveSolveResponse, { status: "optimal" }>,
  now: string
): PaidLeaveCampaign {
  const grants = Object.fromEntries(
    Object.entries(response.grants).map(([employeeId, weeks]) => [
      employeeId,
      [...weeks].sort() as PaidLeaveWeekId[],
    ])
  )
  const compromises = buildCompromises(campaign, grants)

  return {
    ...campaign,
    grants,
    solution: {
      generatedAt: now,
      status: "optimal",
      grants,
      reinforcementAllocations: response.reinforcementAllocations.map((allocation) => ({
        ...allocation,
        weekId: allocation.weekId as PaidLeaveWeekId,
      })) satisfies PaidLeaveReinforcementAllocation[],
      compromises,
    },
    updatedAt: now,
  }
}

function buildCompromises(
  campaign: PaidLeaveCampaign,
  grants: Readonly<Record<string, readonly PaidLeaveWeekId[]>>
): PaidLeaveCompromise[] {
  return Object.entries(grants).map(([employeeId, weeks]) => {
    const request = campaign.requests[employeeId]
    const ranks = request
      ? weeks.flatMap((weekId) => {
          const rank = preferenceRank(request, weekId)
          return rank ? [rank] : []
        })
      : []
    const distinctRanks = new Set(ranks)
    const partnerId = campaign.employeeSettings[employeeId]?.linkedEmployeeId
    const partnerWeeks = partnerId ? grants[partnerId] ?? [] : []
    const targetCommon = partnerId
      ? Math.min(weeks.length, partnerWeeks.length)
      : 0
    const common = partnerId
      ? weeks.filter((week) => partnerWeeks.includes(week)).length
      : 0
    const prioritySatisfied = partnerId ? common === targetCommon : null
    const worstRank = ranks.length > 0 ? Math.max(...ranks) : null
    const mixed = distinctRanks.size > 1
    const message = prioritySatisfied === false
      ? "Les semaines communes avec la personne liée n’ont pas toutes pu être accordées."
      : worstRank === null
        ? "Aucune semaine accordée."
        : mixed
          ? `Attribution répartie entre plusieurs niveaux de vœux, jusqu’au vœu ${worstRank}.`
          : worstRank === 1
            ? "Attribution entièrement issue du vœu 1."
            : `Attribution issue du vœu ${worstRank}.`

    return {
      employeeId,
      grantedWeeks: weeks,
      preferenceRanks: ranks,
      mixed,
      prioritySatisfied,
      message,
    }
  })
}
