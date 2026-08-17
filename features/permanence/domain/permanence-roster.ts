import type { IsoDate, WeekDay } from "@/features/core/models"
import type { EmployeeRecord } from "@/features/employees/types/employee.types"
import { getFullName } from "@/features/employees/utils/employee.format"

/**
 * Qui peut prendre une permanence, et à quelles conditions.
 *
 * L'effectif se DÉDUIT des fiches, il ne se saisit nulle part : cocher
 * « participe aux permanences » sur une fiche est le seul geste qui fasse
 * entrer quelqu'un dans le tour. Une seconde liste, tenue dans l'écran des
 * permanences, aurait fini par contredire les fiches — et c'est la fiche qu'on
 * ouvre quand on se demande pourquoi quelqu'un ferme tous les samedis.
 *
 * Les inactifs sont écartés : ils ne sont plus là.
 */

export interface PermanenceMember {
  readonly employeeId: string
  /** « Alex Belaz » — le nom entier, pour les tableaux qui ont la place. */
  readonly name: string
  /** « Alex » — le prénom, comme sur la feuille, où une case est étroite. */
  readonly shortName: string
  readonly requiredOpeningDays: readonly WeekDay[]
  readonly preferredOpeningDays: readonly WeekDay[]
  readonly requiredClosingDays: readonly WeekDay[]
  readonly preferredClosingDays: readonly WeekDay[]
  /** Ses repos fixes : le tour ne les touche pas. */
  readonly daysOff: readonly WeekDay[]
}

/** L'effectif du tour, dans l'ordre alphabétique — un ordre stable est un ordre juste. */
export function permanenceRoster(employees: readonly EmployeeRecord[]): readonly PermanenceMember[] {
  const eligible = employees.filter(
    (employee) => employee.permanence === true && employee.status === "active"
  )

  return eligible
    .map((employee) => ({
      employeeId: employee.id,
      name: getFullName(employee),
      shortName: shortNameOf(employee, eligible),
      requiredOpeningDays: employee.permanenceRequiredOpeningDays ?? [],
      preferredOpeningDays: employee.permanencePreferredOpeningDays ?? [],
      requiredClosingDays: employee.permanenceRequiredClosingDays ?? [],
      preferredClosingDays: employee.permanencePreferredClosingDays ?? [],
      daysOff: employee.fixedDaysOff ?? [],
    }))
    .sort((left, right) => left.name.localeCompare(right.name, "fr"))
}

/**
 * Le prénom seul, sauf s'il est porté par quelqu'un d'autre du tour : deux
 * « Marie » dans une même colonne rendraient la feuille inutilisable, et c'est
 * précisément la feuille qu'on affiche au mur.
 */
function shortNameOf(employee: EmployeeRecord, roster: readonly EmployeeRecord[]): string {
  const homonyms = roster.filter(
    (other) => other.id !== employee.id && other.firstName === employee.firstName
  )
  if (homonyms.length === 0) return employee.firstName
  const initial = employee.lastName.charAt(0).toUpperCase()
  return initial ? `${employee.firstName} ${initial}.` : employee.firstName
}

/**
 * Les personnes absentes une date donnée, d'après les absences saisies.
 *
 * Une absence n'est pas un refus de permanence, c'est une impossibilité : le
 * générateur ne peut pas confier les clés à quelqu'un qui n'est pas là.
 */
export function absentOn(
  absences: readonly { readonly employeeId: string; readonly start: string; readonly end: string }[],
  date: IsoDate
): ReadonlySet<string> {
  return new Set(
    absences
      .filter((absence) => absence.start <= date && date <= absence.end)
      .map((absence) => absence.employeeId)
  )
}
