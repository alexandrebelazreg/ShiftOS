import type { AbsenceRecord } from "@/features/absences/types/absence-record"
import type { EmployeeRecord } from "@/features/employees/types/employee.types"
import { campaignWeeks } from "@/features/paid-leave/calendar/campaign-weeks"
import { absentWeeksByEmployee } from "@/features/paid-leave/domain/already-absent"
import {
  activeClosureWeeks,
  activeForbiddenWeeks,
  attributableWeekIds,
  effectiveRequestedWeeks,
  grantIsEntirelyFirstChoice,
  grantableWishes,
  grantsMatchSolution,
  orphanedWishes,
  paidLeaveTargets,
  wishPlansDisagree,
} from "@/features/paid-leave/domain/campaign"
import { readPaidLeaveLegally } from "@/features/paid-leave/domain/legal-leave"
import type {
  PaidLeaveCampaign,
  PaidLeaveWeekId,
} from "@/features/paid-leave/models/paid-leave-campaign"
import type { SectorDemandConfiguration } from "@/features/sectors"

/**
 * Ce qu'il faut savoir AVANT de lancer un calcul, et ce qu'il faut dire APRÈS.
 *
 * Deux fonctions pures, parce que les deux ont le même défaut à corriger : la
 * génération réussissait en silence. Elle annonçait « solution optimale » après
 * avoir n'accordé aucune semaine, et elle ne prévenait pas que certaines
 * personnes ne pesaient sur aucun minimum de couverture. Un calcul qui se
 * félicite de n'avoir rien fait est pire qu'un calcul en échec : personne ne va
 * chercher pourquoi.
 */

export interface PaidLeaveGenerationWarning {
  readonly kind:
    | "sector"
    | "orphaned-wishes"
    | "forbidden-wishes"
    | "uneven-wishes"
    | "no-wishes"
    | "already-absent"
    | "granted-while-absent"
    | "over-entitlement"
    | "closure-over-entitlement"
    | "main-leave-split"
    | "fractionation"
    | "equity-mismatch"
  readonly message: string
}

export interface PaidLeaveReportInput {
  readonly campaign: PaidLeaveCampaign
  readonly employees: readonly EmployeeRecord[]
  readonly sectors: readonly SectorDemandConfiguration[]
  readonly weekIds: ReadonlySet<PaidLeaveWeekId>
  /** Ce qui est déjà posé ailleurs. Vide quand l'appelant ne les a pas chargées. */
  readonly absences?: readonly AbsenceRecord[]
}

/** Au plus ce nombre de noms dans un message ; au-delà, on compte. */
const NAMES_SHOWN = 3

/**
 * Ce qui faussera le calcul, dit avant de le lancer.
 *
 * Des avertissements et non des refus : un gérant peut vouloir une proposition
 * pendant que deux fiches restent à compléter, et un blocage se contournerait
 * en désactivant les gens. Mais il doit savoir ce qu'il regarde.
 */
