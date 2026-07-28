import { describe, expect, it } from "vitest"

import {
  atomicCoverage,
  coverageDeficitMinutes,
  minimumConcurrentPresence,
} from "@/features/core/shared/coverage"

/**
 * REGRESSION — the reported case, verbatim.
 *
 * Three shifts: 06:00–12:30, 10:00–14:00, 12:15–17:45. On 12:00–13:00 the
 * full-span check ("does one shift cover the whole hour") counted 1 — only
 * the 10:00–14:00 shift spans it — while real concurrent presence never drops
 * below 2. This is the fixture every affected consumer's own test reproduces;
 * kept here once as the ground truth the others assert against.
 */
const WINDOW = { startMinutes: 720, endMinutes: 780 } // 12:00–13:00
const SHIFT_A = { startMinutes: 360, endMinutes: 750 } // 06:00–12:30
const SHIFT_B = { startMinutes: 600, endMinutes: 840 } // 10:00–14:00
const SHIFT_C = { startMinutes: 735, endMinutes: 1065 } // 12:15–17:45
const THREE_SHIFTS = [SHIFT_A, SHIFT_B, SHIFT_C]

describe("atomicCoverage — le cas rapporté", () => {
  it("découpe 12:00–13:00 aux bornes des trois shifts, pas à un pas fixe", () => {
    const segments = atomicCoverage(WINDOW, THREE_SHIFTS)
    expect(segments).toEqual([
      { startMinutes: 720, endMinutes: 735, present: 2 }, // A, B
      { startMinutes: 735, endMinutes: 750, present: 3 }, // A, B, C
      { startMinutes: 750, endMinutes: 780, present: 2 }, // B, C
    ])
  })

  it("la présence minimale sur l'heure est 2, jamais 1", () => {
    expect(minimumConcurrentPresence(WINDOW, THREE_SHIFTS)).toBe(2)
  })

  it("aucun déficit quand le besoin est 2 sur cette heure", () => {
    expect(coverageDeficitMinutes(WINDOW, THREE_SHIFTS, 2)).toBe(0)
  })

  it("un besoin de 3 ne déclare déficitaires que les 15 minutes réellement courtes", () => {
    // Every atomic piece is short by exactly one person against a requirement
    // of 3, except 12:15–12:30 where three are present. 15+0+30 = 45 minutes,
    // not 60 — the whole-window charge the old formula would have produced.
    expect(coverageDeficitMinutes(WINDOW, THREE_SHIFTS, 3)).toBe(45)
  })
})

describe("atomicCoverage — cas limites", () => {
  it("une fenêtre vide ou inversée ne produit aucun segment", () => {
    expect(atomicCoverage({ startMinutes: 780, endMinutes: 780 }, THREE_SHIFTS)).toEqual([])
    expect(atomicCoverage({ startMinutes: 800, endMinutes: 780 }, THREE_SHIFTS)).toEqual([])
  })

  it("aucun couvrant : un seul segment à présence nulle", () => {
    expect(atomicCoverage(WINDOW, [])).toEqual([
      { startMinutes: 720, endMinutes: 780, present: 0 },
    ])
    expect(minimumConcurrentPresence(WINDOW, [])).toBe(0)
  })

  it("un intervalle hors fenêtre n'ajoute aucune borne ni présence", () => {
    const outside = { startMinutes: 0, endMinutes: 100 }
    expect(atomicCoverage(WINDOW, [outside])).toEqual([
      { startMinutes: 720, endMinutes: 780, present: 0 },
    ])
  })

  it("un intervalle qui touche la fenêtre en un seul point ne compte pas", () => {
    const touching = { startMinutes: 600, endMinutes: 720 } // ends exactly at window start
    expect(atomicCoverage(WINDOW, [touching])).toEqual([
      { startMinutes: 720, endMinutes: 780, present: 0 },
    ])
  })

  it("un intervalle qui couvre exactement la fenêtre entière reproduit l'ancien comportement", () => {
    const spansWhole = { startMinutes: 700, endMinutes: 800 }
    expect(atomicCoverage(WINDOW, [spansWhole])).toEqual([
      { startMinutes: 720, endMinutes: 780, present: 1 },
    ])
  })

  it("deux salariés qui se relaient sans chevauchement restent à 1, jamais 2", () => {
    const morning = { startMinutes: 720, endMinutes: 750 }
    const afternoon = { startMinutes: 750, endMinutes: 780 }
    expect(atomicCoverage(WINDOW, [morning, afternoon])).toEqual([
      { startMinutes: 720, endMinutes: 750, present: 1 },
      { startMinutes: 750, endMinutes: 780, present: 1 },
    ])
    expect(minimumConcurrentPresence(WINDOW, [morning, afternoon])).toBe(1)
  })
})
