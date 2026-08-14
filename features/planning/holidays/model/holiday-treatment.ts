import type { EmployeeScheduleType } from "@/features/employees/types/employee.types"
import type { HolidayOpening } from "@/features/planning/holidays/model/holiday-schedule"

/**
 * La documentation RH des jours fériés, encodée.
 *
 * Ce fichier N'INVENTE aucune règle. Chaque branche correspond à une ligne des
 * trois tableaux fournis par l'enseigne, et chaque ligne a son test. C'est
 * délibérément une table de décision et non un enchaînement d'ajustements : le
 * jour où l'enseigne corrige un cas, on corrige une ligne, et le test qui la
 * garde dit lequel.
 *
 * LA LIGNE DE PARTAGE, dont tout le reste découle : un jour férié RETIRE des
 * heures au contrat d'un salarié en horaires variables, et TRANSFORME les
 * heures planifiées d'un salarié en horaires fixes. Le premier voit sa base
 * baisser (JF, DF) ; le second garde la forme de son planning, ses plages
 * devenant des heures fériées (HF).
 */

/**
 * Les codes d'une journée fériée.
 *
 * Des IDENTIFIANTS INTERNES, et rien d'autre. Ils ne sortent jamais à l'écran :
 * « HF » ne veut rien dire pour la personne qui lit le planning au mur, et
 * « DH » se confond avec « DF » au premier coup d'œil. Ce qui s'affiche est
 * toujours `DAY_CODE_WORDING`, en toutes lettres.
 */
export const DAY_CODES = ["HF", "RH", "DH", "JF", "DF", "PJ"] as const
export type DayCode = (typeof DAY_CODES)[number]

export interface DayCodeWording {
  /** Ce qui s'écrit dans une case : court, mais un vrai mot. */
  readonly label: string
  /** La conséquence, en une phrase, pour une légende ou une infobulle. */
  readonly description: string
}

/**
 * Les mots à la place des sigles.
 *
 * Formulés du point de vue de CELUI QUI LIT — « est-ce que je viens, et
 * qu'est-ce que ça change pour moi ? » — et non de la paie. Les libellés
 * décrivent ce qui arrive à la journée, jamais ce qui arrive au bulletin :
 * l'application ne calcule pas de paie et n'a pas à en promettre une.
 */
export const DAY_CODE_WORDING: Record<DayCode, DayCodeWording> = {
  HF: {
    label: "Férié non travaillé",
    description: "Journée fériée : les heures habituelles sont maintenues en heures fériées.",
  },
  JF: {
    label: "Jour férié",
    description: "Journée fériée non travaillée : la semaine compte un jour de moins.",
  },
  DF: {
    label: "Demi-journée fériée",
    description: "Une moitié de journée fériée : la semaine compte une demi-journée de moins.",
  },
  DH: {
    label: "Demi-repos",
    description: "Une demi-journée de repos, en plus des plages travaillées.",
  },
  RH: {
    label: "Repos",
    description: "Journée de repos hebdomadaire.",
  },
  PJ: {
    label: "Présence",
    description: "Cadre au forfait jour présent ce jour-là.",
  },
}

/**
 * Ce qu'une journée dit, en toutes lettres.
 *
 * Plusieurs codes se cumulent — « Férié non travaillé » et « Demi-repos » sur
 * la même journée — et se lisent alors séparés par un point médian, comme le
 * reste de l'application.
 */
export function describeDayCodes(codes: readonly DayCode[]): string | null {
  if (codes.length === 0) return null
  return codes.map((code) => DAY_CODE_WORDING[code].label).join(" · ")
}

/** Ce que le férié retire à la base contrat de la semaine. */
export type ContractReduction = "none" | "one-fifth" | "one-tenth"

/** Le salarié travaille-t-il ce jour-là, et combien ? Décidé par le solveur. */
export type HolidayPresence = "full" | "half" | "none"

