import { z } from "zod"

import type { AbsenceRecord } from "@/features/absences/types/absence-record"
import type { EmployeeRecord } from "@/features/employees/types/employee.types"
import { campaignWeeks } from "@/features/paid-leave/calendar/campaign-weeks"
import { absentWeeksByEmployee } from "@/features/paid-leave/domain/already-absent"
import {
  activeClosureWeeks,
  attributableWeekIds,
  grantableWishes,
  paidLeaveTargets,
} from "@/features/paid-leave/domain/campaign"
import type {
  PaidLeaveCampaign,
  PaidLeaveReinforcementAllocation,
} from "@/features/paid-leave/models/paid-leave-campaign"
import type { SectorDemandConfiguration } from "@/features/sectors"

const weekIdSchema = z.string().regex(/^\d{4}-W\d{2}$/)

export const paidLeaveSolveRequestSchema = z.object({
  campaignId: z.string().min(1),
  timeoutSeconds: z.number().int().min(1).max(300).default(60),
  weeks: z.array(weekIdSchema),
  /**
   * Les semaines où le magasin ferme, et où tout le monde est donc en congé.
   *
   * Elles restent dans `weeks` — elles font partie de la campagne, et la
   * contiguïté des congés se lit sur cette liste. C'est le solveur qui en tire
   * les trois conséquences : aucune couverture à tenir, aucune attribution à
   * décider, et une semaine fermée qui SOUDE les congés de part et d'autre au
   * lieu de les couper en deux.
   */
  closureWeekIds: z.array(weekIdSchema).default([]),
  sectors: z.array(z.object({ id: z.string(), name: z.string() })),
  employees: z.array(z.object({
    id: z.string(),
    name: z.string(),
    sectorId: z.string().nullable(),
    contractHours: z.number().nonnegative(),
    targetWeeks: z.number().int().nonnegative(),
    linkedEmployeeId: z.string().nullable(),
    seniorityOrder: z.number().int().nonnegative(),
    firstChoiceHistory: z.number().int().nonnegative(),
    /**
     * Les trois plans, et non plus la liste à plat de leurs semaines.
     *
     * Un rang décrit un PLAN COMPLET de la même absence — « ces deux semaines,
     * sinon ces deux-là ». Aplatir l'union en `{semaine, meilleur rang}`
     * détruisait cette structure, et le solveur y piochait librement : une
     * personne qui demandait « W28+W29, sinon W32+W33 » repartait avec
     * W28+W33 dès que W29 sautait — ni l'un ni l'autre de ses plans, deux
     * semaines isolées dans deux mois différents.
     *
     * L'appartenance ne se déduit PAS du meilleur rang : une semaine peut
     * figurer dans plusieurs plans, et ne porter alors que le plus petit de ses
     * rangs. Il faut donc envoyer les plans tels quels.
     *
     * Un rang vide n'est pas envoyé : on peut n'avoir qu'une seule idée.
     */
    plans: z.array(z.object({
      rank: z.union([z.literal(1), z.literal(2), z.literal(3)]),
      weekIds: z.array(weekIdSchema).min(1),
    })),
    /**
     * Les semaines où cette personne est DÉJÀ absente pour une autre raison.
     *
     * Rien ne croisait les deux écrans : le solveur pouvait accorder une semaine
     * de congés payés à quelqu'un en arrêt maladie ou en congé parental. Deux
     * absences superposées, l'une décomptée du solde et l'autre pas, et personne
     * pour s'en apercevoir avant la paie.
     *
     * La cible n'en est PAS réduite : la personne a bien demandé ces semaines, et
     * ne pas pouvoir les lui donner est un manque qu'il faut annoncer, pas une
     * demande qu'il faut réécrire. L'écart s'en charge, et l'écran le dit.
     */
    unavailableWeekIds: z.array(weekIdSchema).default([]),
  })),
  coverage: z.array(z.object({
    sectorId: z.string(),
    weekId: weekIdSchema,
    baseContractHours: z.number().nonnegative(),
    minimumHours: z.number().nonnegative(),
    toleratedDeficitHours: z.number().nonnegative(),
    /**
     * Combien de personnes au plus peuvent s'absenter ensemble. `null` : aucun
     * plafond, seules les heures décident — c'est le comportement d'avant, et
     * celui de toute campagne qui n'a pas réglé la case.
     */
    maximumAbsent: z.number().int().nonnegative().nullable().default(null),
  })),
  reinforcementPools: z.array(z.object({
    id: z.string(),
    totalHours: z.number().nonnegative(),
    startWeekId: weekIdSchema,
    endWeekId: weekIdSchema,
    scope: z.union([z.literal("global"), z.literal("sector")]),
    sectorId: z.string().nullable(),
  })),
})

