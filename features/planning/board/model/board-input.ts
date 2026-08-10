import type { EmployeeId, IsoDate, WeekDay } from "@/features/core/models"

/**
 * The engine-neutral input the planning board renders.
 *
 * This shape is deliberately poor: identifiers, minutes, counts. It mentions
 * neither V2 nor V3, neither `Assignment` nor `PlanningSolutionV3`. Any engine
 * that can say "this person works these minutes on this day" can feed the board
 * through an adapter, which is what makes the UI survive the engine swap: when
 * V3 replaces V2, a new adapter is written and not one component changes.
 *
 * Every time is an integer number of minutes since midnight — 06:00 is 360 —
 * so the views never parse a string to lay anything out.
 */

export interface BoardSector {
  readonly id: string
  readonly name: string
  readonly marketZone?: boolean
  /**
   * La couleur réglée pour ce rayon, telle que le gérant l'a choisie.
   *
   * C'est elle qui identifie le rayon sur la grille. Absente, la barre garde
   * son habillage de secours : on n'invente pas un réglage.
   */
  readonly color?: string
  /**
   * The sector's own opening hours, when it declares them.
   *
   * The board colours a shift "opening" or "closing" by comparing it to the
   * day's window, and that window is the SECTOR's — a Drive that opens an hour
   * before the shop has its own opening, and marking it against the store's
   * would paint the real opener as an ordinary day. Absent means the sector
   * follows the store.
   */
  readonly hours?: readonly {
    readonly day: WeekDay
    readonly closed: boolean
    readonly opensAt: string
    readonly closesAt: string
  }[]
}

export interface BoardEmployee {
  readonly id: EmployeeId
  readonly name: string
  /** Sectors this person may be scheduled in. */
  readonly sectorIds: readonly string[]
  readonly contractMinutes: number
  /**
   * Target of this particular generation when it deliberately covers only a
   * sector share of the employment contract.
   */
  readonly weeklyTargetMinutes?: number
  /** Human-readable rules, already worded by the adapter. */
  readonly rules: readonly string[]
}

export interface BoardDay {
  readonly date: IsoDate
  readonly weekDay: WeekDay
  readonly closed: boolean
  /** Null when the day is closed. */
  readonly opensAtMinutes: number | null
  readonly closesAtMinutes: number | null
}

export interface BoardSegment {
  readonly startMinutes: number
  readonly endMinutes: number
}

export interface BoardShift {
  readonly id: string
  readonly employeeId: EmployeeId
  /** Premier rayon, conservé pour les anciens consommateurs mono-rayon. */
  readonly sectorId: string
  readonly sectorAssignments?: readonly (BoardSegment & { readonly sectorId: string })[]
  readonly date: IsoDate
  /** Continuous span from first start to last end, split shifts included. */
  readonly startMinutes: number
  readonly endMinutes: number
  /** Worked minutes, which is less than the span for a split shift. */
  readonly workedMinutes: number
  readonly segments: readonly BoardSegment[]
  readonly opensDay: boolean
  readonly closesDay: boolean
}

export interface BoardDemandSlot {
  readonly sectorId: string
  readonly date: IsoDate
  readonly startMinutes: number
  readonly endMinutes: number
  readonly requiredEmployees: number
}

/**
 * What the engine reported about the run, reduced to what a manager acts on.
 * Neutral on purpose: the adapter translates whatever V2 or V3 produced.
 */
export interface BoardDiagnosticsInput {
  /** True when the schedule may not be published at all. */
  readonly blocking: boolean
  /** True when legal but carrying degradations someone must accept. */
  readonly requiresAcceptance: boolean
  /** Everything a manager never needs: kept for the technical accordion. */
  readonly technical: readonly { readonly label: string; readonly value: string }[]
}

export interface PlanningBoardInput {
  readonly periodStart: IsoDate
  readonly periodEnd: IsoDate
  readonly sectors: readonly BoardSector[]
  readonly employees: readonly BoardEmployee[]
  readonly days: readonly BoardDay[]
  readonly shifts: readonly BoardShift[]
  readonly demand: readonly BoardDemandSlot[]
  readonly diagnostics?: BoardDiagnosticsInput
}

/** What the user is currently looking at. Pure UI state, no domain meaning. */
export interface PlanningBoardSelection {
  readonly view: "sector" | "day" | "employee"
  /**
   * Sectors currently shown, as an explicit set. An empty array shows nothing;
   * every id shows the union of all sectors. There is no "null means all"
   * sentinel — the caller always states exactly which sectors it wants.
   */
  readonly sectorIds: readonly string[]
  readonly date: IsoDate | null
  readonly employeeId: EmployeeId | null
}
