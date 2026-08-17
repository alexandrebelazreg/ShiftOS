import type { IsoDate } from "@/features/core/models"

/**
 * Le tour de permanence d'un mois, tel qu'il est conservé.
 *
 * Trois formes de données, et non une seule, parce que les trois lignes de la
 * feuille ne se remplissent pas de la même manière :
 *
 * - une OUVERTURE et une FERMETURE par jour ouvré — une personne chacune, c'est
 *   la définition même de la permanence : quelqu'un porte les clés ;
 * - des REPOS, en nombre libre — plusieurs personnes peuvent être de repos le
 *   même jour, et le contraire n'arriverait que dans une équipe d'une personne ;
 * - des CONGÉS et une ASTREINTE par SEMAINE, comme les deux dernières colonnes
 *   de la feuille : ils ne se posent pas jour par jour.
 *
 * Les avoir fondus dans une seule table aurait obligé chaque lecture à savoir
 * lequel des trois régimes elle manipule.
 */

export const PERMANENCE_ROLES = ["opening", "closing"] as const
export type PermanenceRole = (typeof PERMANENCE_ROLES)[number]

export const PERMANENCE_ROLE_LABELS: Record<PermanenceRole, string> = {
  opening: "Ouverture",
  closing: "Fermeture",
}

/** L'identité d'une case du planning : une journée, un rôle. */
export type PermanenceSlotKey = `${IsoDate}_${PermanenceRole}`

export function permanenceSlotKey(date: IsoDate, role: PermanenceRole): PermanenceSlotKey {
  return `${date}_${role}`
}

/**
 * Ce qui se pose à la semaine plutôt qu'au jour.
 *
 * L'astreinte seule. La colonne « CP » de la feuille n'est PAS ici : elle se lit
 * dans les campagnes de congés validées (`paidLeaveByWeek`), et la conserver
 * aussi ici reviendrait à garder deux vérités sur la même absence.
 */
export interface PermanenceWeekSlots {
  /** La colonne « Astreinte ». */
  readonly onCallEmployeeId: string | null
}

export const EMPTY_WEEK_SLOTS: PermanenceWeekSlots = { onCallEmployeeId: null }

export interface PermanenceMonth {
  readonly schemaVersion: 1
  /**
   * "2026-01". Le mois EST son identité : il n'existe qu'un tour de permanence
   * par mois, et lui donner une clé aléatoire aurait permis d'en écrire deux.
   */
  readonly id: string
  readonly year: number
  /** 1 à 12. */
  readonly month: number
  /** Une personne par case, indexée par `permanenceSlotKey`. */
  readonly assignments: Readonly<Record<string, string>>
  /** Les personnes de repos, par journée. */
  readonly rest: Readonly<Record<IsoDate, readonly string[]>>
  /** Indexé par clé de semaine ISO ("2026-W02"). */
  readonly weeks: Readonly<Record<string, PermanenceWeekSlots>>
  /** `null` tant que le mois n'a jamais été généré : il est alors vide, pas raté. */
  readonly generatedAt: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

/** "2026-01" — la clé d'un mois, écrite au même endroit pour tout le monde. */
export function permanenceMonthId(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`
}

/** Un mois vide, prêt à être généré ou saisi à la main. */
export function emptyPermanenceMonth(year: number, month: number, now: string): PermanenceMonth {
  return {
    schemaVersion: 1,
    id: permanenceMonthId(year, month),
    year,
    month,
    assignments: {},
    rest: {},
    weeks: {},
    generatedAt: null,
    createdAt: now,
    updatedAt: now,
  }
}