export type PaidLeaveSolveRequest = z.infer<typeof paidLeaveSolveRequestSchema>

export const paidLeaveSolveResponseSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("optimal"),
    grants: z.record(z.string(), z.array(weekIdSchema)),
    /**
     * Qui le solveur a compté comme servi sur TOUT son premier plan.
     *
     * Le même prédicat existe côté application (`grantIsEntirelyFirstChoice`),
     * où la validation le fige et le transporte d'une campagne à l'autre. Les
     * deux doivent s'accorder, et leur désaccord ne se verrait qu'à la campagne
     * SUIVANTE — un an plus tard, sous la forme « pourquoi cette personne ne
     * passe-t-elle pas devant ? ».
     *
     * Vide par défaut : une réponse enregistrée avant ce champ ne porte aucune
     * liste, et l'absence de liste veut dire « rien à comparer », jamais
     * « personne n'a eu son premier vœu ».
     */
    firstChoiceEmployeeIds: z.array(z.string()).default([]),
    /**
     * CE QUE CHAQUE CONCESSION ACHÈTERAIT — et ce qu'elle n'achèterait pas.
     *
     * La campagne est prouvée en quelques secondes sur les soixante allouées. Le
     * solveur dépense une partie du reste à relancer la hiérarchie avec UN étage
     * desserré d'une unité, et rapporte ce que l'équité y gagne. L'ordre
     * lexicographique dit où chercher : servir un premier vœu de plus est
     * impossible sans dégrader un étage plus haut, par définition.
     *
     * `firstChoiceServed` est le total ATTEIGNABLE sous cette concession, pas un
     * gain : l'écart avec la liste de base est l'affaire du lecteur, qui a les
     * deux. Les noms sont un témoin — le compte est exact, la liste est l'une
     * des répartitions possibles.
     *
     * Vide quand il n'y a rien à acheter (tous ceux qui pouvaient être servis au
     * premier vœu le sont déjà) ou rien à dépenser (le calcul a consommé son
     * budget). L'absence de concession n'est donc PAS « aucune ne rapporte ».
     */
    concessions: z.array(z.object({
      lever: z.enum(["unserved_total", "unserved_worst", "couples", "mixed_plans"]),
      firstChoiceServed: z.number().int().nonnegative(),
      employeeIds: z.array(z.string()),
    })).default([]),
    reinforcementAllocations: z.array(z.object({
      poolId: z.string(),
      sectorId: z.string(),
      weekId: weekIdSchema,
      hours: z.number().nonnegative(),
    })),
    objectiveValues: z.record(z.string(), z.number()),
    durationMs: z.number().nonnegative(),
  }),
  z.object({
    status: z.literal("infeasible"),
    message: z.string(),
    durationMs: z.number().nonnegative(),
  }),
  z.object({
    status: z.literal("non_optimal"),
    message: z.string(),
    durationMs: z.number().nonnegative(),
  }),
  z.object({
    status: z.literal("error"),
    message: z.string(),
    durationMs: z.number().nonnegative(),
  }),
])

export type PaidLeaveSolveResponse = z.infer<typeof paidLeaveSolveResponseSchema>

