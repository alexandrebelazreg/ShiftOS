import { absentEmployeeIds } from "@/features/absences/models/absence-period"
import type { AbsenceRecord } from "@/features/absences/types/absence-record"
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
  /** Sait-il ouvrir, sait-il fermer le MAGASIN ? Rien à voir avec son rayon. */
  readonly canOpen: boolean
  readonly canClose: boolean
  readonly requiredOpeningDays: readonly WeekDay[]
  readonly preferredOpeningDays: readonly WeekDay[]
  readonly requiredClosingDays: readonly WeekDay[]
  readonly preferredClosingDays: readonly WeekDay[]
  /**
   * Les seuls jours où il ferme — et il les ferme. Vide : aucune restriction.
   *
   * Le générateur la lit DEUX fois : comme un refus des autres jours, et comme
   * des jours imposés. Se distingue de `requiredClosingDays` par ce qu'elle
   * interdit, non par ce qu'elle impose.
   */
  readonly closingOnlyDays: readonly WeekDay[]
  /** Le plafond de fermetures de la SEMAINE. `null` : aucun plafond. */
  readonly maxClosings: number | null
  /**
   * N'est retenu à ce rôle que si personne d'autre ne peut.
   *
   * Un par rôle : ouvrir régulièrement et ne fermer qu'au dépannage est la
   * situation ordinaire d'un adjoint.
   */
  readonly lastResortOpening: boolean
  readonly lastResortClosing: boolean
  /** Fait partie du tour de rôle des fermetures du samedi. */
  readonly saturdayTurnOver: boolean
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
      // Une fiche antérieure ne porte ni l'un ni l'autre : leur silence vaut
      // OUI, comme pour `canOpen` et `canClose`.
      canOpen: employee.permanenceCanOpen !== false,
      canClose: employee.permanenceCanClose !== false,
      requiredOpeningDays: employee.permanenceRequiredOpeningDays ?? [],
      preferredOpeningDays: employee.permanencePreferredOpeningDays ?? [],
      requiredClosingDays: employee.permanenceRequiredClosingDays ?? [],
      preferredClosingDays: employee.permanencePreferredClosingDays ?? [],
      closingOnlyDays: employee.permanenceClosingOnlyDays ?? [],
      maxClosings: employee.permanenceMaxClosings ?? null,
      // Une fiche antérieure à la séparation portait un seul drapeau, qui
      // valait pour les deux rôles.
      lastResortOpening:
        employee.permanenceLastResortOpening ?? employee.permanenceLastResort === true,
      lastResortClosing:
        employee.permanenceLastResortClosing ?? employee.permanenceLastResort === true,
      saturdayTurnOver: employee.permanenceSaturdayTurnOver === true,
      daysOff: employee.fixedDaysOff ?? [],
    }))
    // Rangé sur le nom COURT, celui que la feuille affiche.
    //
    // Les listes de personnel se trient par NOM de famille, mais cette feuille-ci
    // montre des prénoms — elle est punaisée au mur, et « Marie A. » y est plus
    // lisible que « ALBA Marie ». Trier sur une clé invisible produirait une
    // colonne qui paraît en désordre à qui la lit.
    .sort((left, right) => left.shortName.localeCompare(right.shortName, "fr"))
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
  absences: readonly AbsenceRecord[],
  date: IsoDate
): ReadonlySet<string> {
  // Déléguée plutôt que réécrite : une fin inconnue et une absence annulée ne
  // se lisent pas dans les dates elles-mêmes, et le tour de permanence n'a pas
  // à connaître ces deux règles pour savoir qui n'est pas là.
  return absentEmployeeIds(absences, date)
}
