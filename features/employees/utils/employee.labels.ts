import type {
  ContractType,
  EmployeeStatus,
  WeekDay,
} from "@/features/core/models"

/** Short labels for week days, used on cards and day pickers. */
export const WEEK_DAY_SHORT_LABELS: Record<WeekDay, string> = {
  monday: "Lun",
  tuesday: "Mar",
  wednesday: "Mer",
  thursday: "Jeu",
  friday: "Ven",
  saturday: "Sam",
  sunday: "Dim",
}

export const WEEK_DAY_LABELS: Record<WeekDay, string> = {
  monday: "Lundi",
  tuesday: "Mardi",
  wednesday: "Mercredi",
  thursday: "Jeudi",
  friday: "Vendredi",
  saturday: "Samedi",
  sunday: "Dimanche",
}

export const EMPLOYEE_STATUS_LABELS: Record<EmployeeStatus, string> = {
  active: "Actif",
  inactive: "Inactif",
}

export const CONTRACT_TYPE_LABELS: Record<ContractType, string> = {
  full_time: "Temps plein",
  part_time: "Temps partiel",
}

export const CONTRACT_TYPE_OPTIONS: { value: ContractType; label: string }[] = [
  { value: "full_time", label: CONTRACT_TYPE_LABELS.full_time },
  { value: "part_time", label: CONTRACT_TYPE_LABELS.part_time },
]