export function buildPaidLeaveSolveRequest({
  campaign,
  employees,
  sectors,
  absences = [],
  timeoutSeconds = 60,
}: {
  readonly campaign: PaidLeaveCampaign
  readonly employees: readonly EmployeeRecord[]
  readonly sectors: readonly SectorDemandConfiguration[]
  /** Ce qui est déjà posé ailleurs, et qui interdit d'y poser des congés. */
  readonly absences?: readonly AbsenceRecord[]
  readonly timeoutSeconds?: number
}): PaidLeaveSolveRequest {
  const weeks = campaignWeeks(campaign.year, campaign.period)
  // LES SEMAINES ATTRIBUABLES, ET NON CELLES DE LA CAMPAGNE. La fermeture sépare
  // les deux notions, et tout ce que cette fonction envoie tient de la seconde :
  // la taille des plans, les vœux encore servables, la cible. Rien ici n'a
  // besoin de « la semaine est-elle dans la campagne » — c'est la question que
  // pose `orphanedWishes`, ailleurs, et c'est la seule.
  const closed = activeClosureWeeks(campaign)
  const attribuables = attributableWeekIds(campaign)
  const targetOf = paidLeaveTargets(campaign)
  const activeSectors = sectors.filter((sector) => sector.status === "active")
  const sectorByName = new Map(activeSectors.map((sector) => [sector.name, sector]))
  const activeEmployees = employees.filter((employee) => employee.status === "active")
  const seniority = [...activeEmployees].sort((left, right) => {
    const leftDate = campaign.employeeSettings[left.id]?.entryDate ?? left.createdAt
    const rightDate = campaign.employeeSettings[right.id]?.entryDate ?? right.createdAt
    return leftDate.localeCompare(rightDate) || left.id.localeCompare(right.id)
  })
  const seniorityOrder = new Map(
    seniority.map((employee, index) => [employee.id, seniority.length - index])
  )
  const absentWeeks = absentWeeksByEmployee(absences, weeks)

  const solverEmployees = activeEmployees.map((employee) => {
    const request = campaign.requests[employee.id] ?? {
      employeeId: employee.id,
      requestedWeeks: 0,
      wish1: [],
      wish2: [],
      wish3: [],
    }
    // Chaque plan, débarrassé de ses doublons et de ses semaines hors période.
    // Les rangs vides disparaissent : ils ne décrivent aucune absence.
    // Les semaines de FERMETURE sortent des plans : la personne y sera en congé
    // quoi qu'il arrive, il n'y a donc rien à décider. Les y laisser ferait
    // compter au solveur une attribution qu'il n'a pas prise, et la cible en
    // serait gonflée d'autant.
    const plans = ([1, 2, 3] as const)
      .map((rank) => ({
        rank,
        weekIds: [...new Set(rank === 1 ? request.wish1 : rank === 2 ? request.wish2 : request.wish3)]
          .filter((weekId) => attribuables.has(weekId)),
      }))
      .filter((plan) => plan.weekIds.length > 0)
    const settings = campaign.employeeSettings[employee.id]
    // L'union de ses vœux encore attribuables, pour n'envoyer que les blocages
    // qui le concernent.
    const grantable = grantableWishes(request, attribuables)
    return {
      id: employee.id,
      name: `${employee.firstName} ${employee.lastName}`.trim(),
      sectorId: sectorByName.get(employee.sectors?.[0] ?? "")?.id ?? null,
      contractHours: contractHours(employee),
      // Ce qu'on peut lui accorder au plus : ce qu'elle a demandé, ce que ses
      // vœux offrent encore, et ce qu'il lui reste à poser. La troisième borne
      // est la raison d'être de `grantableWeekCount` — sans elle, la campagne
      // accordait des semaines que la personne n'avait plus.
      // La MÊME fonction que l'écran, et c'est tout l'intérêt : quatre bornes se
      // composent ici, et les recomposer ailleurs revient à parier qu'on n'en
      // oubliera aucune.
      targetWeeks: targetOf(employee.id),
      linkedEmployeeId: settings?.priority ? settings.linkedEmployeeId : null,
      seniorityOrder: seniorityOrder.get(employee.id) ?? 0,
      firstChoiceHistory: settings?.firstChoiceHistory ?? 0,
      plans,
      // Seules celles qui figurent dans ses vœux : bloquer une semaine qu'il n'a
      // pas demandée ne dit rien au solveur et allonge la charge utile.
      unavailableWeekIds: grantable.filter((weekId) =>
        absentWeeks.get(employee.id)?.has(weekId) ?? false
      ),
    }
  })

  const baseBySector = new Map<string, number>()
  for (const employee of solverEmployees) {
    if (!employee.sectorId) continue
    baseBySector.set(
      employee.sectorId,
      (baseBySector.get(employee.sectorId) ?? 0) + employee.contractHours
    )
  }

  return paidLeaveSolveRequestSchema.parse({
    campaignId: campaign.id,
    timeoutSeconds,
    weeks: weeks.map((week) => week.id),
    closureWeekIds: [...closed],
    sectors: activeSectors.map((sector) => ({ id: sector.id, name: sector.name })),
    employees: solverEmployees,
    coverage: activeSectors.flatMap((sector) =>
      weeks.map((week) => {
        const rule = campaign.coverage[sector.id]?.[week.id]
        return {
          sectorId: sector.id,
          weekId: week.id,
          baseContractHours: baseBySector.get(sector.id) ?? 0,
          minimumHours: rule?.minimumHours ?? 0,
          toleratedDeficitHours: rule?.toleratedDeficitHours ?? 0,
          maximumAbsent: rule?.maximumAbsent ?? null,
        }
      })
    ),
    reinforcementPools: campaign.reinforcementPools,
  })
}

