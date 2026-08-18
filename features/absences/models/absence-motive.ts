import type { AbsenceType } from "@/features/core/models"

/**
 * Ce que la journée absente fait aux heures du salarié.
 *
 * `maintained` : les heures prévues restent dues, comme si la journée avait été
 * travaillée. `deducted` : elles sont perdues. `worked` : la journée EST du
 * travail effectif, ailleurs que dans le magasin.
 *
 * La distinction entre `maintained` et `worked` n'est pas cosmétique : une
 * formation compte dans le temps de travail — donc dans les majorations, les
 * repos, les seuils —, un arrêt maladie maintenu ne compte que dans la paie.
 */
export const HOURS_TREATMENTS = ["maintained", "deducted", "worked"] as const
export type HoursTreatment = (typeof HOURS_TREATMENTS)[number]

export const HOURS_TREATMENT_LABELS: Record<HoursTreatment, string> = {
  maintained: "Heures maintenues",
  deducted: "Heures déduites",
  worked: "Travail effectif",
}

/**
 * Les motifs proposés à la saisie.
 *
 * Liste FERMÉE, « Autre » compris : des compteurs par motif ne se lisent que si
 * personne ne peut créer un onzième motif qui recouvre à moitié le troisième.
 * Le cas imprévu se saisit en « Autre » avec sa précision écrite, et se
 * retrouve en relisant.
 *
 * Le noyau, lui, garde un type d'absence OUVERT : ces valeurs n'y sont que des
 * données, et un import venu d'ailleurs continue de se relire.
 */
export const ABSENCE_MOTIVES = [
  "sick_leave",
  "work_accident",
  "maternity",
  "parental_leave",
  "family_event",
  "unpaid_leave",
  "training",
  "delegation",
  "unjustified",
  "paid_leave",
  "other",
] as const satisfies readonly AbsenceType[]
export type AbsenceMotive = (typeof ABSENCE_MOTIVES)[number]

/** Le justificatif attendu pour un motif, et le délai dans lequel il doit arriver. */
export interface ProofExpectation {
  readonly label: string
  /** Jours après le début de l'absence. `null` : attendu, sans délai opposable. */
  readonly dueDays: number | null
}

export interface AbsenceMotiveDefinition {
  readonly value: AbsenceMotive
  readonly label: string
  readonly hours: HoursTreatment
  /** `null` : aucun papier n'est attendu, et son absence ne se signale pas. */
  readonly proof: ProofExpectation | null
  /**
   * Se compte en heures dans la journée, et non en journées ou demi-journées.
   *
   * Un seul motif dans ce cas — les heures de délégation. Le porter comme un
   * drapeau du motif plutôt qu'un choix de saisie évite qu'on enregistre deux
   * heures de maladie, qui ne veulent rien dire.
   */
  readonly countedInHours?: boolean
  /** Une précision écrite est obligatoire : sans elle, le motif ne dit rien. */
  readonly needsDetail?: boolean
}

/**
 * Le tableau des règles, tel qu'il s'applique tant que personne ne l'a modifié.
 *
 * Écrit ici et à un seul endroit, parce que ces règles se lisent depuis trois
 * endroits qui n'ont rien à voir : la saisie (quel papier réclamer), les
 * compteurs (quelles heures additionner) et l'écran des paramètres (quoi
 * proposer de changer). Une seconde copie serait une convention collective de
 * plus dans le magasin.
 *
 * Les valeurs sont des DÉFAUTS : une convention qui traite le congé parental
 * autrement se règle dans les paramètres, sans toucher au code.
 */
export const ABSENCE_MOTIVE_DEFAULTS: readonly AbsenceMotiveDefinition[] = [
  {
    value: "sick_leave",
    label: "Maladie",
    hours: "maintained",
    proof: { label: "Arrêt de travail", dueDays: 2 },
  },
  {
    value: "work_accident",
    label: "Accident du travail ou de trajet",
    hours: "maintained",
    proof: { label: "Déclaration d’accident", dueDays: 2 },
  },
  {
    value: "maternity",
    label: "Maternité / paternité",
    hours: "maintained",
    proof: { label: "Attestation", dueDays: null },
  },
  {
    value: "parental_leave",
    label: "Congé parental",
    hours: "deducted",
    proof: { label: "Attestation", dueDays: null },
  },
  {
    value: "family_event",
    label: "Événement familial",
    hours: "maintained",
    proof: { label: "Acte ou faire-part", dueDays: null },
  },
  {
    value: "unpaid_leave",
    label: "Congé sans solde",
    hours: "deducted",
    proof: { label: "Demande écrite", dueDays: null },
  },
  {
    value: "training",
    label: "Formation",
    hours: "worked",
    proof: { label: "Convocation", dueDays: null },
  },
  {
    value: "delegation",
    label: "Heures de délégation",
    hours: "worked",
    proof: null,
    countedInHours: true,
  },
  {
    // Aucun justificatif attendu : c'est précisément ce qui la définit. En
    // réclamer un ferait apparaître une alerte permanente sur la seule absence
    // dont on sait d'avance qu'aucun papier ne viendra.
    value: "unjustified",
    label: "Absence injustifiée",
    hours: "deducted",
    proof: null,
  },
  {
    // Le congé payé POSÉ AU FIL DE L'EAU. Les semaines validées en campagne
    // arrivent par un autre chemin et ne se saisissent pas ici.
    value: "paid_leave",
    label: "Congé payé",
    hours: "maintained",
    proof: null,
  },
  {
    // Déduites par prudence : un motif qu'on n'a pas su nommer ne peut pas
    // maintenir des heures sans que quelqu'un l'ait décidé.
    value: "other",
    label: "Autre absence",
    hours: "deducted",
    proof: null,
    needsDetail: true,
  },
]

const DEFAULTS_BY_MOTIVE = new Map<string, AbsenceMotiveDefinition>(
  ABSENCE_MOTIVE_DEFAULTS.map((definition) => [definition.value, definition])
)

/**
 * La définition d'un motif, y compris pour une valeur venue d'ailleurs.
 *
 * Un enregistrement importé peut porter un motif que cette liste ignore — le
 * noyau l'autorise. Il se relit alors comme « Autre » plutôt que de faire
 * disparaître l'absence de l'écran : une absence qu'on ne sait pas nommer reste
 * une personne qui n'est pas là.
 */
export function absenceMotiveDefinition(type: AbsenceType): AbsenceMotiveDefinition {
  return DEFAULTS_BY_MOTIVE.get(type) ?? DEFAULTS_BY_MOTIVE.get("other")!
}

export function absenceMotiveLabel(type: AbsenceType): string {
  return absenceMotiveDefinition(type).label
}