export function paidLeaveGenerationWarnings(
  input: PaidLeaveReportInput
): readonly PaidLeaveGenerationWarning[] {
  const active = input.employees.filter((employee) => employee.status === "active")
  const sectorNames = new Set(
    input.sectors.filter((sector) => sector.status === "active").map((sector) => sector.name)
  )
  const warnings: PaidLeaveGenerationWarning[] = []

  // Un salarié dont le rayon principal ne correspond à aucun secteur actif part
  // au solveur avec un secteur nul, et son absence ne pèse alors sur AUCUN
  // minimum : la couverture paraît tenue là où elle ne l'est pas.
  const withoutSector = active.filter(
    (employee) => !employee.sectors?.[0] || !sectorNames.has(employee.sectors[0])
  )
  if (withoutSector.length > 0) {
    warnings.push({
      kind: "sector",
      message:
        `${listNames(withoutSector)} ${plural(withoutSector.length, "n’a", "n’ont")} pas de rayon principal reconnu : ` +
        `${plural(withoutSector.length, "son absence ne pèsera", "leurs absences ne pèseront")} sur aucun minimum de couverture.`,
    })
  }

  // Des vœux hors période survivent à un changement de période. Ils ne peuvent
  // plus être accordés, et sans cette ligne la personne paraît simplement
  // mal servie.
  const withOrphans = active.filter(
    (employee) => orphanedWishes(input.campaign.requests[employee.id], input.weekIds).length > 0
  )
  if (withOrphans.length > 0) {
    warnings.push({
      kind: "orphaned-wishes",
      message:
        `${listNames(withOrphans)} ${plural(withOrphans.length, "a", "ont")} des vœux hors de la période de la campagne : ` +
        `ces semaines ne peuvent pas être attribuées.`,
    })
  }

  // DES VŒUX SUR UNE SEMAINE INTERDITE.
  //
  // Voisin des vœux hors période, et distinct : ces semaines sont bien dans la
  // campagne, c'est le gérant qui les a fermées à tout congé. La cible s'en
  // trouve réduite — la personne ne sera donc PAS annoncée incomplète, ce qui
  // est voulu : on ne reproche pas à quelqu'un une décision qu'on a prise
  // soi-même. Mais il faut dire que ces vœux-là ne serviront à rien, sans quoi
  // la personne paraîtrait simplement moins bien servie que les autres.
  const interdites = activeForbiddenWeeks(input.campaign)
  const surSemainesInterdites = interdites.size === 0 ? [] : active.filter((employee) => {
    const demande = input.campaign.requests[employee.id]
    if (!demande) return false
    return [...demande.wish1, ...demande.wish2, ...demande.wish3].some((weekId) =>
      interdites.has(weekId)
    )
  })
  if (surSemainesInterdites.length > 0) {
    warnings.push({
      kind: "forbidden-wishes",
      message:
        `${listNames(surSemainesInterdites)} ${plural(surSemainesInterdites.length, "a", "ont")} des vœux sur `
        + `une semaine interdite : ces semaines ne seront attribuées à personne, et `
        + `${plural(surSemainesInterdites.length, "sa demande est réduite", "leurs demandes sont réduites")} d'autant.`,
    })
  }

  // Trois plans de tailles différentes ne décrivent pas la même absence. C'est
  // le plus grand qui fait foi, donc rien n'est perdu — mais c'est presque
  // toujours une saisie inachevée, et la personne obtiendra plus ou moins que
  // ce que le gérant croit avoir demandé.
  const uneven = active.filter((employee) =>
    wishPlansDisagree(input.campaign.requests[employee.id], input.weekIds)
  )
  if (uneven.length > 0) {
    warnings.push({
      kind: "uneven-wishes",
      message:
        `${listNames(uneven)} ${plural(uneven.length, "n’a", "n’ont")} pas le même nombre de semaines ` +
        `dans chaque vœu : c’est le plus grand qui sera demandé.`,
    })
  }

  // Le solveur cloue ces semaines à zéro, donc il ne les accordera pas. Sans
  // cette ligne, la personne paraîtrait simplement mal servie — et le gérant
  // chercherait la cause dans la couverture, où elle n'est pas.
  const dejaAbsents = absentWeeksByEmployee(
    input.absences ?? [],
    campaignWeeks(input.campaign.year, input.campaign.period)
  )
  const surSemainesAbsentes = active.filter((employee) => {
    const bloquees = dejaAbsents.get(employee.id)
    if (!bloquees) return false
    return grantableWishes(input.campaign.requests[employee.id], input.weekIds).some(
      (weekId) => bloquees.has(weekId)
    )
  })
  if (surSemainesAbsentes.length > 0) {
    warnings.push({
      kind: "already-absent",
      message:
        `${listNames(surSemainesAbsentes)} ${plural(surSemainesAbsentes.length, "a", "ont")} des vœux sur des semaines ` +
        `où ${plural(surSemainesAbsentes.length, "il est déjà absent", "ils sont déjà absents")} ` +
        `(arrêt, congé parental, formation…) : ces semaines ne peuvent pas être attribuées.`,
    })
  }

  // ET CE QUI EST DÉJÀ ACCORDÉ, PAS SEULEMENT CE QUI EST SOUHAITÉ.
  //
  // La ligne précédente regarde les vœux : elle prévient avant le calcul. Mais
  // une attribution peut devenir impossible APRÈS coup — la semaine est
  // accordée, puis l'arrêt maladie est saisi. Le solveur ne produirait jamais
  // cet état, et rien ne le signalait : la couverture compte la personne absente
  // une seule fois, donc aucune cellule ne rougit, et la paie découvre une
  // semaine décomptée du solde pendant un arrêt.
  const accordeesPendantUneAbsence = active.filter((employee) => {
    const bloquees = dejaAbsents.get(employee.id)
    if (!bloquees) return false
    return (input.campaign.grants[employee.id] ?? []).some((weekId) => bloquees.has(weekId))
  })
  if (accordeesPendantUneAbsence.length > 0) {
    warnings.push({
      kind: "granted-while-absent",
      message:
        `${listNames(accordeesPendantUneAbsence)} ${plural(accordeesPendantUneAbsence.length, "a", "ont")} des semaines ` +
        `ACCORDÉES qui tombent sur une absence déjà enregistrée : à corriger avant de valider, ` +
        `sinon la semaine sera décomptée du solde de congés pendant un arrêt.`,
    })
  }

  // PLUS DE SEMAINES DEMANDÉES QUE DE SOLDE RESTANT.
  //
  // La cible est bornée par le solde, donc le calcul n'accordera jamais plus
  // que le droit. Mais sans cette ligne, la personne paraîtrait simplement mal
  // servie — et le gérant chercherait la cause dans la couverture, où elle
  // n'est pas. C'est exactement la raison d'être de l'avertissement sur les
  // semaines déjà absentes.
  // Le `?.` sur `employeeSettings` n'est pas de la superstition : une campagne
  // écrite avant ce champ, ou reconstruite depuis un enregistrement partiel, n'a
  // pas de réglages du tout. Un compte rendu qui lève ne dit plus rien de la
  // génération qu'il devait expliquer.
  // LE SOLDE RESTANT APRÈS LA FERMETURE, et non le solde brut : deux semaines
  // fermées sur un solde de cinq en laissent trois à arbitrer, et quelqu'un qui
  // en demande quatre à côté en pose bien une de trop — ce que la comparaison au
  // solde brut ne voyait pas.
  const fermees = activeClosureWeeks(input.campaign).size
  const attribuables = attributableWeekIds(input.campaign)
  const auDelaDuSolde = active.filter((employee) => {
    const solde = input.campaign.employeeSettings?.[employee.id]?.entitlementWeeks
    if (solde === null || solde === undefined) return false
    return (
      effectiveRequestedWeeks(input.campaign.requests[employee.id], attribuables)
      > Math.max(0, Math.floor(solde) - fermees)
    )
  })
  if (auDelaDuSolde.length > 0) {
    warnings.push({
      kind: "over-entitlement",
      message:
        `${listNames(auDelaDuSolde)} ${plural(auDelaDuSolde.length, "demande", "demandent")} plus de semaines ` +
        `qu'il ne ${plural(auDelaDuSolde.length, "lui en reste", "leur en reste")} au solde : ` +
        `${plural(auDelaDuSolde.length, "il n'en recevra", "ils n'en recevront")} que ce à quoi ` +
        `${plural(auDelaDuSolde.length, "il a droit", "ils ont droit")}.`,
    })
  }

  // LA FERMETURE À ELLE SEULE DÉPASSE LE SOLDE.
  //
  // Elle ne s'arbitre pas : la personne sera en congé ces semaines-là qu'elle
  // ait le solde ou non. Le dépassement est donc un fait, pas une demande à
  // refuser — et c'est exactement pourquoi il doit être dit ici plutôt que
  // corrigé en silence : il se règle en paie, en congé sans solde ou en
  // anticipation, et personne ne peut le décider à la place du gérant.
  const fermetureAuDelaDuSolde = fermees === 0 ? [] : active.filter((employee) => {
    const solde = input.campaign.employeeSettings?.[employee.id]?.entitlementWeeks
    if (solde === null || solde === undefined) return false
    return Math.floor(solde) < fermees
  })
  if (fermetureAuDelaDuSolde.length > 0) {
    warnings.push({
      kind: "closure-over-entitlement",
      message:
        `La fermeture dure ${fermees} semaine${fermees > 1 ? "s" : ""}, et `
        + `${listNames(fermetureAuDelaDuSolde)} ${plural(fermetureAuDelaDuSolde.length, "n'a", "n'ont")} pas `
        + `${plural(fermetureAuDelaDuSolde.length, "autant à poser", "autant à poser")} au solde : `
        + `à régler hors de cet outil (congé sans solde, anticipation), la fermeture ne se refuse pas.`,
    })
  }

  // CE QUE LA LOI DIT DE L'ATTRIBUTION, UNE FOIS QU'ELLE EST POSÉE.
  //
  // Les deux lignes qui suivent ne se lisent qu'APRÈS le calcul — elles portent
  // sur `grants`, vides tant que rien n'est attribué — et c'est voulu : ni l'une
  // ni l'autre n'est une contrainte du solveur, pour deux raisons opposées.
  //
  // La continuité se heurte à la couverture : imposée, elle rendrait
  // `infeasible` une campagne qu'on peut servir, et « rien » est une plus
  // mauvaise réponse qu'une attribution irrégulière annoncée comme telle.
  // Le fractionnement, lui, n'est pas un défaut : c'est un droit qui s'ouvre, et
  // il n'y a rien à optimiser — seulement quelque chose à ne pas découvrir en
  // paie.
  const lectures = active.map((employee) => ({
    employee,
    lecture: readPaidLeaveLegally(input.campaign, employee.id),
  }))

  const congePrincipalCoupe = lectures.filter((entry) => entry.lecture.mainLeaveSplit)
  if (congePrincipalCoupe.length > 0) {
    warnings.push({
      kind: "main-leave-split",
      message:
        `${listNames(congePrincipalCoupe.map((entry) => entry.employee))} `
        + `${plural(congePrincipalCoupe.length, "n'a", "n'ont")} aucun morceau de deux semaines consécutives `
        + `dans ${plural(congePrincipalCoupe.length, "son congé principal", "leur congé principal")} : `
        + `l'article L3141-19 impose douze jours ouvrables d'un seul tenant. À regrouper à la main, `
        + `ou à justifier par la couverture du rayon.`,
    })
  }

  const fractionnement = lectures.filter((entry) => entry.lecture.fractionationDays > 0)
  if (fractionnement.length > 0) {
    const jours = Math.max(...fractionnement.map((entry) => entry.lecture.fractionationDays))
    warnings.push({
      kind: "fractionation",
      message:
        `${listNames(fractionnement.map((entry) => entry.employee))} `
        + `${plural(fractionnement.length, "pose", "posent")} une partie de `
        + `${plural(fractionnement.length, "son congé principal", "leur congé principal")} hors du `
        + `1er mai – 31 octobre : cela ouvre droit à ${jours} jour${jours > 1 ? "s" : ""} ouvrable${jours > 1 ? "s" : ""} `
        + `de fractionnement (L3141-23), auxquels le salarié peut renoncer par écrit.`,
    })
  }

  // LE DOUBLON, RENDU BRUYANT.
  //
  // « Servi sur tout son premier vœu » est écrit DEUX FOIS : en Python parce que
  // le solveur l'optimise, ici parce que la validation doit savoir juger des
  // attributions retouchées à la main, que le solveur n'a jamais vues. Le
  // doublon est donc nécessaire. Son SILENCE ne l'était pas.
  //
  // C'est le désaccord le plus coûteux du module, et le plus lent à se voir :
  // la validation fige cette liste dans `fullFirstChoiceEmployeeIds`, l'équité
  // de la campagne SUIVANTE s'en sert, et l'écart n'apparaît donc qu'un an plus
  // tard sous la forme « pourquoi cette personne ne passe-t-elle pas devant ? ».
  //
  // Comparé sur de VRAIES données, à chaque calcul — ce qu'aucun jeu d'essai
  // écrit à l'avance ne couvrirait, puisque par construction on n'écrit que les
  // cas auxquels on a pensé.
  const compteParLeSolveur = input.campaign.solution?.firstChoiceEmployeeIds
  if (compteParLeSolveur && grantsMatchSolution(input.campaign)) {
    const compteParLEcran = active
      .filter((employee) => {
        const demande = input.campaign.requests[employee.id]
        return demande
          ? grantIsEntirelyFirstChoice(
              demande,
              input.campaign.grants[employee.id] ?? [],
              attribuables
            )
          : false
      })
      .map((employee) => employee.id)

    // COMPARÉ SUR LES SEULS SALARIÉS ENCORE ACTIFS, et ce n'est pas une
    // précaution de style. Désactiver une fiche après le calcul la sort de la
    // lecture de l'écran sans la sortir de la liste du solveur : l'alarme
    // sonnerait pour un départ, c'est-à-dire pour rien. Et il n'y a
    // effectivement plus rien à vérifier sur quelqu'un qui a quitté la campagne.
    const actifs = new Set(active.map((employee) => employee.id))
    const retenus = compteParLeSolveur.filter((id) => actifs.has(id))
    const solveur = new Set(retenus)
    const ecran = new Set(compteParLEcran)
    const desaccord = [
      ...retenus.filter((id) => !ecran.has(id)),
      ...compteParLEcran.filter((id) => !solveur.has(id)),
    ]
    if (desaccord.length > 0) {
      const noms = active.filter((employee) => desaccord.includes(employee.id))
      warnings.push({
        kind: "equity-mismatch",
        message:
          `Le calcul et l'écran ne comptent pas de la même façon qui a été servi sur tout son `
          + `premier vœu : ${listNames(noms)} ${plural(noms.length, "est compté", "sont comptés")} `
          + `d'un côté et pas de l'autre. À signaler avant de valider — c'est cette liste qui `
          + `décide des priorités de la campagne suivante.`,
      })
    }
  }

  const noWishes = active.filter(
    (employee) => grantableWishes(input.campaign.requests[employee.id], attribuables).length === 0
  )
  if (noWishes.length > 0) {
    warnings.push({
      kind: "no-wishes",
      message:
        `${listNames(noWishes)} ${plural(noWishes.length, "n’a", "n’ont")} aucun vœu dans la période : ` +
        `${plural(noWishes.length, "aucune semaine ne peut lui être attribuée", "aucune semaine ne peut leur être attribuée")}.`,
    })
  }

  return warnings
}

