import {
  activeClosureWeeks,
  attributableWeekIds,
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
  // Les semaines ATTRIBUABLES : « tout en vœu 1 » se juge sur ce qui pouvait
  // être accordé — ni les semaines hors période, ni celles de fermeture.
  //
  // La fermeture est le piège, et il est silencieux. Un vœu de trois semaines
  // dont une ferme ne peut donner que DEUX attributions ; jugé sur la campagne
  // entière, le compte ne tombe jamais juste et la personne perd son crédit
  // d'équité — celui-là même qui la fera passer devant à la campagne suivante.
  // Le solveur, lui, compte déjà la fermeture hors du plan : les deux définitions
  // divergeraient, et l'écart ne se verrait qu'un an plus tard.
  const weekIds = attributableWeekIds(campaign)
  const fullFirstChoiceEmployeeIds = Object.entries(campaign.grants)
    .filter(([employeeId, grants]) => {
      const request = campaign.requests[employeeId]
      return request ? grantIsEntirelyFirstChoice(request, grants, weekIds) : false
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
      // Figée avec les attributions : c'est elle qui décide si deux semaines
      // séparées forment un congé continu ou un congé coupé en deux.
      closureWeekIds: [...activeClosureWeeks(campaign)],
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
