import { ADVANCED_CONSTRAINTS_DEFAULTS } from "@/features/employees/utils/advanced-constraints"
import type { EmployeeDraft } from "@/features/employees/schemas/employee.schema"
import type {
  EmployeeRecord,
  EmployeeFormValues,
  SundaysPerMonthChoice,
} from "@/features/employees/types/employee.types"

/**
 * Le plafond persisté ramené à l'un des quatre boutons du formulaire.
 *
 * `null` — « tous les dimanches », ou aucun — revient à 1 : c'est ce que le
 * formulaire proposera s'il repasse volontaire, et de deux valeurs également
 * arbitraires il vaut mieux retenir la plus prudente. On n'appelle jamais
 * quelqu'un plus souvent qu'il n'a dit oui.
 *
 * Un enregistrement venu d'ailleurs — import, script de reprise — peut porter
 * n'importe quel nombre ; un choix hors liste ne s'afficherait comme aucun des
 * quatre.
 */
function sundaysPerMonthChoice(value: number | null | undefined): SundaysPerMonthChoice {
  const rounded = Math.round(value ?? 1)
  if (!Number.isFinite(rounded)) return "1"
  return String(Math.min(4, Math.max(1, rounded))) as SundaysPerMonthChoice
}

/** Blank form values for the "create employee" flow. */
export function createEmptyEmployeeFormValues(): EmployeeFormValues {
  return {
    firstName: "",
    lastName: "",
    phone: "",
    email: "",
    status: "active",

    weeklyHours: "",
    weeklyMinuteRemainder: "0",
    contractConfirmationRequired: false,
    legacyContractMinutes: "",
    contractType: "full_time",
    scheduleType: "variable",
    student: false,
    forfaitJour: false,
    sectors: [],
    competencies: {},

    arrangementActive: false,
    arrangementReason: "therapeutic_part_time",
    arrangementStart: "",
    arrangementEnd: "",
    arrangementHours: "",
    arrangementMinuteRemainder: "0",
    arrangementDaysOff: [],
    arrangementNote: "",

    // Read from the house rules rather than restated, so the form and the
    // summary that reports departures from them can never disagree.
    ...ADVANCED_CONSTRAINTS_DEFAULTS,
    fixedDaysOff: [],
    forbiddenDays: [],
    maxOpenings: "",
    maxClosings: "",
    earliestStartTime: "",
    latestEndTime: "",
    startTimeIsExact: false,
    endTimeIsExact: false,
    openingDays: [],
    closingDays: [],

    permanence: false,
    permanenceCanOpen: true,
    permanenceCanClose: true,
    permanencePreferredOpeningDays: [],
    permanenceRequiredOpeningDays: [],
    permanencePreferredClosingDays: [],
    permanenceRequiredClosingDays: [],
    permanenceClosingOnlyDays: [],
    permanenceMaxClosings: "",
    permanenceLastResortOpening: false,
    permanenceLastResortClosing: false,
    permanenceSaturdayTurnOver: false,

    sundayWork: false,
    sundayCommitment: "volunteer",
    maxSundaysPerMonth: "1",
    sundayCompensation: "",

    preferOpening: false,
    preferClosing: false,
    notes: "",
  }
}

