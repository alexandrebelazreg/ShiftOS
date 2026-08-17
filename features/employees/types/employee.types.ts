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

/**
 * Comment ce salarié en vient à travailler le dimanche.
 *
 * `volunteer` : il accepte d'être appelé, sans jamais dépasser le nombre de
 * dimanches qu'il a lui-même consenti.
 * `fixed` : il fait TOUS les dimanches — rien à plafonner, rien à répartir.
 *
 * Un seul champ, et non deux cases : les deux ne peuvent pas être vrais
 * ensemble, et deux booléens auraient laissé enregistrer quelqu'un à la fois
 * volontaire et de tous les dimanches, sans dire lequel des deux commande.
 *
 * À ne pas confondre avec `scheduleType: "fixed"`, qui parle des HORAIRES.
 */
export const SUNDAY_COMMITMENTS = ["volunteer", "fixed"] as const
export type SundayCommitment = (typeof SUNDAY_COMMITMENTS)[number]

/** Les quatre plafonds proposés ; au-delà, c'est « tous les dimanches ». */
export const SUNDAYS_PER_MONTH = ["1", "2", "3", "4"] as const
export type SundaysPerMonthChoice = (typeof SUNDAYS_PER_MONTH)[number]

/**
 * Ce que le dimanche travaillé lui rend. Un choix OBLIGATOIRE dès qu'il y va :
 * les trois branches se valent en droit, aucune n'est le défaut de l'autre, et
 * un dimanche sans contrepartie est un oubli, jamais une décision.
 */
export const SUNDAY_COMPENSATIONS = ["smoothed", "compensatory_rest", "overtime"] as const
export type SundayCompensation = (typeof SUNDAY_COMPENSATIONS)[number]

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
  /**
   * Étudiant — décide du traitement des jours fériés, et de lui seul.
   *
   * Un étudiant est toujours traité en horaires FIXES, même si sa fiche dit
   * variable : la déduction vit dans `holidayProfileOf`, pas dans ce champ, pour
   * qu'une fiche ancienne n'ait pas besoin d'être rouverte pour devenir juste.
   */
  student?: boolean
  /** Cadre au forfait jour : ni heures fériées ni plages, seulement JF ou PJ. */
  forfaitJour?: boolean

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

  /**
   * Permanence — participe-t-il au tour de permanence du magasin ?
   *
   * Séparé du droit d'ouvrir et de fermer son rayon (`canOpen`, `canClose`),
   * qui dit ce qu'il sait faire dans sa journée. La permanence est autre chose :
   * porter les clés du magasin. Un rayon peut se fermer par quelqu'un qui
   * n'aura jamais à lever ni baisser le rideau.
   *
   * Absent de toute fiche antérieure : `undefined` vaut « ne participe pas ».
   */
  permanence?: boolean
  /** Jours où il PRÉFÈRE ouvrir le magasin — un départage, jamais une règle. */
  permanencePreferredOpeningDays?: WeekDay[]
  /** Jours où il ouvre le magasin, quoi qu'il arrive. */
  permanenceRequiredOpeningDays?: WeekDay[]
  /** Idem pour la fermeture du magasin. */
  permanencePreferredClosingDays?: WeekDay[]
  permanenceRequiredClosingDays?: WeekDay[]

  /**
   * Dimanche — le magasin peut ouvrir ce jour-là sans que tout le monde y aille.
   *
   * Séparé des repos fixes, qui disent quels jours il ne travaille jamais : le
   * dimanche se règle avec son accord, une cadence et une contrepartie, quand
   * les autres jours ne demandent qu'un oui ou un non.
   *
   * Absent de toute fiche antérieure : `undefined` vaut « ne travaille pas le
   * dimanche », et les champs qui suivent ne veulent rien dire sans lui.
   */
  sundayWork?: boolean
  sundayCommitment?: SundayCommitment
  /**
   * Le nombre de dimanches qu'il accepte au maximum dans le mois — un PLAFOND,
   * jamais un quota : il peut n'être appelé aucune fois.
   *
   * `null` veut dire « aucun plafond », c'est-à-dire tous les dimanches : c'est
   * le cas de l'engagement `fixed`, et de lui seul.
   */
  maxSundaysPerMonth?: number | null
  /** `null` tant qu'il ne travaille pas le dimanche ; obligatoire dès qu'il y va. */
  sundayCompensation?: SundayCompensation | null

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
  student: boolean
  forfaitJour: boolean
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

  // Permanence
  permanence: boolean
  permanencePreferredOpeningDays: WeekDay[]
  permanenceRequiredOpeningDays: WeekDay[]
  permanencePreferredClosingDays: WeekDay[]
  permanenceRequiredClosingDays: WeekDay[]

  // Dimanche
  sundayWork: boolean
  sundayCommitment: SundayCommitment
  /** Une chaîne, comme tout ce qui se saisit : Zod la convertit à l'envoi. */
  maxSundaysPerMonth: SundaysPerMonthChoice
  /** `""` = pas encore choisi, ce que la validation refuse s'il travaille le dimanche. */
  sundayCompensation: "" | SundayCompensation

  // Préférences
  preferOpening: boolean
  preferClosing: boolean
  notes: string
}