export interface HolidayCase {
  /** Ce que le magasin fait de ce férié. */
  readonly opening: HolidayOpening
  /** Horaires fixes ou variables — la ligne de partage. */
  readonly scheduleType: EmployeeScheduleType
  /** Cadre au forfait jour : ni HF ni plages, seulement JF, PJ ou RH. */
  readonly forfaitJour: boolean
  /** Le férié tombe-t-il un dimanche ? Le 2ème cas de la documentation. */
  readonly sunday: boolean
  /** Le magasin ouvre-t-il HABITUELLEMENT le dimanche ? */
  readonly storeOpensSundays: boolean
  /** Ce salarié travaille-t-il habituellement le dimanche ? */
  readonly usuallyWorksSundays: boolean
  /** Ce jour est-il son repos habituel ? */
  readonly usualRestDay: boolean
  /** Ce que le solveur a retenu pour lui ce jour-là. */
  readonly presence: HolidayPresence
}

export interface HolidayTreatment {
  /** Les codes de la journée, dans l'ordre où ils s'écrivent. */
  readonly codes: readonly DayCode[]
  /** Ce qu'il faut retirer à l'objectif de la semaine. */
  readonly contractReduction: ContractReduction
  /**
   * Faut-il reporter ses plages habituelles, converties en heures fériées ?
   *
   * Le propre des horaires fixes : la forme du planning ne bouge pas, seule sa
   * nature change. Et — le point à ne jamais perdre — CES HEURES NE COUVRENT
   * RIEN. Quelqu'un en HF n'est pas au comptoir ; les compter comme présent
   * ferait croire le rayon tenu alors qu'il est vide.
   */
  readonly keepUsualShiftsAsHolidayHours: boolean
  /** Un demi-repos reste à poser ; c'est le solveur qui choisit sa moitié. */
  readonly halfRestToPlace: boolean
  /** La ligne de la documentation dont ce verdict sort. */
  readonly reason: string
}

const WORKING = (reason: string): HolidayTreatment => ({
  codes: [],
  contractReduction: "none",
  keepUsualShiftsAsHolidayHours: false,
  halfRestToPlace: false,
  reason,
})

/**
 * Le traitement d'un salarié sur un jour férié.
 *
 * PRÉCÉDENCE, premier cas rencontré l'emporte. L'ordre n'est pas cosmétique :
 * le forfait jour ignore les heures, et le dimanche est un régime à part que la
 * documentation traite dans un second tableau.
 *
 *   1. cadre au forfait jour  → JF, PJ ou RH, jamais des heures
 *   2. dimanche férié         → 2ème cas de la documentation
 *   3. magasin chômé          → 1er cas, magasin fermé
 *   4. magasin demi-chômé     → 1er cas, ouvert le matin
 *   5. magasin travaillé      → 1er cas, ouvert la journée
 */
export function holidayTreatment(input: HolidayCase): HolidayTreatment {
  if (input.forfaitJour) return forfaitJourTreatment(input)
  if (input.sunday) return sundayTreatment(input)
  if (input.opening === "chome") return closedTreatment(input)
  if (input.opening === "demi-chome") return halfClosedTreatment(input)
  return openTreatment(input)
}

// ── 1. Cadres au forfait jour ────────────────────────────────────────────────

/**
 * « Les cadres au forfait jour sont en JF ou PJ », et sur un dimanche férié à
 * magasin fermé, « il ne peut y avoir que du RH ou du PJ ».
 *
 * Un forfait jour ne compte pas des heures, donc aucune notion d'heures fériées
 * ne s'applique : la journée est présente ou elle ne l'est pas.
 */
function forfaitJourTreatment(input: HolidayCase): HolidayTreatment {
  if (input.presence !== "none") {
    return {
      codes: ["PJ"],
      contractReduction: "none",
      keepUsualShiftsAsHolidayHours: false,
      halfRestToPlace: false,
      reason: "Cadre au forfait jour présent : présence jour.",
    }
  }
  if (input.sunday && input.opening === "chome") {
    return {
      codes: ["RH"],
      contractReduction: "none",
      keepUsualShiftsAsHolidayHours: false,
      halfRestToPlace: false,
      reason: "Dimanche férié magasin fermé : un cadre ne peut être qu’en RH ou PJ.",
    }
  }
  return {
    codes: ["JF"],
    contractReduction: "none",
    keepUsualShiftsAsHolidayHours: false,
    halfRestToPlace: false,
    reason: "Cadre au forfait jour absent : jour férié.",
  }
}

// ── 2. Dimanches fériés ──────────────────────────────────────────────────────

