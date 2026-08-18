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
import type {
  ContractArrangement,
  ContractArrangementReason,
} from "@/features/employees/models/contract-arrangement"

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

  /**
   * L'aménagement temporaire en cours — mi-temps thérapeutique et semblables.
   *
   * Un seul à la fois : deux contrats réduits qui se chevauchent ne se
   * départageraient pas, et personne n'en vit deux en même temps. Un aménagement
   * terminé reste sur la fiche, inerte, jusqu'à ce qu'on l'efface : c'est la
   * trace de ce qui s'est passé ce printemps-là.
   */
  arrangement?: ContractArrangement | null

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
  /**
   * Sait-il ouvrir, sait-il fermer le magasin ?
   *
   * Distincts de `canOpen` et `canClose`, qui parlent de SON rayon : porter les
   * clés du magasin, désarmer l'alarme et compter la caisse ne s'apprennent pas
   * en même temps que lever le rideau d'un comptoir. Quelqu'un peut très bien
   * ouvrir le magasin sans jamais le fermer.
   *
   * Absents d'une fiche antérieure : `undefined` vaut OUI pour les deux, comme
   * `canOpen` et `canClose` — ce sont des tâches ordinaires, accordées jusqu'à
   * ce qu'on les retire, et personne n'a coché ces cases qui n'existaient pas.
   */
  permanenceCanOpen?: boolean
  permanenceCanClose?: boolean
  /** Jours où il PRÉFÈRE ouvrir le magasin — un départage, jamais une règle. */
  permanencePreferredOpeningDays?: WeekDay[]
  /** Jours où il ouvre le magasin, quoi qu'il arrive. */
  permanenceRequiredOpeningDays?: WeekDay[]
  /** Idem pour la fermeture du magasin. */
  permanencePreferredClosingDays?: WeekDay[]
  permanenceRequiredClosingDays?: WeekDay[]
  /**
   * Les seuls jours où il ferme le magasin — et il les ferme.
   *
   * DEUX effets d'un même réglage, et le second est le plus facile à oublier :
   * « uniquement le lundi » interdit les autres jours, ET donne les lundis.
   * Lue comme une simple permission, la liste n'aurait servi qu'à retirer
   * quelqu'un du tour sans jamais lui donner la fermeture qu'elle annonce.
   *
   * Se distingue donc de `permanenceRequiredClosingDays` par ce qu'elle
   * INTERDIT, non par ce qu'elle impose : « imposé le lundi » laisse fermer le
   * jeudi, « uniquement le lundi » non. Vide : aucune restriction.
   */
  permanenceClosingOnlyDays?: WeekDay[]
  /**
   * Le nombre de fermetures qu'il porte au maximum dans la SEMAINE.
   *
   * Par semaine et non par mois : ce qui pèse, c'est trois fermetures d'affilée,
   * pas leur total sur trente jours. Un plafond mensuel laisserait poser les
   * quatre de suite puis plus rien, ce qui est exactement ce qu'on veut éviter.
   *
   * Un PLAFOND et non un quota : il peut n'en faire aucune. `null` ou absent
   * veut dire « aucun plafond », et zéro est un vrai plafond — celui de
   * quelqu'un qui reste dans le tour pour les ouvertures seules.
   */
  permanenceMaxClosings?: number | null
  /**
   * N'est appelé à ce rôle que si personne d'autre ne peut.
   *
   * Le tour l'ignore tant qu'un autre est disponible, sans jamais l'écarter
   * tout à fait : c'est la place de celui qui dépanne — un adjoint, quelqu'un
   * en fin de contrat — et le retirer du tour laisserait des cases vides que
   * lui aurait pu tenir.
   *
   * Un par rôle, parce que les deux ne se décident pas ensemble : ouvrir
   * régulièrement et ne fermer qu'au dépannage est la situation ordinaire d'un
   * adjoint, et un seul drapeau aurait obligé à choisir entre les deux.
   */
  permanenceLastResortOpening?: boolean
  permanenceLastResortClosing?: boolean
  /**
   * Participe au tour de rôle des fermetures du samedi.
   *
   * Un GROUPE, pas un droit de plus : dès qu'une seule fiche du magasin le
   * coche, les samedis ne vont plus qu'aux personnes cochées, et les autres en
   * sont dispensées. Personne coché : tout le monde y passe, comme avant — un
   * réglage que personne n'a touché ne doit rien changer.
   *
   * Le samedi seulement, parce que c'est le seul jour dont la fermeture se
   * négocie dans une équipe : le récapitulatif lui donne sa colonne pour la
   * même raison.
   */
  permanenceSaturdayTurnOver?: boolean
  /**
   * @deprecated Remplacé par les deux drapeaux par rôle ci-dessus.
   *
   * Relu, jamais écrit : une fiche enregistrée avant la séparation portait un
   * seul drapeau, et il valait pour les deux rôles.
   */
  permanenceLastResort?: boolean

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

  // Aménagement temporaire — les champs sont plats, comme tout le formulaire :
  // un objet imbriqué dans react-hook-form se valide et se réinitialise moins
  // bien, et le schéma les rassemble à l'enregistrement.
  arrangementActive: boolean
  arrangementReason: ContractArrangementReason
  arrangementStart: string
  arrangementEnd: string
  arrangementHours: string
  arrangementMinuteRemainder: string
  arrangementDaysOff: WeekDay[]
  arrangementNote: string

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
  permanenceCanOpen: boolean
  permanenceCanClose: boolean
  permanencePreferredOpeningDays: WeekDay[]
  permanenceRequiredOpeningDays: WeekDay[]
  permanencePreferredClosingDays: WeekDay[]
  permanenceRequiredClosingDays: WeekDay[]
  permanenceClosingOnlyDays: WeekDay[]
  /** Vide veut dire « aucun plafond » — le formulaire garde les nombres en texte. */
  permanenceMaxClosings: string
  permanenceLastResortOpening: boolean
  permanenceLastResortClosing: boolean
  permanenceSaturdayTurnOver: boolean

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
