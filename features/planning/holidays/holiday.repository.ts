import type { HolidaySectorDay, IsoDate } from "@/features/core/models"
import type { HolidayOpening } from "@/features/planning/holidays/model/holiday-schedule"

/**
 * Ce que le magasin a décidé pour chaque jour férié, et qui s'y est porté
 * volontaire.
 *
 * Stocké À PLAT, une entrée par date, toutes années confondues : les dates d'un
 * férié se recalculent (`frenchHolidaysOf`) et ne bougent jamais pour une année
 * donnée, donc la date est une clé stable — et la lecture d'une année n'a
 * qu'à réclamer les siennes.
 *
 * Rien n'est stocké pour un férié laissé à sa proposition par défaut. Un
 * fichier qui répéterait les onze lignes de chaque année ne dirait pas ce que
 * le gérant a réellement choisi, et une évolution des valeurs par défaut ne
 * pourrait plus l'atteindre.
 */

export interface StoredHolidayDay {
  readonly opening?: HolidayOpening
  readonly opensAt?: string | null
  readonly closesAt?: string | null
  /** Les salariés qui se sont portés volontaires pour ce jour-là. */
  readonly volunteerIds?: readonly string[]
  /** Les rayons dont ce férié s'écarte du jour férié type, par identifiant. */
  readonly sectors?: Readonly<Record<string, HolidaySectorDay>>
}

export type StoredHolidays = Readonly<Record<IsoDate, StoredHolidayDay>>

export interface HolidayRepository {
  read(): Promise<StoredHolidays>
  save(holidays: StoredHolidays): Promise<void>
}

const KEY = "shiftos_holidays"

export function createHolidayRepository(
  storage: Pick<Storage, "getItem" | "setItem">
): HolidayRepository {
  return {
    async read() {
      try {
        const parsed: unknown = JSON.parse(storage.getItem(KEY) ?? "{}")
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}
        const entries = Object.entries(parsed as Record<string, unknown>)
          .flatMap(([date, value]) => {
            const day = readDay(value)
            return day ? [[date, day] as const] : []
          })
        return Object.fromEntries(entries)
      } catch {
        // Un stockage illisible est un stockage vide : le calendrier repart de
        // ses valeurs par défaut plutôt que de faire tomber l'écran.
        return {}
      }
    },
    async save(holidays) {
      storage.setItem(KEY, JSON.stringify(holidays))
    },
  }
}

const OPENINGS: readonly string[] = ["chome", "demi-chome", "travaille"]

function readDay(value: unknown): StoredHolidayDay | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const opening = typeof raw.opening === "string" && OPENINGS.includes(raw.opening)
    ? (raw.opening as HolidayOpening)
    : undefined
  return {
    ...(opening ? { opening } : {}),
    ...(typeof raw.opensAt === "string" || raw.opensAt === null ? { opensAt: raw.opensAt } : {}),
    ...(typeof raw.closesAt === "string" || raw.closesAt === null ? { closesAt: raw.closesAt } : {}),
    volunteerIds: Array.isArray(raw.volunteerIds)
      ? raw.volunteerIds.filter((id): id is string => typeof id === "string")
      : [],
    ...(readSectors(raw.sectors) ? { sectors: readSectors(raw.sectors)! } : {}),
  }
}

/** Les ajustements par rayon, en ne gardant que ceux qui se relisent entiers. */
function readSectors(value: unknown): Record<string, HolidaySectorDay> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const entries = Object.entries(value as Record<string, unknown>).flatMap(([id, raw]) => {
    if (!raw || typeof raw !== "object") return []
    const day = raw as Record<string, unknown>
    if (typeof day.closed !== "boolean" || typeof day.opensAt !== "string" || typeof day.closesAt !== "string") return []
    const slots = Array.isArray(day.slots)
      ? day.slots.flatMap((slot) => {
          const s = slot as Record<string, unknown>
          return typeof s?.start === "string" && typeof s.end === "string" && typeof s.employees === "number"
            ? [{ start: s.start, end: s.end, employees: s.employees }]
            : []
        })
      : []
    return [[id, { closed: day.closed, opensAt: day.opensAt, closesAt: day.closesAt, slots }] as const]
  })
  return entries.length > 0 ? Object.fromEntries(entries) : null
}