/**
 * Le second tableau. Un dimanche férié ne se traite pas comme un férié
 * ordinaire, et l'ouverture HABITUELLE du magasin le dimanche — pas celle de ce
 * jour-là — commande tout.
 */
function sundayTreatment(input: HolidayCase): HolidayTreatment {
  // « Magasin habituellement fermé : il ne peut y avoir que du RH sur les
  // dimanches. » Rien d'autre à décider, pour personne.
  if (!input.storeOpensSundays) {
    return {
      codes: ["RH"],
      contractReduction: "none",
      keepUsualShiftsAsHolidayHours: false,
      halfRestToPlace: false,
      reason: "Magasin habituellement fermé le dimanche : repos hebdomadaire.",
    }
  }

  // Le magasin ouvre d'habitude, mais pas ce dimanche-là.
  if (input.opening === "chome") {
    return {
      codes: ["RH"],
      contractReduction: "none",
      keepUsualShiftsAsHolidayHours: false,
      halfRestToPlace: false,
      reason: "Dimanche férié non ouvert : repos hebdomadaire.",
    }
  }

  if (input.presence !== "none") {
    if (input.scheduleType === "fixed") {
      return WORKING("Dimanche férié travaillé, horaires fixes : planning habituel.")
    }
    return {
      codes: ["DF"],
      contractReduction: "one-tenth",
      keepUsualShiftsAsHolidayHours: false,
      halfRestToPlace: false,
      reason: "Dimanche férié travaillé, horaires variables : base diminuée d’un dixième.",
    }
  }

  // Il ne travaille pas ce dimanche férié.
  if (input.scheduleType === "fixed") {
    // « Soit en HF et DH, soit en RH le dimanche. » C'est son habitude du
    // dimanche qui départage : qui n'y vient jamais est en repos, pas en férié.
    if (!input.usuallyWorksSundays) {
      return {
        codes: ["RH"],
        contractReduction: "none",
        keepUsualShiftsAsHolidayHours: false,
        halfRestToPlace: false,
        reason: "Horaires fixes ne travaillant jamais le dimanche : repos hebdomadaire.",
      }
    }
    return {
      codes: ["HF", "DH"],
      contractReduction: "none",
      keepUsualShiftsAsHolidayHours: true,
      halfRestToPlace: true,
      reason: "Horaires fixes absents un dimanche férié : heures fériées et demi-repos.",
    }
  }

  // Horaires variables : c'est l'habitude du dimanche qui départage.
  if (input.usuallyWorksSundays) {
    return {
      codes: ["DF", "DH"],
      contractReduction: "one-tenth",
      keepUsualShiftsAsHolidayHours: false,
      halfRestToPlace: true,
      reason:
        "Travaille habituellement le dimanche mais pas celui-ci : base diminuée d’un dixième et demi-repos.",
    }
  }
  return {
    codes: ["RH"],
    contractReduction: "none",
    keepUsualShiftsAsHolidayHours: false,
    halfRestToPlace: false,
    reason: "Ne travaille jamais le dimanche : planning habituel avec un repos hebdomadaire.",
  }
}

// ── 3. Magasin fermé, hors dimanche ──────────────────────────────────────────

function closedTreatment(input: HolidayCase): HolidayTreatment {
  if (input.scheduleType === "variable") {
    return {
      codes: ["JF"],
      contractReduction: "one-fifth",
      keepUsualShiftsAsHolidayHours: false,
      halfRestToPlace: false,
      reason: "Magasin fermé, horaires variables : planning impacté d’un cinquième.",
    }
  }
  // « Le salarié est habituellement en repos, je laisse le RH. » Un jour de
  // repos ne devient pas férié parce que le magasin ferme : il était déjà libre.
  if (input.usualRestDay) {
    return {
      codes: ["RH"],
      contractReduction: "none",
      keepUsualShiftsAsHolidayHours: false,
      halfRestToPlace: false,
      reason: "Magasin fermé un jour de repos habituel : le repos hebdomadaire est conservé.",
    }
  }
  return {
    codes: ["HF"],
    contractReduction: "none",
    keepUsualShiftsAsHolidayHours: true,
    halfRestToPlace: true,
    reason: "Magasin fermé, horaires fixes : heures fériées à la place des plages.",
  }
}