export interface PaidLeaveOutcome {
  readonly grantedWeeks: number
  readonly requestedWeeks: number
  readonly incompleteEmployees: number
  /** La phrase à afficher, déjà formulée. */
  readonly message: string
}

/**
 * Ce que la génération a réellement produit.
 *
 * « Solution optimale trouvée en 1,2 s » ne dit pas si quelqu'un a obtenu quoi
 * que ce soit — et l'optimum d'un problème où personne ne demande rien est
 * l'ensemble vide. Le compte rendu porte donc les trois nombres qui décident de
 * la suite : accordé, demandé, et combien de personnes restent incomplètes.
 */
export function describePaidLeaveOutcome(
  input: PaidLeaveReportInput & { readonly durationMs: number }
): PaidLeaveOutcome {
  const active = input.employees.filter((employee) => employee.status === "active")
  const targetOf = paidLeaveTargets(input.campaign)
  // Les semaines ATTRIBUABLES des deux côtés du rapport. Compter « demandé » sur
  // la campagne entière et « attribué » sur ce qui reste ouvert ferait dire
  // « 2 sur 3 » à une campagne qui a tout servi, la troisième semaine étant
  // celle de la fermeture — que la personne obtient bel et bien.
  const attribuables = attributableWeekIds(input.campaign)
  const fermees = activeClosureWeeks(input.campaign).size
  let grantedWeeks = 0
  let requestedWeeks = 0
  let incompleteEmployees = 0

  for (const employee of active) {
    const granted = input.campaign.grants[employee.id]?.length ?? 0
    const requested = effectiveRequestedWeeks(input.campaign.requests[employee.id], attribuables)
    // DEUX NOMBRES, ET PAS UN. « Demandé » se lit sur le vœu ; « incomplète » se
    // juge sur ce qu'on pouvait réellement accorder. Les confondre déclarerait
    // incomplète à vie une personne qui a reçu tout son solde — elle a demandé
    // cinq semaines, elle n'en avait que trois, elle a ses trois.
    const accordable = targetOf(employee.id)
    grantedWeeks += granted
    requestedWeeks += requested
    if (granted !== accordable) incompleteEmployees += 1
  }

  const seconds = (input.durationMs / 1000).toFixed(1)
  const head =
    requestedWeeks === 0
      ? "Aucune semaine n’était demandée : le calcul n’avait rien à attribuer."
      : `${grantedWeeks} semaine${grantedWeeks > 1 ? "s" : ""} attribuée${grantedWeeks > 1 ? "s" : ""} sur ${requestedWeeks} demandée${requestedWeeks > 1 ? "s" : ""}.`
  const tail =
    incompleteEmployees > 0
      ? ` ${incompleteEmployees} personne${incompleteEmployees > 1 ? "s" : ""} reste${incompleteEmployees > 1 ? "nt" : ""} incomplète${incompleteEmployees > 1 ? "s" : ""}.`
      : requestedWeeks > 0
        ? " Toutes les demandes sont servies."
        : ""

  // La fermeture n'est pas une attribution, donc elle n'entre dans aucun des
  // deux comptes — et c'est justement pourquoi il faut la dire : sans cette
  // phrase, deux semaines de congé pour toute l'équipe n'apparaîtraient nulle
  // part dans le compte rendu du calcul qui vient de les prendre en compte.
  const fermeture =
    fermees > 0
      ? ` Fermeture du magasin : ${fermees} semaine${fermees > 1 ? "s" : ""} pour tout le monde, hors attribution.`
      : ""

  return {
    grantedWeeks,
    requestedWeeks,
    incompleteEmployees,
    message: `${head}${tail}${fermeture} Optimum prouvé en ${seconds} s.`,
  }
}

function listNames(employees: readonly EmployeeRecord[]): string {
  const names = employees.map((employee) => `${employee.firstName} ${employee.lastName}`.trim())
  if (names.length <= NAMES_SHOWN) return names.join(", ")
  return `${names.slice(0, NAMES_SHOWN).join(", ")} et ${names.length - NAMES_SHOWN} autre${
    names.length - NAMES_SHOWN > 1 ? "s" : ""
  }`
}

function plural(count: number, one: string, many: string): string {
  return count > 1 ? many : one
}
