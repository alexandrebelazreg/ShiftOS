import type { WeekDay } from "@/features/core/models"
import type { PermanenceRole } from "@/features/permanence/models/permanence-month"

/**
 * Ce qu'une personne a déjà porté du tour de permanence.
 *
 * La même structure sert deux usages qu'il aurait été tentant de séparer :
 * elle est ce que le générateur ÉQUILIBRE, et ce que le récapitulatif AFFICHE.
 * Les tenir dans deux formes distinctes aurait permis d'équilibrer autre chose
 * que ce qui est montré — et le récapitulatif est précisément la pièce qui doit
 * prouver que la répartition est juste.
 */
export interface PermanenceLoad {
  readonly openings: number
  readonly closings: number
  /** Fermetures tombant un samedi — la colonne « dont Samedis » de la feuille. */
  readonly saturdayClosings: number
  /** Ouvertures tombant un samedi. */
  readonly saturdayOpenings: number
  /** Dimanches effectués, ouverture ou fermeture confondues. */
  readonly sundays: number
  /** Fermetures par jour de la semaine — les colonnes Lun…Dim du récapitulatif. */
  readonly closingsByDay: Readonly<Record<WeekDay, number>>
}

export const EMPTY_LOAD: PermanenceLoad = {
  openings: 0,
  closings: 0,
  saturdayClosings: 0,
  saturdayOpenings: 0,
  sundays: 0,
  closingsByDay: {
    monday: 0,
    tuesday: 0,
    wednesday: 0,
    thursday: 0,
    friday: 0,
    saturday: 0,
    sunday: 0,
  },
}

/** Toutes permanences confondues : ce qui pèse réellement sur une personne. */
export function totalPermanences(load: PermanenceLoad): number {
  return load.openings + load.closings
}

/** La charge augmentée d'une permanence de plus. */
export function withPermanence(
  load: PermanenceLoad,
  weekDay: WeekDay,
  role: PermanenceRole
): PermanenceLoad {
  const closing = role === "closing"
  return {
    openings: load.openings + (closing ? 0 : 1),
    closings: load.closings + (closing ? 1 : 0),
    saturdayClosings: load.saturdayClosings + (closing && weekDay === "saturday" ? 1 : 0),
    saturdayOpenings: load.saturdayOpenings + (!closing && weekDay === "saturday" ? 1 : 0),
    sundays: load.sundays + (weekDay === "sunday" ? 1 : 0),
    closingsByDay: closing
      ? { ...load.closingsByDay, [weekDay]: load.closingsByDay[weekDay] + 1 }
      : load.closingsByDay,
  }
}

/** Deux charges additionnées — un mois posé sur le passif des mois précédents. */
export function addLoads(left: PermanenceLoad, right: PermanenceLoad): PermanenceLoad {
  return {
    openings: left.openings + right.openings,
    closings: left.closings + right.closings,
    saturdayClosings: left.saturdayClosings + right.saturdayClosings,
    saturdayOpenings: left.saturdayOpenings + right.saturdayOpenings,
    sundays: left.sundays + right.sundays,
    closingsByDay: {
      monday: left.closingsByDay.monday + right.closingsByDay.monday,
      tuesday: left.closingsByDay.tuesday + right.closingsByDay.tuesday,
      wednesday: left.closingsByDay.wednesday + right.closingsByDay.wednesday,
      thursday: left.closingsByDay.thursday + right.closingsByDay.thursday,
      friday: left.closingsByDay.friday + right.closingsByDay.friday,
      saturday: left.closingsByDay.saturday + right.closingsByDay.saturday,
      sunday: left.closingsByDay.sunday + right.closingsByDay.sunday,
    },
  }
}

/**
 * Ce que cette personne a déjà fait de ce couple (jour, rôle).
 *
 * Le générateur ne s'en sert que pour le samedi et le dimanche : ce sont les
 * seules journées dont la charge se compte séparément, parce qu'elles sont les
 * seules dont personne ne veut deux fois de suite.
 */
export function weekendBurden(load: PermanenceLoad, weekDay: WeekDay, role: PermanenceRole): number {
  if (weekDay === "sunday") return load.sundays
  if (weekDay !== "saturday") return 0
  return role === "closing" ? load.saturdayClosings : load.saturdayOpenings
}
