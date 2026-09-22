export const PAID_LEAVE_PERIOD_KINDS = ["summer", "winter", "custom"] as const
export type PaidLeavePeriodKind = (typeof PAID_LEAVE_PERIOD_KINDS)[number]

export const PAID_LEAVE_CAMPAIGN_STATUSES = ["editing", "validated"] as const
export type PaidLeaveCampaignStatus = (typeof PAID_LEAVE_CAMPAIGN_STATUSES)[number]

export type PaidLeaveWeekId = `${number}-W${string}`

export interface PaidLeavePeriod {
  readonly kind: PaidLeavePeriodKind
  readonly startWeek: number
  readonly endWeek: number
}

export interface PaidLeaveEmployeeSettings {
  readonly employeeId: string
  readonly priority: boolean
  readonly linkedEmployeeId: string | null
  readonly entryDate: string
  readonly firstChoiceHistory: number
  /**
   * Combien de semaines cette personne a ENCORE le droit de poser.
   *
   * Le solde RESTANT au moment où la campagne s'ouvre, pas le droit annuel :
   * c'est le nombre que la paie sait donner, et le seul qui n'oblige à
   * reconstituer aucun historique. Le déduire des campagnes passées demanderait
   * de connaître aussi les congés posés hors campagne, et se tromperait en
   * silence.
   *
   * En SEMAINES, comme tout le reste de cet écran. Une personne à qui il reste
   * vingt-deux jours ouvrables ne peut poser que quatre semaines pleines : c'est
   * quatre qu'on saisit, et le demi-jour perdu se règle hors de cet outil.
   *
   * `null` — la valeur par défaut, et celle de toutes les campagnes écrites
   * avant ce champ — veut dire « pas de solde connu » : rien n'est vérifié, ce
   * qui est exactement le comportement d'avant.
   *
   * Zéro est une valeur LÉGITIME et distincte : elle dit que la personne n'a
   * plus rien à poser, et aucune semaine ne lui sera accordée.
   */
  readonly entitlementWeeks?: number | null
}

/**
 * Les vœux d'une personne : trois PLANS COMPLETS, pas trois listes d'options.
 *
 * Chaque rang décrit la même absence vue autrement — « je veux deux semaines :
 * celles-ci de préférence, sinon celles-là, sinon ces dernières ». Le nombre de
 * semaines demandées n'est donc pas une donnée à part, c'est la TAILLE d'un
 * plan, et les trois portent la même.
 *
 * Il a existé comme champ, saisi à la main et laissé à zéro par défaut : une
 * personne dont les vœux s'affichaient à l'écran repartait avec un objectif nul
 * et n'obtenait rien, en silence. Un nombre qui se déduit ne peut pas être
 * oublié.
 */
export interface PaidLeaveRequest {
  readonly employeeId: string
  readonly wish1: readonly PaidLeaveWeekId[]
  readonly wish2: readonly PaidLeaveWeekId[]
  readonly wish3: readonly PaidLeaveWeekId[]
}

export interface PaidLeaveCoverageRule {
  readonly minimumHours: number
  readonly toleratedDeficitHours: number
  /**
   * Combien de personnes peuvent s'absenter ENSEMBLE cette semaine-là.
   *
   * `null` — la valeur par défaut, et celle de toutes les campagnes écrites
   * avant ce champ — veut dire « aucun plafond » : seules les heures décident.
   *
   * Les heures ne suffisent pourtant pas. Deux temps partiels qui pèsent autant
   * qu'un temps plein ne le remplacent pas quand il s'agit de tenir un comptoir,
   * d'ouvrir ou de fermer. « Pas plus de deux en congé en même temps » est la
   * phrase que prononce un gérant ; le minimum d'heures ne sait pas la dire.
   *
   * Zéro est une valeur LÉGITIME et distincte de l'absence de plafond : elle
   * ferme la semaine à tout le monde.
   */
  readonly maximumAbsent?: number | null
}

export interface PaidLeaveReinforcementPool {
  readonly id: string
  readonly label: string
  readonly totalHours: number
  readonly startWeekId: PaidLeaveWeekId
  readonly endWeekId: PaidLeaveWeekId
  readonly scope: "global" | "sector"
  readonly sectorId: string | null
}

export interface PaidLeaveReinforcementAllocation {
  readonly poolId: string
  readonly sectorId: string
  readonly weekId: PaidLeaveWeekId
  readonly hours: number
}

/**
 * Le VERDICT d'une attribution, pour une personne.
 *
 * Enregistré avec la campagne, dans `PaidLeaveSolution.compromises` : c'est ce
 * que le gérant relira dans six mois pour savoir pourquoi quelqu'un est parti
 * en septembre.
 *
 * À NE PAS CONFONDRE avec `PaidLeaveSetback`, dans la projection, qui portait le
 * même nom jusqu'au 21 septembre 2026. Celui-là mesure un ÉCART entre deux
 * scénarios et se recalcule à chaque rendu ; celui-ci est un fait, et il dure.
 */
export interface PaidLeaveCompromise {
  readonly employeeId: string
  readonly grantedWeeks: readonly PaidLeaveWeekId[]
  readonly preferenceRanks: readonly (1 | 2 | 3)[]
  readonly mixed: boolean
  readonly prioritySatisfied: boolean | null
  readonly message: string
}

/** Les quatre arbitrages que le modèle s'interdit, et que le gérant peut décider. */
export type PaidLeaveConcessionLever =
  | "unserved_total"
  | "unserved_worst"
  | "couples"
  | "mixed_plans"

export interface PaidLeaveConcession {
  readonly lever: PaidLeaveConcessionLever
  /** Le total de personnes servies au premier vœu SOUS cette concession. */
  readonly firstChoiceServed: number
  /** Qui serait servi au premier vœu. Un témoin : le compte, lui, est exact. */
  readonly employeeIds: readonly string[]
}

