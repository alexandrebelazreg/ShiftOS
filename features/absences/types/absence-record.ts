import type { AbsenceType } from "@/features/core/models"

/** La moitié de journée couverte, quand l'absence ne prend pas le jour entier. */
export const DAY_HALVES = ["morning", "afternoon"] as const
export type DayHalf = (typeof DAY_HALVES)[number]

export const DAY_HALF_LABELS: Record<DayHalf, string> = {
  morning: "Matin",
  afternoon: "Après-midi",
}

/**
 * Une prolongation d'arrêt, telle qu'elle s'est présentée.
 *
 * L'historique est gardé plutôt que la seule date finale : entre un arrêt de
 * quinze jours et trois arrêts de cinq jours bout à bout, la paie et la
 * prévoyance ne voient pas la même chose, et la date d'aujourd'hui ne permet
 * plus de reconstituer laquelle des deux on a vécue.
 */
export interface AbsenceExtension {
  /** La fin telle qu'elle était avant. */
  readonly previousEnd: string
  /** La fin telle qu'elle devient. */
  readonly newEnd: string
  /** Le jour où la prolongation a été enregistrée, pas celui où elle prend effet. */
  readonly recordedOn: string
}

/**
 * D'où vient une absence, et donc si elle se modifie ici.
 *
 * Absente du champ : SAISIE À LA MAIN dans cet écran, la seule qui s'y corrige.
 * Les deux autres sont des LECTURES d'une décision prise ailleurs — la campagne
 * de congés, le calendrier des fériés — et l'écran les affiche sans les toucher :
 * sans elles, il annoncerait une équipe au complet la semaine du 15 juillet, et
 * les modifier ici ferait exister deux réponses à la même question.
 *
 * Un champ plutôt que le préfixe de l'identifiant, qu'on reniflait jusqu'ici :
 * une convention de nommage n'est pas une garantie, et la deuxième source
 * l'aurait montré en produisant des absences modifiables par accident.
 */
export const ABSENCE_SOURCES = ["paid_leave_campaign", "holiday"] as const
export type AbsenceSource = (typeof ABSENCE_SOURCES)[number]

export const ABSENCE_SOURCE_NOTICES: Record<AbsenceSource, string> = {
  paid_leave_campaign:
    "Semaine issue de la campagne de congés : elle se corrige dans l’écran Congés.",
  holiday:
    "Jour férié : cette personne n’est pas volontaire. Cela se corrige dans l’écran Jours fériés.",
}

/** Persisted application record used by the dashboard and the absence screen. */
export interface AbsenceRecord {
  readonly id: string
  /** Absente : saisie à la main, et modifiable ici. */
  readonly source?: AbsenceSource
  readonly employeeId: string
  readonly type: AbsenceType
  /** Premier jour couvert, borne incluse, tel qu'il est écrit sur le papier. */
  readonly start: string
  /**
   * Dernier jour couvert, borne incluse.
   *
   * TOUJOURS connue : un arrêt de travail porte sa date de fin, une formation
   * ses dates, un congé sans solde les siennes. Ce qu'on ignore le jour où on
   * l'enregistre, ce n'est pas la fin — c'est s'il y aura une PROLONGATION, et
   * une prolongation se saisit le jour où elle arrive, en repoussant cette date.
   */
  readonly end: string
  readonly note?: string
  /**
   * La demi-journée couverte, sur une absence d'UN SEUL jour.
   *
   * Absente sur une absence de plusieurs jours : « parti mardi midi, revenu
   * jeudi matin » se saisit en deux fois. Le cas se présente rarement, alors que
   * le rendez-vous médical d'un après-midi se présente toutes les semaines, et
   * un modèle qui porterait une moitié à chaque bout obligerait à y penser à
   * chaque saisie.
   */
  readonly halfDay?: DayHalf
  /** Les heures prises dans la journée — les motifs comptés en heures, eux seuls. */
  readonly hours?: number
  /**
   * Annulée, jamais supprimée : une absence enregistrée puis retirée reste
   * visible barrée. Absent se relit comme `active`, les enregistrements
   * antérieurs à l'annulation n'en portant pas.
   */
  readonly status?: "active" | "cancelled"
  readonly cancelledOn?: string
  /**
   * Qui a enregistré, qui a annulé. Vides tant que l'application n'a pas de
   * comptes : la place est réservée pour le jour où la connexion existera,
   * plutôt qu'une liste de noms à choisir soi-même, qui donnerait une
   * traçabilité fausse.
   */
  readonly recordedBy?: string
  readonly cancelledBy?: string
  /** Le jour où l'absence a été saisie — distinct du jour où elle commence. */
  readonly recordedOn?: string
  /** Le justificatif attendu : la date à laquelle il devait arriver. */
  readonly proofDueOn?: string
  /** Le jour où il est arrivé. Absent : il manque encore. */
  readonly proofReceivedOn?: string
  readonly extensions?: readonly AbsenceExtension[]
}