// ── 4. Magasin ouvert le matin ───────────────────────────────────────────────

function halfClosedTreatment(input: HolidayCase): HolidayTreatment {
  if (input.presence !== "none") {
    if (input.scheduleType === "fixed") {
      return {
        codes: ["HF"],
        contractReduction: "none",
        keepUsualShiftsAsHolidayHours: false,
        halfRestToPlace: true,
        reason:
          "Demi-chômé, horaires fixes présents : heures fériées à la place des plages de l’après-midi.",
      }
    }
    return {
      codes: ["DF"],
      contractReduction: "one-tenth",
      keepUsualShiftsAsHolidayHours: false,
      halfRestToPlace: false,
      reason: "Demi-chômé, horaires variables présents : base diminuée d’un dixième.",
    }
  }

  if (input.scheduleType === "fixed") {
    // « Soit en HF toute la journée, soit en HF et DH, soit en RH. »
    if (input.usualRestDay) {
      return {
        codes: ["RH"],
        contractReduction: "none",
        keepUsualShiftsAsHolidayHours: false,
        halfRestToPlace: false,
        reason: "Demi-chômé un jour de repos habituel : le repos hebdomadaire est conservé.",
      }
    }
    return {
      codes: ["HF"],
      contractReduction: "none",
      keepUsualShiftsAsHolidayHours: true,
      halfRestToPlace: true,
      reason: "Demi-chômé, horaires fixes absents : heures fériées sur la journée.",
    }
  }

  // « Base diminuée d'1/10ème et d'un autre après-midi → transformation en JF
  // avec impact 1/5ème. » Les deux demies font un jour : le résultat NET est un
  // cinquième, et c'est ce que l'objectif de la semaine doit lire.
  return {
    codes: ["JF"],
    contractReduction: "one-fifth",
    keepUsualShiftsAsHolidayHours: false,
    halfRestToPlace: false,
    reason:
      "Demi-chômé, horaires variables absents : le demi-férié et l’après-midi libéré font un jour férié entier.",
  }
}

// ── 5. Magasin ouvert la journée ─────────────────────────────────────────────

function openTreatment(input: HolidayCase): HolidayTreatment {
  if (input.presence === "full") {
    return WORKING(
      input.scheduleType === "fixed"
        ? "Jour travaillé, horaires fixes : planification habituelle."
        : "Jour travaillé, horaires variables : planification."
    )
  }

  if (input.presence === "half") {
    return {
      codes: ["DH"],
      contractReduction: "none",
      keepUsualShiftsAsHolidayHours: false,
      halfRestToPlace: true,
      reason: "Jour travaillé en demi-journée : plages sur une moitié, demi-repos sur l’autre.",
    }
  }

  if (input.scheduleType === "variable") {
    return {
      codes: ["JF"],
      contractReduction: "one-fifth",
      keepUsualShiftsAsHolidayHours: false,
      halfRestToPlace: false,
      reason: "Jour travaillé, horaires variables absents : jour férié, impact d’un cinquième.",
    }
  }

  // « Si repos habituel ce jour, je positionne un RH ; si le salarié ne vient
  // pas travailler, je modifie ses plages en heures fériées. »
  if (input.usualRestDay) {
    return {
      codes: ["RH"],
      contractReduction: "none",
      keepUsualShiftsAsHolidayHours: false,
      halfRestToPlace: false,
      reason: "Jour travaillé qui est son repos habituel : repos hebdomadaire.",
    }
  }
  return {
    codes: ["HF"],
    contractReduction: "none",
    keepUsualShiftsAsHolidayHours: true,
    halfRestToPlace: true,
    reason: "Jour travaillé, horaires fixes absents : heures fériées à la place des plages.",
  }
}

/**
 * Les minutes à retirer à l'objectif de la semaine.
 *
 * Un cinquième de la BASE HEBDOMADAIRE, quel que soit le nombre de jours
 * travaillés au contrat — arbitrage confirmé : un temps partiel sur quatre
 * jours perd lui aussi un cinquième, pas un quart.
 */
export function reducedMinutes(contractMinutes: number, reduction: ContractReduction): number {
  if (reduction === "one-fifth") return Math.round(contractMinutes / 5)
  if (reduction === "one-tenth") return Math.round(contractMinutes / 10)
  return 0
}
