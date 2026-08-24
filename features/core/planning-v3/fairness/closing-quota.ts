import type { EmployeeId } from "@/features/core/models"
import {
  compareClosingLoad,
  loadsAfterWeek,
  weeklyClosingShare,
  type ClosingLoad,
} from "@/features/core/planning-v3/fairness/closing-load"
import type { PlanningProblemV3 } from "@/features/core/planning-v3/types/problem"

/**
 * Le plafond de fermetures que l'ÉQUITÉ impose pour cette semaine-là.
 *
 * L'équité était jusqu'ici une préférence, classée sous la couverture et sous le
 * placement des heures contractuelles. Une fois ces heures posées, il ne restait
 * plus de liberté : le moteur remplissait les plus disponibles jusqu'à leur
 * plafond, et les mêmes fermaient toutes les semaines. Corriger après coup ne
 * marchait pas non plus — mesuré sur une semaine réelle, chaque échange
 * possible était refusé par une borne horaire personnelle ou le repos de douze
 * heures, parce que « qui ferme » se décide EN MÊME TEMPS que « à quelle heure
 * chacun travaille », et ne se rattrape pas ensuite.
 *
 * D'où ce détour : plutôt qu'un objectif de plus dans le solveur, on resserre
 * une contrainte QUI EXISTE DÉJÀ et que le placement respecte déjà. Le plafond
 * de fermetures est dur ; le baisser pour ceux qui ont le plus fermé oblige le
 * moteur à répartir dès le départ, au seul moment où la décision se prend.
 *
 * C'est exactement le geste qu'un gérant fait à la main quand il en a assez de
 * voir les deux mêmes fermer. Ici il est calculé, et il est expliqué.
 *
 * DEUX RÈGLES QUI NE SE NÉGOCIENT PAS :
 *
 * - Le quota ne dépasse JAMAIS le plafond réglé sur la fiche. Il ne peut que
 *   resserrer, jamais autoriser ce que le gérant a interdit.
 * - Il ne descend jamais sous ce que la semaine exige. Distribuer six
 *   fermetures entre cinq personnes en plafonnant chacune à une rendrait la
 *   semaine infaisable ; le total distribué vaut donc exactement le nombre de
 *   fermetures à couvrir.
 *
 * Reste un risque que le calcul ne peut pas écarter : un JOUR précis dont tous
 * les fermeurs possibles se trouvent à leur quota. L'appelant doit donc savoir
 * réessayer sans quota — voir l'adaptateur, qui garde la solution sans quota
 * quand celle avec quota n'existe pas.
 */

export interface ClosingQuota {
  readonly employeeId: EmployeeId
  /** Ce que l'équité lui attribue pour cette semaine. */
  readonly allowed: number
  /** Son plafond de fiche, pour que le rapport puisse dire lequel a mordu. */
  readonly contractual: number | null
}

export interface ClosingQuotaPlan {
  readonly quotas: readonly ClosingQuota[]
  /** Le problème à envoyer au moteur, plafonds resserrés. */
  readonly problem: PlanningProblemV3
  /** Faux quand rien n'a changé — équité éteinte, ou aucun resserrement utile. */
  readonly applied: boolean
  /**
   * POURQUOI rien n'a été posé, quand rien ne l'a été.
   *
   * Un mécanisme d'observation qui se tait dans le cas intéressant ne sert à
   * rien : c'est exactement quand le plafond ne s'applique pas qu'il faut
   * savoir ce qui l'en a empêché. La raison est donc toujours rendue, et
   * toujours rapportée.
   */
  readonly reason: string | null
}

/** Combien de fois cette personne pourrait fermer, au plus, dans cette semaine. */
function feasibleClosingDays(problem: PlanningProblemV3, employeeId: string): number {
  let count = 0
  for (const day of problem.days) {
    if (day.closed || day.closesAtMinutes === null) continue
    const entry = problem.employeeDays.find(
      (candidate) => candidate.date === day.date && String(candidate.employeeId) === employeeId
    )
    if (!entry || !entry.available) continue
    if (entry.latestEndMinutes < day.closesAtMinutes) continue
    count += 1
  }
  return count
}

