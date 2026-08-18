import type { IsoDate, WeekDay } from "@/features/core/models"
import { isoWeekKey } from "@/features/core/shared"
import type { PermanenceCalendar, PermanenceDay } from "@/features/permanence/calendar/permanence-calendar"
import type { PermanenceMember } from "@/features/permanence/domain/permanence-roster"
import {
  EMPTY_LOAD,
  totalPermanences,
  weekendBurden,
  withPermanence,
  type PermanenceLoad,
} from "@/features/permanence/models/permanence-load"
import {
  PERMANENCE_ROLE_LABELS,
  permanenceSlotKey,
  type PermanenceRole,
} from "@/features/permanence/models/permanence-month"

/**
 * La répartition d'un mois de permanences.
 *
 * DEUX TEMPS, et l'ordre en fait tout le sens :
 *
 * 1. les jours IMPOSÉS se posent d'abord, avant que quiconque n'ait de charge —
 *    sinon un jour imposé serait tantôt honoré, tantôt écrasé par l'équilibrage,
 *    selon l'ordre du calendrier, ce qui est la définition de l'arbitraire ;
 * 2. le reste se remplit journée par journée, en donnant chaque case à la
 *    personne qui en a le moins porté.
 *
 * Glouton, et non optimal. Un solveur trouverait mieux de quelques cases, au
 * prix d'une décision que le gérant ne saurait pas relire ; ici chaque
 * affectation s'explique par une phrase — « c'est elle qui avait le moins de
 * samedis ». Le récapitulatif est là pour qu'on puisse le vérifier, et la
 * retouche à la main pour qu'on puisse ne pas être d'accord.
 */

export interface PermanenceGap {
  readonly date: IsoDate
  readonly role: PermanenceRole
  readonly message: string
}

export interface PermanenceGenerationResult {
  readonly assignments: Readonly<Record<string, string>>
  readonly rest: Readonly<Record<IsoDate, readonly string[]>>
  /** Les cases que personne ne pouvait prendre, et pourquoi. */
  readonly gaps: readonly PermanenceGap[]
  /** Les jours imposés qui n'ont pas pu l'être — deux fiches se disputent la même case. */
  readonly conflicts: readonly PermanenceGap[]
}

export interface PermanenceGenerationInput {
  readonly calendar: PermanenceCalendar
  readonly roster: readonly PermanenceMember[]
  /** Qui est indisponible ce jour-là : absences, congés posés. */
  readonly unavailableOn?: (date: IsoDate) => ReadonlySet<string>
  /**
   * Ce que chacun a déjà porté cette année, avant ce mois.
   *
   * Sans lui l'équité redémarrerait à zéro tous les mois, et celui qui a fait
   * tous les samedis de janvier aurait exactement autant de chances d'hériter
   * de ceux de février. L'équité d'un tour de permanence se compte sur l'année,
   * c'est bien pourquoi la feuille porte un récapitulatif annuel.
   */
  readonly history?: Readonly<Record<string, PermanenceLoad>>
}

