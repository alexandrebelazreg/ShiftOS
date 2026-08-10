import { describe, expect, it } from "vitest"

import { WEEK_DAYS } from "@/features/core/models"
import {
  COUNTRY_OPTIONS,
  PLANNING_MODE_OPTIONS,
  SPLIT_SHIFT_POLICY_OPTIONS,
  WEEK_DAY_LABELS,
} from "@/features/store/lib/constants"
import {
  hoursToMinutesValue,
  minutesToHoursValue,
} from "@/features/store/lib/duration-form-values"
import { storeSchema } from "@/features/store/schemas/store.schema"

function validStoreInput() {
  return {
    name: "Magasin test",
    brand: "",
    address: "1 rue du Test",
    city: "Paris",
    postalCode: "75001",
    country: "France",
    timezone: "Europe/Paris",
    openingHours: WEEK_DAYS.map((day) => ({
      day,
      closed: day === "sunday",
      opensAt: day === "sunday" ? "" : "09:00",
      closesAt: day === "sunday" ? "" : "19:00",
    })),
    planningMode: "dynamic",
    minShiftDuration: "120",
    maxShiftDuration: "480",
    timeGranularity: "30",
    splitShiftPolicy: "allowed",
    minSplitDuration: "60",
    maxSplitDuration: "180",
    maxSplitShiftsPerWeek: "2",
    minDailyHours: "2",
    maxDailyHours: "10",
    minRestBetweenShifts: "11",
    maxWeeklyHoursOverride: "",
  }
}

describe("refonte du formulaire magasin", () => {
  it("affiche les durées techniques en heures sans changer leur stockage en minutes", () => {
    expect(minutesToHoursValue("120")).toBe("2")
    expect(minutesToHoursValue("90")).toBe("1.5")
    expect(hoursToMinutesValue("2")).toBe("120")
    expect(hoursToMinutesValue("1.5")).toBe("90")
    expect(hoursToMinutesValue("")).toBe("")
  })

  it("refuse un maximum avec coupure inférieur au maximum en continu", () => {
    const parsed = storeSchema.safeParse({
      ...validStoreInput(),
      maxShiftDuration: "600",
      maxDailyHours: "8",
    })

    expect(parsed.success).toBe(false)
    if (parsed.success) return
    expect(parsed.error.issues).toContainEqual(expect.objectContaining({
      path: ["maxDailyHours"],
      message: "Le maximum avec coupure doit être supérieur ou égal au maximum en continu",
    }))
  })

  it("présente en français les choix visibles du formulaire", () => {
    expect(WEEK_DAY_LABELS).toMatchObject({ monday: "Lundi", sunday: "Dimanche" })
    expect(PLANNING_MODE_OPTIONS.map((option) => option.label)).toEqual([
      "Catalogue de services",
      "Génération automatique",
    ])
    expect(SPLIT_SHIFT_POLICY_OPTIONS.map((option) => option.label)).toEqual([
      "Interdites",
      "Exceptionnelles",
      "Autorisées",
      "Libres",
    ])
    expect(COUNTRY_OPTIONS.find((option) => option.value === "Belgium")?.label).toBe("Belgique")
  })

  it("renvoie des erreurs de saisie en français", () => {
    const parsed = storeSchema.safeParse({ ...validStoreInput(), name: "" })

    expect(parsed.success).toBe(false)
    if (parsed.success) return
    expect(parsed.error.issues).toContainEqual(expect.objectContaining({
      path: ["name"],
      message: "Le nom du magasin est obligatoire",
    }))
  })
})
