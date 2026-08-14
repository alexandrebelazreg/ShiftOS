import type { EmployeeScheduleType } from "@/features/employees/types/employee.types"

/**
 * Ce qu'il faut savoir d'un salarié pour lire la table des jours fériés.
 *
 * Trois champs seulement, et surtout PAS l'employé entier : cette règle ne doit
 * rien pouvoir apprendre de son contrat, de ses secteurs ou de ses préférences.
 * Elle ne connaît que la ligne de partage — fixe ou variable — et les deux
 * statuts qui la court-circuitent.
 */
export interface HolidayProfileInput {
  readonly scheduleType?: EmployeeScheduleType
  /** Un étudiant est TOUJOURS en horaires fixes, quoi que dise sa fiche. */
  readonly student?: boolean
  /** Un cadre au forfait jour ne compte pas d'heures : ni HF, ni plages. */
  readonly forfaitJour?: boolean
}

export interface EmployeeHolidayProfile {
  readonly scheduleType: EmployeeScheduleType
  readonly forfaitJour: boolean
  /** Vrai quand le type d'horaire vient du statut étudiant et non de la fiche. */
  readonly scheduleTypeForcedByStudent: boolean
}

/**
 * Le profil effectif, statut étudiant appliqué.
 *
 * « Pour planifier correctement les étudiants, ils doivent être paramétrés en
 * Horaire Fixe. » On le DÉDUIT plutôt que de le faire ressaisir : une case
 * étudiant cochée et un horaire resté variable, c'est un planning faux que rien
 * ne signale. La fiche affiche la conséquence, elle ne la réclame pas.
 *
 * `scheduleTypeForcedByStudent` existe pour que l'écran puisse dire POURQUOI le
 * choix est grisé, au lieu de le griser sans explication.
 */
export function holidayProfileOf(input: HolidayProfileInput): EmployeeHolidayProfile {
  const declared = input.scheduleType ?? "variable"
  const student = input.student === true
  return {
    scheduleType: student ? "fixed" : declared,
    forfaitJour: input.forfaitJour === true,
    scheduleTypeForcedByStudent: student && declared !== "fixed",
  }
}
