import type { EmployeeRecord } from "@/features/employees/types/employee.types"
import {
  attributableWeekIds,
  grantIsEntirelyFirstChoice,
} from "@/features/paid-leave/domain/campaign"
import type {
  PaidLeaveCampaign,
  PaidLeaveWeekId,
} from "@/features/paid-leave/models/paid-leave-campaign"

/**
 * CE QUE LE DERNIER CALCUL A CHANGÉ.
 *
 * Le geste réel d'un gérant est une BOUCLE : il desserre un minimum, relance,
 * regarde, recommence. À chaque tour, l'écran remplaçait tout sans rien dire de
 * ce qui avait bougé — et comparer vingt-six colonnes de mémoire est un exercice
 * que personne ne réussit. Le prix des concessions dit quoi essayer ; ceci dit
 * si l'essai a payé.
 *
 * LA RÉFÉRENCE EST CE QU'IL AVAIT SOUS LES YEUX, pas la solution précédente du
 * solveur. Les deux diffèrent dès qu'il a retouché une semaine à la main, et
 * c'est bien à sa dernière version qu'il compare mentalement.
 *
 * Le nombre de premiers vœux se relit des DEUX côtés avec la même fonction —
 * jamais la liste que le solveur avait nommée pour l'ancienne campagne, qui ne
 * parlerait pas des attributions retouchées depuis.
 */

export interface PaidLeaveGrantChange {
  readonly employeeId: string
  readonly name: string
  readonly before: readonly PaidLeaveWeekId[]
  readonly after: readonly PaidLeaveWeekId[]
}

export interface PaidLeaveSolutionDiff {
  /** Qui n'a pas les mêmes semaines qu'avant, par nom. */
  readonly changed: readonly PaidLeaveGrantChange[]
  readonly weeksBefore: number
  readonly weeksAfter: number
  readonly firstChoiceBefore: number
  readonly firstChoiceAfter: number
}

/**
 * `null` quand il n'y a rien à comparer — et les deux cas comptent.
 *
 * Le premier calcul d'une campagne n'a pas de « avant » : annoncer que vingt
 * personnes ont changé de semaines serait exact et parfaitement inutile. Et une
 * campagne dont les attributions ont été retouchées APRÈS le calcul compare deux
 * choses dont l'une n'est plus à l'écran.
 */
export function comparePaidLeaveSolution(
  campaign: PaidLeaveCampaign,
  employees: readonly EmployeeRecord[]
): PaidLeaveSolutionDiff | null {
  const before = campaign.solution?.previousGrants
  if (!before) return null
  // Rien avant : c'est un premier calcul, pas un changement.
  if (!Object.values(before).some((weeks) => weeks.length > 0)) return null

  const after = campaign.solution?.grants ?? {}
  const attribuables = attributableWeekIds(campaign)
  const active = employees.filter((employee) => employee.status === "active")

  const changed: PaidLeaveGrantChange[] = []
  let weeksBefore = 0
  let weeksAfter = 0
  let firstChoiceBefore = 0
  let firstChoiceAfter = 0

  for (const employee of active) {
    const was = [...(before[employee.id] ?? [])].sort()
    const now = [...(after[employee.id] ?? [])].sort()
    weeksBefore += was.length
    weeksAfter += now.length

    const request = campaign.requests[employee.id]
    if (request) {
      if (grantIsEntirelyFirstChoice(request, was, attribuables)) firstChoiceBefore += 1
      if (grantIsEntirelyFirstChoice(request, now, attribuables)) firstChoiceAfter += 1
    }

    const identical =
      was.length === now.length && was.every((week, index) => week === now[index])
    if (!identical) {
      changed.push({
        employeeId: employee.id,
        name: `${employee.firstName} ${employee.lastName}`.trim(),
        before: was,
        after: now,
      })
    }
  }

  return {
    // Par nom : la liste se lit, elle ne se parcourt pas.
    changed: changed.sort((left, right) => left.name.localeCompare(right.name, "fr-FR")),
    weeksBefore,
    weeksAfter,
    firstChoiceBefore,
    firstChoiceAfter,
  }
}