export interface PaidLeaveSolution {
  readonly generatedAt: string
  readonly status: "optimal"
  readonly grants: Readonly<Record<string, readonly PaidLeaveWeekId[]>>
  readonly reinforcementAllocations: readonly PaidLeaveReinforcementAllocation[]
  readonly compromises: readonly PaidLeaveCompromise[]
  /**
   * Qui le SOLVEUR a compté comme servi sur tout son premier plan.
   *
   * Conservé pour être confronté à ce que l'application, elle, lit sur les
   * mêmes attributions. Le prédicat est écrit deux fois — en Python parce que
   * le solveur l'optimise, en TypeScript parce que la validation doit savoir
   * juger des attributions retouchées à la main, que le solveur n'a jamais vues.
   * Le doublon est donc nécessaire ; c'est son SILENCE qui ne l'était pas.
   *
   * Absent des solutions calculées avant ce champ : rien à comparer, et surtout
   * pas « personne ».
   */
  readonly firstChoiceEmployeeIds?: readonly string[]
  /**
   * Ce que chaque concession achèterait, mesuré avec le budget qui restait.
   *
   * Conservé avec la solution parce que ces nombres NE VALENT QUE POUR ELLE :
   * ils répondent « si vous lâchez ceci, voilà ce que vous gagnez par rapport à
   * cette campagne-là ». Les afficher à côté d'attributions retouchées à la main
   * ferait promettre un gain sur une référence qui n'existe plus.
   */
  readonly concessions?: readonly PaidLeaveConcession[]
  /**
   * Les attributions telles qu'elles étaient JUSTE AVANT ce calcul.
   *
   * Le geste réel d'un gérant est une boucle : desserrer, relancer, regarder,
   * recommencer. Sans cette photo, chaque tour remplace tout sans rien dire de
   * ce qui a bougé — et comparer vingt-six colonnes de mémoire n'est pas un
   * exercice que quelqu'un réussit.
   *
   * Les attributions À L'ÉCRAN, pas la solution précédente du solveur : les deux
   * diffèrent dès qu'une semaine a été retouchée à la main, et c'est bien à sa
   * dernière version que le gérant compare mentalement.
   *
   * Absent sur les solutions calculées avant ce champ : rien à comparer.
   */
  readonly previousGrants?: Readonly<Record<string, readonly PaidLeaveWeekId[]>>
}

export interface PaidLeaveValidatedSnapshot {
  readonly validatedAt: string
  readonly grants: Readonly<Record<string, readonly PaidLeaveWeekId[]>>
  readonly reinforcementAllocations: readonly PaidLeaveReinforcementAllocation[]
  readonly fullFirstChoiceEmployeeIds: readonly string[]
  /**
   * La fermeture telle qu'elle était au moment de valider.
   *
   * Figée AVEC les attributions, et pas seulement pour la mémoire : elle décide
   * comment les lire. Deux semaines accordées de part et d'autre d'une fermeture
   * forment un congé continu ; la même paire sans fermeture est un congé coupé
   * en deux, irrégulier au sens de L3141-19. Relire un arbitrage de l'année
   * dernière à la lumière d'une fermeture modifiée depuis lui ferait dire
   * l'inverse de ce qui a été décidé.
   *
   * Absent sur les campagnes validées avant ce champ : elles n'avaient pas de
   * fermeture du tout, donc la liste vide est la bonne lecture.
   */
  readonly closureWeekIds?: readonly PaidLeaveWeekId[]
}

export interface PaidLeaveCampaign {
  readonly schemaVersion: 1
  readonly id: string
  readonly name: string
  readonly year: number
  readonly period: PaidLeavePeriod
  readonly status: PaidLeaveCampaignStatus
  readonly employeeSettings: Readonly<Record<string, PaidLeaveEmployeeSettings>>
  readonly requests: Readonly<Record<string, PaidLeaveRequest>>
  readonly coverage: Readonly<
    Record<string, Readonly<Record<PaidLeaveWeekId, PaidLeaveCoverageRule>>>
  >
  readonly reinforcementPools: readonly PaidLeaveReinforcementPool[]
  /**
   * Les semaines où le magasin FERME, et où tout le monde est donc en congé.
   *
   * L'article L3141-16 laisse à l'employeur le soin de fixer l'ordre et les dates
   * des départs, et la fermeture annuelle en est le cas le plus simple : elle ne
   * s'arbitre pas, elle s'impose. Ces semaines ne sont donc PAS des attributions
   * — personne ne les a demandées, personne ne peut les refuser — mais elles
   * décomptent bien du solde, et c'est là tout leur effet sur la campagne.
   *
   * UNE LISTE, ET NON UN INTERVALLE. Une fermeture est presque toujours d'un
   * seul tenant, mais rien ne l'exige : un magasin peut fermer une semaine en
   * août et une entre Noël et le Nouvel An. Un intervalle interdirait le second
   * cas pour une élégance dont personne n'a besoin, et la grille de semaines que
   * l'écran dessine déjà coche une liste sans rien ajouter.
   *
   * Absent — la valeur de toutes les campagnes écrites avant ce champ — vaut
   * « aucune fermeture », ce qui est exactement le comportement d'avant.
   */
  readonly closureWeekIds?: readonly PaidLeaveWeekId[]
  readonly grants: Readonly<Record<string, readonly PaidLeaveWeekId[]>>
  readonly solution: PaidLeaveSolution | null
  readonly validatedSnapshot: PaidLeaveValidatedSnapshot | null
  readonly createdAt: string
  readonly updatedAt: string
}
