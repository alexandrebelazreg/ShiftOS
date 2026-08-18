import type { IsoDate, WeekDay } from "@/features/core/models"

import type { EmployeeRecord } from "@/features/employees/types/employee.types"

/**
 * L'aménagement temporaire du contrat.
 *
 * Un mi-temps thérapeutique n'est PAS une absence. Une absence dit « il n'est
 * pas là » ; un aménagement dit « il est là, autrement » — moins d'heures,
 * certains jours seulement, pour une durée décidée par un médecin. Les traiter
 * comme des absences aurait demandé de saisir vingt-six journées pour trois
 * mois, et surtout aurait fait croire au planning qu'il manque quelqu'un les
 * jours où, précisément, il est présent.
 *
 * Le motif ne change RIEN au calcul : mi-temps thérapeutique, congé parental à
 * temps partiel ou temps partiel temporaire produisent le même contrat réduit
 * sur la même période. Il est là pour qu'on sache, six mois après, pourquoi
 * cette personne était à dix-sept heures.
 */

export const CONTRACT_ARRANGEMENT_REASONS = [
  "therapeutic_part_time",
  "parental_part_time",
  "temporary_part_time",
  "other",
] as const
export type ContractArrangementReason = (typeof CONTRACT_ARRANGEMENT_REASONS)[number]

export const CONTRACT_ARRANGEMENT_LABELS: Record<ContractArrangementReason, string> = {
  therapeutic_part_time: "Mi-temps thérapeutique",
  parental_part_time: "Congé parental à temps partiel",
  temporary_part_time: "Temps partiel temporaire",
  other: "Autre aménagement",
}

export interface ContractArrangement {
  readonly reason: ContractArrangementReason
  readonly start: string
  /**
   * Dernier jour de l'aménagement, borne incluse.
   *
   * TOUJOURS connue : une prescription porte ses dates. Un mi-temps
   * thérapeutique se prescrit souvent pour un mois puis se renouvelle, mais le
   * renouvellement se saisit le jour où il arrive, en repoussant cette date —
   * pas en laissant une fin ouverte que rien ne viendrait jamais fermer.
   */
  readonly end: string
  /** Le contrat hebdomadaire PENDANT la période, en minutes. */
  readonly weeklyMinutes: number
  /** Les jours qui s'ajoutent à ses repos, le temps de l'aménagement. */
  readonly daysOff: readonly WeekDay[]
  readonly note?: string
}

/** L'aménagement en vigueur à cette date, s'il y en a un. */
export function arrangementOn(
  employee: EmployeeRecord,
  date: IsoDate
): ContractArrangement | null {
  const arrangement = employee.arrangement
  if (!arrangement) return null
  if (date < arrangement.start) return null
  if (date > arrangement.end) return null
  return arrangement
}

/**
 * Le salarié tel qu'il est le jour dit : contrat réduit, jours en moins.
 *
 * Une PROJECTION, et non un second jeu de champs lus ici et là. Tout ce qui
 * suit — le contrat à placer, les repos, les préférences, l'historique des
 * fermetures — lit un `EmployeeRecord` ordinaire, et n'a donc rien à savoir des
 * aménagements. C'est aussi ce qui rend la chose sûre : sans aménagement en
 * vigueur, la fonction rend l'enregistrement INCHANGÉ, et tout ce qui existait
 * avant continue de se comporter à l'identique.
 *
 * La date est celle du PREMIER JOUR de la période planifiée : une semaine se
 * pose d'un bloc, et c'est l'aménagement en vigueur quand elle commence qui la
 * gouverne. Un aménagement qui s'achève un mercredi laisse donc sa semaine
 * entière réduite — la régler à moitié demanderait de couper un contrat
 * hebdomadaire en deux, ce que rien en aval ne sait faire.
 */
export function employeeDuring(employee: EmployeeRecord, date: IsoDate): EmployeeRecord {
  const arrangement = arrangementOn(employee, date)
  if (arrangement === null) return employee

  return {
    ...employee,
    weeklyMinutes: arrangement.weeklyMinutes,
    weeklyHours: arrangement.weeklyMinutes / 60,
    // Ajoutés, jamais substitués : ses repos habituels restent des repos.
    fixedDaysOff: [...new Set([...employee.fixedDaysOff, ...arrangement.daysOff])],
  }
}

/** La même projection sur toute une équipe. */
export function employeesDuring(
  employees: readonly EmployeeRecord[],
  date: IsoDate
): readonly EmployeeRecord[] {
  return employees.map((employee) => employeeDuring(employee, date))
}

/** « Mi-temps thérapeutique, 17 h 30, jusqu'au 31/05/2026 » — pour la fiche. */
export function arrangementLabel(arrangement: ContractArrangement): string {
  const hours = Math.floor(arrangement.weeklyMinutes / 60)
  const minutes = arrangement.weeklyMinutes % 60
  const duration = minutes === 0 ? `${hours} h` : `${hours} h ${minutes}`
  return `${CONTRACT_ARRANGEMENT_LABELS[arrangement.reason]}, ${duration}, jusqu’au ${frenchDay(arrangement.end)}`
}

function frenchDay(date: string): string {
  const [year, month, day] = date.split("-")
  return `${day}/${month}/${year}`
}
