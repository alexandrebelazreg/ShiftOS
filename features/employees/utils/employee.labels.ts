import type {
  ContractType,
  EmployeeStatus,
  WeekDay,
} from "@/features/core/models"
import type {
  SundayCommitment,
  SundayCompensation,
} from "@/features/employees/types/employee.types"

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

export const SUNDAY_COMMITMENT_LABELS: Record<SundayCommitment, string> = {
  volunteer: "Volontaire",
  fixed: "Tous les dimanches",
}

/**
 * « Fixe » s'écrit ici « Tous les dimanches ».
 *
 * Le mot juste est fixe, mais il est déjà pris dans cette même fiche par le
 * type d'HORAIRE, deux onglets plus tôt. Deux « fixe » qui ne parlent pas de la
 * même chose sur le même écran, c'est une fiche mal remplie qui ne se voit
 * jamais ; le libellé dit donc ce que le choix fait.
 */
export const SUNDAY_COMMITMENT_OPTIONS: {
  value: SundayCommitment
  label: string
  description: string
}[] = [
  {
    value: "volunteer",
    label: SUNDAY_COMMITMENT_LABELS.volunteer,
    description: "Il accepte d’être appelé, sans dépasser le maximum qu’il fixe.",
  },
  {
    value: "fixed",
    label: SUNDAY_COMMITMENT_LABELS.fixed,
    description: "Il est là chaque dimanche d’ouverture, sans exception.",
  },
]

export const SUNDAY_COMPENSATION_LABELS: Record<SundayCompensation, string> = {
  smoothed: "Lisser les heures sur la semaine",
  compensatory_rest: "Repos compensateur en semaine",
  overtime: "Heures supplémentaires",
}

/** Les trois contreparties possibles, dont une est obligatoire. */
export const SUNDAY_COMPENSATION_OPTIONS: {
  value: SundayCompensation
  label: string
  description: string
}[] = [
  {
    value: "smoothed",
    label: SUNDAY_COMPENSATION_LABELS.smoothed,
    description: "Les heures du dimanche sont retirées des autres jours ; la semaine tient le contrat.",
  },
  {
    value: "compensatory_rest",
    label: SUNDAY_COMPENSATION_LABELS.compensatory_rest,
    description: "Un jour de repos supplémentaire remplace le dimanche ; les journées gardent leur durée.",
  },
  {
    value: "overtime",
    label: SUNDAY_COMPENSATION_LABELS.overtime,
    description: "Le dimanche s’ajoute à la semaine et se paie ; rien n’est repris ailleurs.",
  },
]
