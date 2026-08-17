import {
  EMPTY_WEEK_SLOTS,
  permanenceMonthId,
  type PermanenceMonth,
  type PermanenceWeekSlots,
} from "@/features/permanence/models/permanence-month"

/**
 * Les mois de permanence conservés, un par clé.
 *
 * Pas d'index : la clé d'un mois se DÉDUIT de l'année et du mois demandés
 * (`permanenceMonthId`), donc une liste des mois existants n'apprendrait rien
 * qu'un balayage de l'année ne dise déjà — et un index qu'on oublie de mettre à
 * jour fait disparaître un mois qui existe pourtant.
 */

const KEY_PREFIX = "shiftos_permanence_"

export interface PermanenceRepository {
  get(year: number, month: number): PermanenceMonth | null
  /** Les douze mois d'une année, ceux qui existent seulement. */
  year(year: number): readonly PermanenceMonth[]
  save(month: PermanenceMonth): void
  remove(year: number, month: number): void
}

export function createPermanenceRepository(
  storage: Pick<Storage, "getItem" | "removeItem" | "setItem">
): PermanenceRepository {
  const get = (year: number, month: number): PermanenceMonth | null => {
    try {
      const value: unknown = JSON.parse(
        storage.getItem(`${KEY_PREFIX}${permanenceMonthId(year, month)}`) ?? "null"
      )
      return isPermanenceMonth(value) ? value : null
    } catch {
      // Un stockage illisible est un stockage vide : l'écran repart d'un mois
      // neuf plutôt que de refuser de s'afficher.
      return null
    }
  }

  return {
    get,
    year(year) {
      return Array.from({ length: 12 }, (_, index) => get(year, index + 1)).filter(
        (month): month is PermanenceMonth => month !== null
      )
    },
    save(month) {
      storage.setItem(`${KEY_PREFIX}${month.id}`, JSON.stringify(month))
    },
    remove(year, month) {
      storage.removeItem(`${KEY_PREFIX}${permanenceMonthId(year, month)}`)
    },
  }
}

function isPermanenceMonth(value: unknown): value is PermanenceMonth {
  if (typeof value !== "object" || value === null) return false
  const record = value as Record<string, unknown>
  return (
    record.schemaVersion === 1
    && typeof record.id === "string"
    && typeof record.year === "number"
    && typeof record.month === "number"
    && isRecord(record.assignments)
    && isRecord(record.rest)
    && isRecord(record.weeks)
    && typeof record.createdAt === "string"
    && typeof record.updatedAt === "string"
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** L'astreinte d'une semaine, ou son absence. */
export function weekSlotsOf(month: PermanenceMonth, weekKey: string): PermanenceWeekSlots {
  return month.weeks[weekKey] ?? EMPTY_WEEK_SLOTS
}
