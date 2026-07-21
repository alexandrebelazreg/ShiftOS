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

  // Préférences
  preferOpening: boolean
  preferClosing: boolean
  notes: string
}
