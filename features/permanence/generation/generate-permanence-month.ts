import type { IsoDate } from "@/features/core/models"
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
  PERMANENCE_ROLES,
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

  const take = (day: PermanenceDay, role: PermanenceRole, member: PermanenceMember): void => {
    assignments.set(permanenceSlotKey(day.date, role), member.employeeId)
    load.set(
      member.employeeId,
      withPermanence(load.get(member.employeeId) ?? EMPTY_LOAD, day.weekDay, role)
    )
    const week = `${member.employeeId}_${isoWeekKey(day.date)}`
    weekLoad.set(week, (weekLoad.get(week) ?? 0) + 1)
    busyDays.add(`${member.employeeId}_${day.date}`)
  }

  /**
   * Peut-elle prendre CETTE case ?
   *
   * Ouvrir et fermer la même journée, c'est y être du matin au soir. Le tour
   * de permanence existe pour éviter cela, donc une journée déjà tenue est une
   * journée prise — y compris quand c'est la personne elle-même qui l'a
   * demandée par un jour imposé.
   */
  const available = (day: PermanenceDay, member: PermanenceMember): boolean => {
    if (member.daysOff.includes(day.weekDay)) return false
    if (busyDays.has(`${member.employeeId}_${day.date}`)) return false
    return !(unavailableOn?.(day.date).has(member.employeeId) ?? false)
  }

  const requiredDays = (member: PermanenceMember, role: PermanenceRole) =>
    role === "closing" ? member.requiredClosingDays : member.requiredOpeningDays

  const prefersDay = (member: PermanenceMember, day: PermanenceDay, role: PermanenceRole) =>
    (role === "closing" ? member.preferredClosingDays : member.preferredOpeningDays).includes(
      day.weekDay
    )

  /**
   * Le classement d'une candidate, du critère le plus lourd au plus léger.
   *
   * Les samedis et les dimanches passent AVANT tout le reste : ce sont les
   * seules journées dont la répartition se discute, et celles que le
   * récapitulatif met en colonne. Les jours de semaine s'en tiennent aux
   * totaux, ce qui laisse aux préférences la place de compter — un jour préféré
   * qui ne se réaliserait jamais serait un champ décoratif.
   */
  const rank = (member: PermanenceMember, day: PermanenceDay, role: PermanenceRole): number[] => {
    const current = load.get(member.employeeId) ?? EMPTY_LOAD
    return [
      weekendBurden(current, day.weekDay, role),
      weekLoad.get(`${member.employeeId}_${isoWeekKey(day.date)}`) ?? 0,
      role === "closing" ? current.closings : current.openings,
      totalPermanences(current),
      prefersDay(member, day, role) ? 0 : 1,
      busyDays.has(`${member.employeeId}_${previousDay(day.date)}`) ? 1 : 0,
    ]
  }

  const best = (
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

  const slots = calendar.openDays.flatMap((day) =>
    PERMANENCE_ROLES.map((role) => ({ day, role }))
  )

  // Temps 1 — les jours imposés, sur un tableau encore vierge.
  for (const { day, role } of slots) {
    const claimants = roster.filter((member) => requiredDays(member, role).includes(day.weekDay))
    const free = claimants.filter((member) => available(day, member))

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
  for (const { day, role } of slots) {
    if (assignments.has(permanenceSlotKey(day.date, role))) continue

    const candidates = roster.filter((member) => available(day, member))
    const winner = best(candidates, day, role)
    if (winner) {
      take(day, role, winner)
      continue
    }

    gaps.push({ date: day.date, role, message: "personne n’est disponible ce jour-là." })
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