export function generatePermanenceMonth(
  input: PermanenceGenerationInput
): PermanenceGenerationResult {
  const { calendar, roster, unavailableOn, history } = input

  const assignments = new Map<string, string>()
  const gaps: PermanenceGap[] = []
  const conflicts: PermanenceGap[] = []

  const load = new Map<string, PermanenceLoad>(
    roster.map((member) => [member.employeeId, history?.[member.employeeId] ?? EMPTY_LOAD])
  )
  /** Combien de permanences chacun tient déjà dans une semaine ISO donnée. */
  const weekLoad = new Map<string, number>()
  /** Les journées où quelqu'un tient déjà une permanence — une par jour, pas deux. */
  const busyDays = new Set<string>()
  /**
   * Ce que chacun tient dans une semaine ISO, PAR RÔLE.
   *
   * Par rôle et pas seulement en total : c'est ce qui rend l'équité des
   * fermetures possible. Comparer des totaux tous rôles confondus revient à
   * écarter des fermetures celui qui ouvre beaucoup, et les fermetures se
   * concentrent alors sur ceux qui n'ouvrent pas — l'inverse exact de ce qu'on
   * cherche.
   *
   * Compté à part de `load`, qui démarre au passif de l'année : lu tel quel, un
   * plafond serait déjà atteint en février par quelqu'un qui a beaucoup fermé
   * en janvier, et le réglage voudrait dire tout autre chose que la fiche.
   */
  const weekRoleLoad = new Map<string, number>()
  const weekRoleKey = (employeeId: string, date: IsoDate, role: PermanenceRole) =>
    `${employeeId}_${isoWeekKey(date)}_${role}`

  const take = (day: PermanenceDay, role: PermanenceRole, member: PermanenceMember): void => {
    assignments.set(permanenceSlotKey(day.date, role), member.employeeId)
    load.set(
      member.employeeId,
      withPermanence(load.get(member.employeeId) ?? EMPTY_LOAD, day.weekDay, role)
    )
    const week = `${member.employeeId}_${isoWeekKey(day.date)}`
    weekLoad.set(week, (weekLoad.get(week) ?? 0) + 1)
    busyDays.add(`${member.employeeId}_${day.date}`)
    const roleKey = weekRoleKey(member.employeeId, day.date, role)
    weekRoleLoad.set(roleKey, (weekRoleLoad.get(roleKey) ?? 0) + 1)
  }

  /**
   * Peut-elle prendre CETTE case ?
   *
   * Ouvrir et fermer la même journée, c'est y être du matin au soir. Le tour
   * de permanence existe pour éviter cela, donc une journée déjà tenue est une
   * journée prise — y compris quand c'est la personne elle-même qui l'a
   * demandée par un jour imposé.
   */
  const available = (
    day: PermanenceDay,
    role: PermanenceRole,
    member: PermanenceMember
  ): boolean => {
    // Le droit de le faire d'abord : le reste ne se pose que si la question a
    // un sens. Vérifié ici et non à l'entrée, parce qu'il est par RÔLE — on
    // ferme rarement un magasin qu'on ne sait pas ouvrir, mais l'inverse est
    // ordinaire.
    if (!(role === "closing" ? member.canClose : member.canOpen)) return false
    if (member.daysOff.includes(day.weekDay)) return false
    if (busyDays.has(`${member.employeeId}_${day.date}`)) return false
    if (role === "closing" && !acceptsClosing(day, member)) return false
    return !(unavailableOn?.(day.date).has(member.employeeId) ?? false)
  }

  /**
   * Ferme-t-elle ce jour-là, et lui en reste-t-il ?
   *
   * Deux REFUS, et non deux malus au classement : une liste blanche et un
   * plafond ne se négocient pas contre un samedi de plus chez quelqu'un
   * d'autre. Les traiter comme des critères de tri aurait produit des feuilles
   * qui les enfreignent dès que l'équilibre y trouvait son compte.
   */
  const acceptsClosing = (day: PermanenceDay, member: PermanenceMember): boolean => {
    if (member.closingOnlyDays.length > 0 && !member.closingOnlyDays.includes(day.weekDay)) {
      return false
    }
    if (member.maxClosings === null) return true
    // Par semaine : ce qui pèse, c'est trois fermetures d'affilée, pas leur
    // total sur trente jours.
    return (weekRoleLoad.get(weekRoleKey(member.employeeId, day.date, "closing")) ?? 0)
      < member.maxClosings
  }

  /**
   * Les jours où cette personne DOIT tenir ce rôle.
   *
   * « Fermeture uniquement le lundi » en fait partie : dire qu'on ne ferme que
   * le lundi, c'est dire qu'on ferme le lundi. Lue comme une simple permission,
   * la liste blanche n'aurait servi qu'à retirer quelqu'un du tour sans jamais
   * lui donner la fermeture qu'elle annonce.
   */
  /**
   * Le tour de rôle des fermetures du samedi, s'il en existe un.
   *
   * Vide tant que personne ne s'est coché : un réglage que personne n'a touché
   * ne doit rien changer, et fermer les samedis à tout le monde parce que la
   * case existe serait la pire façon de l'introduire.
   */
  const saturdayTurnOver = roster.filter((member) => member.saturdayTurnOver)

  /**
   * Cette personne peut-elle prendre CE créneau au titre du tour de rôle ?
   *
   * Séparé de `available`, et volontairement : cette règle ne s'applique QU'AU
   * remplissage libre. Un samedi de fermeture imposé par une fiche est une
   * décision plus précise que l'appartenance à un groupe, et l'écraser en
   * silence ferait mentir la fiche.
   */
  const inTurnOver = (day: PermanenceDay, role: PermanenceRole, member: PermanenceMember) =>
    role !== "closing"
    || day.weekDay !== "saturday"
    || saturdayTurnOver.length === 0
    || member.saturdayTurnOver

  const requiredDays = (member: PermanenceMember, role: PermanenceRole): readonly WeekDay[] =>
    role === "closing"
      ? [...member.requiredClosingDays, ...member.closingOnlyDays]
      : member.requiredOpeningDays

  const prefersDay = (member: PermanenceMember, day: PermanenceDay, role: PermanenceRole) =>
    (role === "closing" ? member.preferredClosingDays : member.preferredOpeningDays).includes(
      day.weekDay
    )

  /**
   * Le classement d'une candidate, du critère le plus lourd au plus léger.
   *
   * LES QUATRE PREMIERS CRITÈRES PARLENT DU RÔLE QU'ON POURVOIT, et c'est tout
   * le sujet : une fermeture se compare à des fermetures. Le total tous rôles
   * confondus arrive après — il empêche quelqu'un de tenir six permanences
   * dans la semaine, mais il ne doit jamais décider QUI ferme. Placé plus haut,
   * il écartait des fermetures ceux qui ouvraient beaucoup, et les fermetures
   * se concentraient sur les autres.
   *
   * Les samedis et les dimanches passent avant le reste : ce sont les seules
   * journées dont la répartition se discute, et celles que le récapitulatif met
   * en colonne. Les préférences ne départagent qu'à charge égale — un jour
   * préféré qui ne se réaliserait jamais serait un champ décoratif.
   */
  const rank = (member: PermanenceMember, day: PermanenceDay, role: PermanenceRole): number[] => {
    const current = load.get(member.employeeId) ?? EMPTY_LOAD
    return [
      weekendBurden(current, day.weekDay, role),
      weekRoleLoad.get(weekRoleKey(member.employeeId, day.date, role)) ?? 0,
      role === "closing" ? current.closings : current.openings,
      totalPermanences(current),
      weekLoad.get(`${member.employeeId}_${isoWeekKey(day.date)}`) ?? 0,
      prefersDay(member, day, role) ? 0 : 1,
      busyDays.has(`${member.employeeId}_${previousDay(day.date)}`) ? 1 : 0,
    ]
  }

  const leastLoaded = (
    candidates: readonly PermanenceMember[],
    day: PermanenceDay,
    role: PermanenceRole
  ): PermanenceMember | null =>
    candidates.reduce<PermanenceMember | null>((champion, challenger) => {
      if (champion === null) return challenger
      return compare(rank(challenger, day, role), rank(champion, day, role)) < 0
        ? challenger
        : champion
    }, null)

  /**
   * Les candidates par GROUPES, du plus naturel au plus exceptionnel.
   *
   * On ne descend au groupe suivant que si le précédent est vide. Des groupes
   * et non des malus : un malus, si lourd soit-il, finit toujours par être
   * rattrapé quand les autres se chargent, et « en dernier recours » deviendrait
   * « un peu moins souvent ».
   *
   * 1. les ORDINAIRES. Tant qu'il en reste un, la réserve n'est pas ouverte —
   *    c'est ce que le réglage dit, mot pour mot ;
   * 2. la réserve, sur un jour qu'elle a dit PRÉFÉRER ;
   * 3. la réserve, sur n'importe quel autre jour.
   *
   * La coupure entre 2 et 3 est le seul endroit du générateur où une préférence
   * l'emporte sur l'équité, et elle le mérite : appeler quelqu'un qui n'est pas
   * censé venir est déjà exceptionnel, alors autant le déranger un jour qu'il a
   * dit accepter. Pour les ordinaires, la préférence reste un départage à charge
   * égale — l'équité du tour passe avant leurs goûts.
   *
   * La réserve est propre au RÔLE : quelqu'un peut être ordinaire à l'ouverture
   * et de dépannage à la fermeture, ce qui est le cas d'un adjoint.
   */
  const inReserve = (member: PermanenceMember, role: PermanenceRole) =>
    role === "closing" ? member.lastResortClosing : member.lastResortOpening

  const best = (
    candidates: readonly PermanenceMember[],
    day: PermanenceDay,
    role: PermanenceRole
  ): PermanenceMember | null => {
    const reserve = candidates.filter((member) => inReserve(member, role))
    const groups: readonly (readonly PermanenceMember[])[] = [
      candidates.filter((member) => !inReserve(member, role)),
      reserve.filter((member) => prefersDay(member, day, role)),
      reserve.filter((member) => !prefersDay(member, day, role)),
    ]
    return groups.reduce<PermanenceMember | null>(
      (found, group) => found ?? leastLoaded(group, day, role),
      null
    )
  }

  /**
   * Lequel des deux rôles pourvoir en premier, ce jour-là : LE PLUS RARE.
   *
   * Parce qu'une journée n'accepte pas la même personne deux fois. Si trois
   * personnes savent ouvrir et une seule fermer, commencer par l'ouverture peut
   * consommer l'unique fermeuse — elle ouvre, et la fermeture reste vide alors
   * qu'elle était tenable. Servir la rareté d'abord est la seule règle qui
   * empêche une case de se perdre par l'ordre dans lequel on l'a regardée.
   *
   * Recompté à chaque journée, jamais une fois pour toutes : les absences, les
   * congés et les repos changent le nombre de candidats d'un jour à l'autre.
   *
   * À égalité, la fermeture passe devant : c'est elle qui porte les contraintes
   * — droit, liste blanche, plafond — donc celle qui a le plus de chances
   * d'être la rare le jour où l'une des deux l'est.
   */
  const rolesByScarcity = (day: PermanenceDay): readonly PermanenceRole[] => {
    const candidates = (role: PermanenceRole) =>
      roster.filter((member) => available(day, role, member) && inTurnOver(day, role, member)).length
    return candidates("opening") < candidates("closing")
      ? ["opening", "closing"]
      : ["closing", "opening"]
  }

  const slots = calendar.openDays.flatMap((day) =>
    rolesByScarcity(day).map((role) => ({ day, role }))
  )

  // Temps 1 — les jours imposés, sur un tableau encore vierge.
  for (const { day, role } of slots) {
    // `requiredDays` est déjà vidé par la fiche quand le droit est retiré ;
    // le filtre de disponibilité s'en assure une seconde fois pour un effectif
    // construit ailleurs — un import, un test.
    const claimants = roster.filter((member) => requiredDays(member, role).includes(day.weekDay))
    const free = claimants.filter((member) => available(day, role, member))

    const winner = best(free, day, role)
    if (winner) take(day, role, winner)

    // Une case imposée à deux personnes ne peut pas les satisfaire toutes les
    // deux : c'est une contradiction ENTRE FICHES, et elle se corrige dans les
    // fiches. L'écran la nomme plutôt que de la trancher en silence.
    //
    // Sont aussi comptées ici les personnes que la journée occupe déjà — celle
    // qui a demandé à ouvrir ET fermer le même jour a obtenu l'ouverture, et
    // doit savoir que sa fermeture est partie ailleurs.
    const unhonoured = claimants.filter(
      (member) =>
        member.employeeId !== winner?.employeeId
        && !(unavailableOn?.(day.date).has(member.employeeId) ?? false)
    )
    if (unhonoured.length > 0) {
      conflicts.push({
        date: day.date,
        role,
        message: `${PERMANENCE_ROLE_LABELS[role].toLowerCase()} imposée à ${claimants.length} personnes : ${unhonoured
          .map((member) => member.name)
          .join(", ")} ne l’${unhonoured.length > 1 ? "ont" : "a"} pas obtenue.`,
      })
    }
  }

  // Temps 2 — le reste, à la charge la plus légère.
  //
  // La rareté se recompte ici : le temps 1 a posé des jours imposés, et une
  // journée dont l'ouverture est déjà prise n'a plus le même effectif
  // disponible qu'au moment où l'on préparait la liste.
  for (const day of calendar.openDays) {
    for (const role of rolesByScarcity(day)) {
    if (assignments.has(permanenceSlotKey(day.date, role))) continue

    const candidates = roster.filter(
      (member) => available(day, role, member) && inTurnOver(day, role, member)
    )
    const winner = best(candidates, day, role)
    if (winner) {
      take(day, role, winner)
      continue
    }

    gaps.push({ date: day.date, role, message: "personne n’est disponible ce jour-là." })
    }
  }

  return {
    assignments: Object.fromEntries(assignments),
    rest: restDays(calendar, roster),
    gaps,
    conflicts,
  }
}