/**
 * Lancer le calcul — en n'envoyant QUE l'identifiant de la campagne.
 *
 * Le navigateur bâtissait jusqu'ici la demande entière et le serveur la passait
 * au solveur sans la relire. Minimums de couverture, plafonds d'effectif,
 * soldes, cibles : tout venait d'ici, et le schéma n'en vérifiait que la forme.
 * Désactiver toutes les règles du produit tenait en une ligne de console.
 *
 * `fallbackRequest` n'est lu par la route que sur une installation SANS base,
 * où les données ne vivent que dans ce navigateur et où le serveur n'a rien à
 * relire. On ne l'envoie donc que dans ce cas : l'expédier toujours ferait
 * croire à chaque lecteur de ce fichier que le client décide encore.
 */
export async function solvePaidLeaveCampaign(
  campaignId: string,
  options: {
    readonly timeoutSeconds?: number
    readonly fallbackRequest?: PaidLeaveSolveRequest
  } = {},
  signal?: AbortSignal
): Promise<PaidLeaveSolveResponse> {
  try {
    const response = await fetch("/api/conges/solve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        campaignId,
        timeoutSeconds: options.timeoutSeconds ?? 60,
        request: options.fallbackRequest,
      }),
      signal,
    })
    const value: unknown = await response.json()
    if (!response.ok) {
      const message = typeof value === "object" && value !== null && "message" in value
        ? String(value.message)
        : `Erreur HTTP ${response.status}`
      return { status: "error", message, durationMs: 0 }
    }
    const parsed = paidLeaveSolveResponseSchema.safeParse(value)
    return parsed.success
      ? parsed.data
      : { status: "error", message: "Réponse du solveur invalide.", durationMs: 0 }
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Le solveur ne répond pas.",
      durationMs: 0,
    }
  }
}

export function isOptimalPaidLeaveResponse(
  response: PaidLeaveSolveResponse
): response is Extract<PaidLeaveSolveResponse, { status: "optimal" }> {
  return response.status === "optimal"
}

function contractHours(employee: EmployeeRecord): number {
  return typeof employee.weeklyMinutes === "number"
    ? employee.weeklyMinutes / 60
    : employee.weeklyHours
}

export type { PaidLeaveReinforcementAllocation }
