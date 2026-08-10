import {
  grantIsEntirelyFirstChoice,
} from "@/features/paid-leave/domain/campaign"
import type {
  PaidLeaveCampaign,
  PaidLeaveReinforcementAllocation,
} from "@/features/paid-leave/models/paid-leave-campaign"

export function validatePaidLeaveCampaign(
  campaign: PaidLeaveCampaign,
  now: string,
  reinforcementAllocations: readonly PaidLeaveReinforcementAllocation[] =
    campaign.solution?.reinforcementAllocations ?? []
): PaidLeaveCampaign {
  const fullFirstChoiceEmployeeIds = Object.entries(campaign.grants)
    .filter(([employeeId, grants]) => {
      const request = campaign.requests[employeeId]
      return request ? grantIsEntirelyFirstChoice(request, grants) : false
    })
    .map(([employeeId]) => employeeId)

  return {
    ...campaign,
    status: "validated",
    validatedSnapshot: {
      validatedAt: now,
      grants: structuredClone(campaign.grants),
      reinforcementAllocations,
      fullFirstChoiceEmployeeIds,
    },
    updatedAt: now,
  }
}

export function unlockPaidLeaveCampaign(
  campaign: PaidLeaveCampaign,
  now: string
): PaidLeaveCampaign {
  return { ...campaign, status: "editing", updatedAt: now }
}