/** Map a persisted employee into editable form values (numbers → strings). */
export function employeeToFormValues(employee: EmployeeRecord): EmployeeFormValues {
  // The contract is stored in minutes; the form splits it into whole hours plus
  // a 0/15/30/45 remainder.
  const contractMinutes =
    employee.weeklyMinutes ?? Math.round(employee.weeklyHours * 60)

  return {
    firstName: employee.firstName,
    lastName: employee.lastName,
    phone: employee.phone,
    email: employee.email,
    status: employee.status,

    weeklyHours: String(Math.floor(contractMinutes / 60)),
    weeklyMinuteRemainder: String(contractMinutes % 60),
    contractConfirmationRequired: employee.contractMinuteConfirmationRequired === true,
    legacyContractMinutes: "",
    contractType: employee.contractType,
    scheduleType: employee.scheduleType ?? "variable",
    student: employee.student === true,
    forfaitJour: employee.forfaitJour === true,
    sectors: [...(employee.sectors ?? [])],
    competencies: { ...(employee.competencies ?? {}) },

    // Un aménagement terminé se relit tel quel, avec ses dates passées : c'est
    // au gérant de l'effacer, pas au formulaire de décider qu'il n'a plus lieu
    // d'être — la trace de ce qui s'est passé ce printemps-là a sa valeur.
    arrangementActive: employee.arrangement != null,
    arrangementReason: employee.arrangement?.reason ?? "therapeutic_part_time",
    arrangementStart: employee.arrangement?.start ?? "",
    arrangementEnd: employee.arrangement?.end ?? "",
    arrangementHours:
      employee.arrangement === undefined || employee.arrangement === null
        ? ""
        : String(Math.floor(employee.arrangement.weeklyMinutes / 60)),
    arrangementMinuteRemainder: String((employee.arrangement?.weeklyMinutes ?? 0) % 60),
    arrangementDaysOff: [...(employee.arrangement?.daysOff ?? [])],
    arrangementNote: employee.arrangement?.note ?? "",

    canOpen: employee.canOpen,
    canClose: employee.canClose,
    splitShiftAllowed: employee.splitShiftAllowed,
    fixedDaysOff: [...employee.fixedDaysOff],
    forbiddenDays: [...employee.forbiddenDays],
    maxOpenings: employee.maxOpenings === null ? "" : String(employee.maxOpenings),
    maxClosings: employee.maxClosings === null ? "" : String(employee.maxClosings),
    // Employees saved before the advanced constraints existed carry neither
    // field; an absent bound and an empty one are the same "no restriction".
    earliestStartTime: employee.earliestStartTime ?? "",
    latestEndTime: employee.latestEndTime ?? "",
    startTimeIsExact: employee.startTimeIsExact ?? false,
    endTimeIsExact: employee.endTimeIsExact ?? false,
    openingDays: [...(employee.openingDays ?? [])],
    closingDays: [...(employee.closingDays ?? [])],

    // Une fiche antérieure au tour de permanence n'en porte rien : l'absence
    // se relit comme « n'y participe pas », sans avoir à rouvrir la fiche.
    permanence: employee.permanence === true,
    // Une fiche antérieure n'a coché ni l'un ni l'autre : leur silence vaut OUI,
    // ce sont des tâches ordinaires accordées jusqu'à ce qu'on les retire.
    permanenceCanOpen: employee.permanenceCanOpen !== false,
    permanenceCanClose: employee.permanenceCanClose !== false,
    permanencePreferredOpeningDays: [...(employee.permanencePreferredOpeningDays ?? [])],
    permanenceRequiredOpeningDays: [...(employee.permanenceRequiredOpeningDays ?? [])],
    permanencePreferredClosingDays: [...(employee.permanencePreferredClosingDays ?? [])],
    permanenceRequiredClosingDays: [...(employee.permanenceRequiredClosingDays ?? [])],
    permanenceClosingOnlyDays: [...(employee.permanenceClosingOnlyDays ?? [])],
    permanenceMaxClosings:
      employee.permanenceMaxClosings === null || employee.permanenceMaxClosings === undefined
        ? ""
        : String(employee.permanenceMaxClosings),
    // Une fiche antérieure à la séparation portait un seul drapeau, qui valait
    // pour les deux rôles : il se relit sans qu'on ait à rouvrir la fiche.
    permanenceLastResortOpening:
      employee.permanenceLastResortOpening ?? employee.permanenceLastResort === true,
    permanenceLastResortClosing:
      employee.permanenceLastResortClosing ?? employee.permanenceLastResort === true,
    permanenceSaturdayTurnOver: employee.permanenceSaturdayTurnOver === true,

    // Une fiche antérieure à l'onglet Dimanche n'en porte rien : l'absence se
    // relit comme « ne travaille pas le dimanche ».
    sundayWork: employee.sundayWork === true,
    sundayCommitment: employee.sundayCommitment ?? "volunteer",
    maxSundaysPerMonth: sundaysPerMonthChoice(employee.maxSundaysPerMonth),
    sundayCompensation: employee.sundayCompensation ?? "",

    preferOpening: employee.preferOpening,
    preferClosing: employee.preferClosing,
    notes: employee.notes,
  }
}

/**
 * The Zod-validated draft already matches the entity fields — this is a thin
 * pass-through kept as a single place to adapt if the shapes diverge later.
 */
export function draftToEntityFields(draft: EmployeeDraft): EmployeeDraft {
  return draft
}