export function planClosingQuotas(problem: PlanningProblemV3): ClosingQuotaPlan {
  const declined = (reason: string): ClosingQuotaPlan => ({
    quotas: [],
    problem,
    applied: false,
    reason,
  })
  const fairness = problem.rules.closingFairness
  if (!fairness || (!fairness.balanceClosings && !fairness.balanceSaturdayClosings)) {
    return declined("l'équité des fermetures n'est pas activée sur ce secteur")
  }

  const closers = problem.employees.filter((employee) => employee.canClose)
  if (closers.length < 2) {
    return declined("moins de deux salariés peuvent fermer")
  }

  const openDays = problem.days.filter((day) => !day.closed && day.closesAtMinutes !== null)
  const needed = openDays.length * Math.max(0, problem.rules.exactClosingsPerDay)
  if (needed <= 0) {
    return declined(`aucune fermeture à répartir (${openDays.length} jours ouverts, ${problem.rules.exactClosingsPerDay} par jour)`)
  }

  // Ce que chacun peut porter au plus : son plafond de fiche, borné par le
  // nombre de jours où il pourrait réellement fermer.
  const ceiling = new Map<string, number>()
  for (const employee of closers) {
    const id = String(employee.id)
    const possible = feasibleClosingDays(problem, id)
    ceiling.set(id, Math.min(employee.maximumClosings ?? possible, possible))
  }

  const capacity = [...ceiling.values()].reduce((sum, value) => sum + value, 0)
  // Pas assez de capacité pour couvrir la semaine : resserrer encore ne ferait
  // qu'ajouter une infaisabilité à une autre. On laisse le moteur faire au mieux.
  if (capacity < needed) {
    return declined(`capacité insuffisante : ${capacity} fermetures possibles pour ${needed} à couvrir`)
  }

  // Distribution au plus léger d'abord, une fermeture à la fois. Les charges
  // sont recalculées à chaque tour : celui qui vient de recevoir descend dans
  // l'ordre, ce qui répartit au lieu de tout donner au premier.
  const shares: Record<string, number> = {}
  for (const employee of closers) {
    shares[String(employee.id)] = weeklyClosingShare(employee.workingDays.length)
  }
  const given: Record<string, number> = Object.fromEntries(closers.map((e) => [String(e.id), 0]))

  // UN PLANCHER D'UNE FERMETURE pour quiconque peut fermer au moins un jour.
  //
  // La répartition purement équitable attribuait ZÉRO au plus chargé — ce qui
  // est arithmétiquement juste et pratiquement intenable : l'exclure d'un coup
  // laisse des journées sans fermeur possible, la semaine devient infaisable, et
  // le plafond entier est abandonné au profit des plafonds ordinaires. Mesuré
  // sur un magasin réel : « aucun planning légal ne respectait ces plafonds ».
  //
  // Un quota rejeté ne vaut rien. Mieux vaut resserrer un peu moins et que cela
  // tienne : garder chacun à une fermeture au moins préserve, chaque jour, un
  // vivier suffisant, tout en faisant descendre les plus chargés de deux à une.
  //
  // Sauté quand la semaine compte moins de fermetures que de fermeurs : il n'y
  // aurait alors pas de quoi servir tout le monde, et forcer le plancher
  // distribuerait plus de fermetures qu'il n'en existe.
  let remaining = needed
  if (needed >= closers.length) {
    for (const employee of closers) {
      const id = String(employee.id)
      if ((ceiling.get(id) ?? 0) < 1) continue
      given[id] = 1
      remaining -= 1
    }
  }

  for (let placed = 0; placed < remaining; placed += 1) {
    const eligible = closers.filter(
      (employee) => given[String(employee.id)] < (ceiling.get(String(employee.id)) ?? 0)
    )
    if (eligible.length === 0) break

    const loads: ClosingLoad[] = loadsAfterWeek(
      problem.closingHistory ?? [],
      given,
      shares,
      eligible.map((employee) => employee.id)
    )
    const lightest = loads.reduce((best, load) => (compareClosingLoad(load, best) < 0 ? load : best))
    given[String(lightest.employeeId)] += 1
  }

  // ON NE RESSERRE QUE CEUX QUI ONT TROP FERMÉ, et on laisse les autres libres.
  //
  // Prescrire à chacun un nombre exact revenait à choisir UNE répartition parmi
  // toutes celles qui sont équitables — et si celle-là se trouve infaisable, tout
  // est rejeté. Mesuré sur un magasin réel : le quota exact faisait une capacité
  // de six pour six fermetures à couvrir, soit AUCUNE marge, et le moindre
  // conflit un jour donné condamnait la semaine entière. Le gérant, lui, obtenait
  // un bon planning en posant « personne au-dessus d'une, sauf un » — c'est-à-dire
  // des bornes, pas une répartition.
  //
  // Le repère est la charge la plus légère de l'équipe : quiconque est au-dessus
  // a déjà plus fermé que le moins servi, et peut donc être retenu. Les autres
  // gardent leur plafond de fiche, ce qui laisse au moteur la marge de chercher.
  const historic = loadsAfterWeek(
    problem.closingHistory ?? [],
    Object.fromEntries(closers.map((employee) => [String(employee.id), 0])),
    shares,
    closers.map((employee) => employee.id)
  )
  // Comparaison des CHARGES seules, par produit en croix. `compareClosingLoad`
  // ne conviendrait pas ici : c'est un ordre TOTAL, qui départage les charges
  // égales par identifiant — deux salariés aussi peu servis l'un que l'autre s'y
  // retrouveraient l'un « au-dessus » de l'autre, et se verraient resserrés sans
  // raison.
  // Le repère est la charge MOYENNE de l'équipe, pas la plus légère. Prendre la
  // plus légère ferait qu'un nouveau venu, qui n'a jamais fermé, classerait
  // d'un coup toute l'équipe parmi les « trop servis » et la resserrerait
  // entière — alors que son arrivée ne dit rien sur ce que les autres ont fait.
  const totalClosings = historic.reduce((sum, load) => sum + load.closings, 0)
  const totalOpportunities = historic.reduce((sum, load) => sum + load.opportunities, 0)
  const overServed = new Set(
    historic
      // Produit en croix, sans division : la comparaison reste exacte en
      // entiers, comme partout ailleurs dans l'équité.
      .filter((load) => load.closings * totalOpportunities > totalClosings * load.opportunities)
      .map((load) => String(load.employeeId))
  )

  const quotas: ClosingQuota[] = closers.map((employee) => {
    const id = String(employee.id)
    return {
      employeeId: employee.id,
      allowed: overServed.has(id) ? given[id] : (employee.maximumClosings ?? ceiling.get(id) ?? 0),
      contractual: employee.maximumClosings,
    }
  })

  // La capacité qui restera au moteur après resserrement. Sans marge au-dessus
  // du strict nécessaire, un seul conflit journalier condamne la semaine — et un
  // quota rejeté ne vaut rien.
  const tightened = quotas.reduce(
    (sum, quota) => sum + Math.min(quota.allowed, ceiling.get(String(quota.employeeId)) ?? 0),
    0
  )
  if (tightened <= needed) {
    return declined(
      `resserrer laisserait ${tightened} fermetures possibles pour ${needed} à couvrir, sans aucune marge`
    )
  }

  // Rien à resserrer si personne ne descend sous son plafond de fiche : autant
  // envoyer le problème d'origine, et garder l'empreinte inchangée.
  const tightens = quotas.some(
    (quota) => quota.contractual === null || quota.allowed < quota.contractual
  )
  if (!tightens) {
    return declined(
      "aucun resserrement utile — la répartition équitable (" +
        quotas.map((quota) => `${String(quota.employeeId)} ${quota.allowed}`).join(", ") +
        ") ne descend sous aucun plafond de fiche"
    )
  }

  const allowedById = new Map(quotas.map((quota) => [String(quota.employeeId), quota.allowed]))
  return {
    quotas,
    applied: true,
    reason: null,
    problem: {
      ...problem,
      employees: problem.employees.map((employee) => {
        const allowed = allowedById.get(String(employee.id))
        return allowed === undefined
          ? employee
          : { ...employee, maximumClosings: Math.min(employee.maximumClosings ?? allowed, allowed) }
      }),
    },
  }
}
