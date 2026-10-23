import type { HolidayPlanEntry, HolidaySectorDay } from "@/features/core/models"
import { buildHourlyProfile, type SectorDemandConfiguration } from "@/features/sectors"

/** D'où vient le réglage appliqué — l'écran le dit, pour qu'on sache où le corriger. */
export type HolidaySectorDaySource = "adjusted" | "template" | "store"

export interface ResolvedHolidaySectorDay extends HolidaySectorDay {
  readonly source: Exclude<HolidaySectorDaySource, "store">
}

/**
 * Ce qu'un rayon fait de CE férié, ou `null` s'il suit le magasin.
 *
 * L'ordre est celui que le gérant a choisi : l'ajustement d'un férié précis
 * l'emporte sur le jour férié type du rayon, qui l'emporte sur les horaires de
 * férié du magasin. `null` est ce dernier cas — et il reproduit exactement le
 * comportement d'avant ce réglage : horaires du magasin, besoin du jour de la
 * semaine.
 *
 * Un férié chômé ferme le magasin entier : aucun rayon n'y ouvre, quoi que dise
 * son modèle, et la fonction rend `null` pour laisser cette règle-là décider.
 */
export function resolveHolidaySectorDay(
  entry: Pick<HolidayPlanEntry, "opening" | "sectorDays">,
  sector: Pick<SectorDemandConfiguration, "id" | "holidayDay">
): ResolvedHolidaySectorDay | null {
  if (entry.opening === "chome") return null
  const adjusted = entry.sectorDays?.[sector.id]
  if (adjusted) return { ...adjusted, source: "adjusted" }
  if (sector.holidayDay) return { ...sector.holidayDay, source: "template" }
  return null
}

/**
 * Un jour férié ouvert, aux horaires donnés, avec une personne par heure — le
 * point de départ proposé quand on active le réglage. Le gérant ajuste ensuite
 * le nombre de personnes plage par plage.
 */
export function defaultHolidaySectorDay(opensAt: string, closesAt: string, employees = 1): HolidaySectorDay {
  return {
    closed: false,
    opensAt,
    closesAt,
    slots: buildHourlyProfile(opensAt, closesAt, employees).map(({ start, end, employees: count }) => ({
      start,
      end,
      employees: count,
    })),
  }
}

/**
 * Changer les horaires sans perdre ce qui a été saisi : les plages qui
 * subsistent gardent leur nombre de personnes, les nouvelles reçoivent celui de
 * la plage voisine.
 */
export function withHolidayHours(day: HolidaySectorDay, opensAt: string, closesAt: string): HolidaySectorDay {
  const kept = new Map(day.slots.map((slot) => [slot.start, slot.employees]))
  const fallback = day.slots[0]?.employees ?? 1
  return {
    ...day,
    opensAt,
    closesAt,
    slots: buildHourlyProfile(opensAt, closesAt, fallback).map(({ start, end }) => ({
      start,
      end,
      employees: kept.get(start) ?? fallback,
    })),
  }
}
