import type { Minutes, PlanningMode, TimeGranularity } from "@/features/core/models"

/**
 * PlanningSettings — HOW plannings are generated. Reuses the core `PlanningMode`
 * (`shift_library` | `dynamic`) and `TimeGranularity` (15 | 30 | 60). The shift
 * duration bounds drive dynamic generation.
 */
export interface PlanningSettings {
  readonly mode: PlanningMode
  readonly granularity: TimeGranularity
  readonly minShiftDuration: Minutes
  /**
   * Durée maximale d'UNE TRAITE, pauses exclues.
   *
   * C'est ce que « shift » veut dire ici, et c'est ce que le champ a toujours
   * voulu dire côté configuration : huit heures d'affilée. Le traducteur V3 en
   * faisait un plafond de JOURNÉE, si bien qu'un magasin réglé « pas plus de
   * 8 h d'affilée » interdisait aussi les journées de 10 h coupées, que la même
   * configuration autorise explicitement par ailleurs.
   */
  readonly maxShiftDuration: Minutes
  /**
   * Durée maximale d'une JOURNÉE, pauses comprises.
   *
   * Absente pour une configuration écrite avant que la distinction existe : le
   * plafond de journée reste alors celui du rayon, comme avant. Ne jamais
   * inventer ici une valeur que personne n'a saisie.
   */
  readonly maxDailyDuration?: Minutes
}
