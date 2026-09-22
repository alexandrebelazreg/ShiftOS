import {
  paidLeaveTargets,
  preferenceRank,
} from "@/features/paid-leave/domain/campaign"
import type {
  PaidLeaveCampaign,
  PaidLeaveCompromise,
  PaidLeaveReinforcementAllocation,
  PaidLeaveRequest,
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
      firstChoiceEmployeeIds: response.firstChoiceEmployeeIds,
      concessions: response.concessions,
      // Ce que le gérant avait sous les yeux avant de relancer. Capturé ICI
      // parce que c'est le seul endroit où les deux états coexistent.
      previousGrants: campaign.grants,
    },
    updatedAt: now,
  }
}

function buildCompromises(
  campaign: PaidLeaveCampaign,
  grants: Readonly<Record<string, readonly PaidLeaveWeekId[]>>
): PaidLeaveCompromise[] {
  // LA MÊME CIBLE QUE LE SOLVEUR, et pas une autre lecture de la demande.
  //
  // Ce fichier recomposait `effectiveRequestedWeeks` sur les semaines de la
  // CAMPAGNE : ni le solde, ni la fermeture. Son seuil était donc
  // systématiquement PLUS HAUT que celui du solveur, et l'écran annonçait
  // « droit au congé simultané non tenu » sur un couple que le calcul venait de
  // prouver réuni. Un écran qui contredit le solveur est pire qu'un écran muet :
  // le gérant va déplacer des semaines pour réparer ce qui n'est pas cassé.
  const targetOf = paidLeaveTargets(campaign)
  return Object.entries(grants).map(([employeeId, weeks]) => {
    const request = campaign.requests[employeeId]
    const ranks = request
      ? weeks.flatMap((weekId) => {
          const rank = preferenceRank(request, weekId)
          return rank ? [rank] : []
        })
      : []
    /**
     * Le plan qui contient l'attribution ENTIÈRE, s'il en existe un.
     *
     * Se lit sur l'appartenance, jamais sur les rangs des semaines prises une à
     * une. Une semaine figurant dans deux plans ne porte que le plus petit de
     * ses rangs, si bien qu'un plan de repli accordé en entier ressemblait à un
     * mélange — le message annonçait « réparti entre plusieurs niveaux » à
     * quelqu'un qui avait reçu exactement l'un de ses vœux.
     *
     * Le meilleur rang l'emporte quand plusieurs plans conviennent : c'est
     * l'ordre dans lequel la personne les a écrits.
     */
    const wholePlanRank = request && weeks.length > 0
      ? ([1, 2, 3] as const).find((rank) =>
          weeks.every((weekId) => planOf(request, rank).includes(weekId))
        ) ?? null
      : null
    const partnerId = campaign.employeeSettings[employeeId]?.linkedEmployeeId
    const partnerWeeks = partnerId ? grants[partnerId] ?? [] : []
    /**
     * LA CIBLE SE LIT SUR LA DEMANDE, JAMAIS SUR LE RÉSULTAT.
     *
     * Elle valait `min(semaines accordées à l'un, semaines accordées à
     * l'autre)`. Le critère se vérifiait donc lui-même : deux personnes
     * repartant les mains vides donnaient `0 === 0`, c'est-à-dire « priorité
     * satisfaite » — et il ne pouvait pratiquement jamais valoir faux.
     *
     * Le droit au congé simultané de l'article L3141-14 porte sur ce que les
     * deux ont DEMANDÉ. La cible est donc le plus court des deux congés voulus,
     * et le couple est réuni quand il a partagé au moins autant de semaines —
     * exactement ce que le solveur optimise depuis qu'il compte des couples et
     * non des semaines.
     *
     * « Demandé » veut dire ATTRIBUABLE, et c'est le second piège : une semaine
     * que le solde interdit, ou sur laquelle le magasin ferme, ne peut pas être
     * partagée par le calcul. L'exiger quand même rendrait le droit intenable
     * pour une raison qui n'a rien à voir avec le couple.
     *
     * `null` quand il n'y a rien à satisfaire : sans partenaire, ou quand aucun
     * des deux n'a demandé la moindre semaine.
     */
    const targetCommon = partnerId
      ? Math.min(targetOf(employeeId), targetOf(partnerId))
      : 0
    const common = partnerId
      ? weeks.filter((week) => partnerWeeks.includes(week)).length
      : 0
    const prioritySatisfied =
      partnerId && targetCommon > 0 ? common >= targetCommon : null
    const worstRank = wholePlanRank ?? (ranks.length > 0 ? Math.max(...ranks) : null)
    const mixed = weeks.length > 0 && wholePlanRank === null
    const message = prioritySatisfied === false
      ? "Les semaines communes avec la personne liée n’ont pas toutes pu être accordées."
      : weeks.length === 0
        ? "Aucune semaine accordée."
        // Des semaines hors de tout vœu : le solveur n'en produit jamais, il ne
        // pioche que dans les plans. C'est donc une retouche à la main, et la
        // nommer vaut mieux que d'annoncer un rang qui n'existe pas.
        : worstRank === null
          ? "Attribution saisie à la main, hors des vœux exprimés."
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

/** Les semaines d'un rang, telles que la personne les a écrites. */
function planOf(request: PaidLeaveRequest, rank: 1 | 2 | 3): readonly PaidLeaveWeekId[] {
  return rank === 1 ? request.wish1 : rank === 2 ? request.wish2 : request.wish3
}
