import { describe, expect, it } from "vitest"
import { configurationItem, navItems } from "@/components/layout/nav-config"
import { DEFAULT_STORE_CONFIGURATION } from "@/features/store/defaults"

describe("navigation alpha", () => {
  it("limite la navigation principale aux opérations quotidiennes", () => {
    expect(navItems.map((item) => item.title)).toEqual(["Tableau de bord", "Planning", "Congés", "Absences"])
    expect(configurationItem).toMatchObject({ title: "Configuration", href: "/configuration" })
  })

  it("ne fournit aucun horaire fictif pour un magasin non configuré", () => {
    expect(DEFAULT_STORE_CONFIGURATION.openingHours.every((day) => day.closed && day.ranges.length === 0)).toBe(true)
  })
})
