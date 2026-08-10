/**
 * View-model / persistence types for the Employee module.
 *
 * Business vocabulary (week days, employee status, contract type) is imported
 * from the core domain (`@/features/core/models`), the single source of truth.
 *
 * `EmployeeRecord` is the flat, mocked record used by the UI and the mock
 * service. The canonical, normalized domain entity is `Employee` in core; this
 * record is intentionally denormalized for the current UI and is NOT the
 * domain entity.
 */
import type {
  ContractType,
  EmployeeStatus,
  WeekDay,
} from "@/features/core/models"

export const EMPLOYEE_SCHEDULE_TYPES = ["variable", "fixed"] as const
export type EmployeeScheduleType = (typeof EMPLOYEE_SCHEDULE_TYPES)[number]

/** Flat employee record backing the UI and the mock service. */
export interface EmployeeRecord {
  /** Persistence schema v2 makes weeklyMinutes authoritative. */
  schemaVersion?: 1 | 2
  id: string

  // Informations
  firstName: string
  lastName: string
  phone: string
  email: string
  status: EmployeeStatus

  // Contrat
  weeklyHours: number
  /** Exact persisted contract duration; legacy records are migrated on hydration. */
  weeklyMinutes?: number | null
  contractMinuteConfirmationRequired?: boolean
  workingDays: WeekDay[]
  contractType: ContractType
  /** Classification chosen on the employee card. Legacy records are variable. */
  scheduleType?: EmployeeScheduleType

  /** Product metadata used to present the employee's mastered sectors. */
  sectors?: string[]
  /** Skills selected for each assigned sector; product metadata, not Core rules. */
  competencies?: Record<string, string[]>

  // Contraintes
  canOpen: boolean
  canClose: boolean
  splitShiftAllowed: boolean
  fixedDaysOff: WeekDay[]
  forbiddenDays: WeekDay[]
  maxOpenings: number | null
  maxClosings: number | null

  /**
   * Contraintes avancées — optionnelles, et absentes de tous les employés
   * enregistrés avant leur introduction. `null` et `undefined` disent la même
   * chose : aucune restriction, l'employé hérite de la fenêtre du secteur.
   * Jamais "00:00", qui serait une borne réelle.
   */
  earliestStartTime?: string | null
  latestEndTime?: string | null
  /**
   * L'heure ci-dessus est-elle IMPOSÉE plutôt qu'une borne ?
   *
   * Un drapeau plutôt qu'un second champ : « ne commence pas avant 07:00 »
   * et « commence à 07:00 » portent la même heure et ne diffèrent que par
   * leur fermeté. Deux champs auraient permis de les remplir tous les deux
   * avec des heures différentes, et il aurait fallu inventer laquelle gagne.
   */
  startTimeIsExact?: boolean
  endTimeIsExact?: boolean
  /** Jours où ce salarié ouvre, quel que soit le rayon qu'il sert. */
  openingDays?: WeekDay[]
  /** Jours où il ferme. */
  closingDays?: WeekDay[]

  // Préférences (optional)
  preferOpening: boolean
  preferClosing: boolean
  notes: string

  // Historique (metadata)
  createdAt: string
  updatedAt: string
}

/**
 * Shape held by React Hook Form. Numbers are strings so empty fields stay
 * empty; Zod coerces them to numbers on submit.
 */
export interface EmployeeFormValues {
  // Informations
  firstName: string
  lastName: string
  phone: string
  email: string
  status: EmployeeStatus

  // Contrat
  weeklyHours: string
  weeklyMinuteRemainder: string
  contractConfirmationRequired: boolean
  legacyContractMinutes: "" | "2190" | "2205"
  contractType: ContractType
  scheduleType: EmployeeScheduleType
  sectors: string[]
  competencies: Record<string, string[]>

  // Contraintes
  canOpen: boolean
  canClose: boolean
  splitShiftAllowed: boolean
  fixedDaysOff: WeekDay[]
  forbiddenDays: WeekDay[]
  maxOpenings: string
  maxClosings: string
  /** "HH:mm" or "" — the empty string is the form's way of saying "no bound". */
  earliestStartTime: string
  latestEndTime: string
  startTimeIsExact: boolean
  endTimeIsExact: boolean
  openingDays: WeekDay[]
  closingDays: WeekDay[]

  // Préférences
  preferOpening: boolean
  preferClosing: boolean
  notes: string
}