/**
 * Les repos, repris des repos fixes des fiches.
 *
 * Rien n'est inventé ici : le tour de permanence ne décide pas des jours de
 * repos, il les MONTRE, parce qu'une feuille où l'on voit qui n'est pas là se
 * lit mieux qu'une feuille où l'on doit s'en souvenir. Le gérant peut ensuite
 * les corriger à la main, comme sur la feuille Excel.
 */
function restDays(
  calendar: PermanenceCalendar,
  roster: readonly PermanenceMember[]
): Readonly<Record<IsoDate, readonly string[]>> {
  const rest: Record<IsoDate, string[]> = {}
  for (const week of calendar.weeks) {
    for (const day of week.days) {
      if (!day.inMonth) continue
      const resting = roster
        .filter((member) => member.daysOff.includes(day.weekDay))
        .map((member) => member.employeeId)
      if (resting.length > 0) rest[day.date] = resting
    }
  }
  return rest
}

/** Comparaison lexicographique de deux classements. Négatif : le premier gagne. */
function compare(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < left.length; index += 1) {
    const difference = left[index] - right[index]
    if (difference !== 0) return difference
  }
  return 0
}

function previousDay(date: IsoDate): IsoDate {
  const [year, month, day] = date.split("-").map(Number)
  return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10)
}
