import { describe, expect, it } from "vitest"

import {
  applyShiftDrag,
  segmentGeometry,
  snapMinutes,
  type DragBounds,
  type EditableShift,
} from "@/features/planning/board/model/shift-edit"

// A store open 08:00 → 20:00. Every time below is minutes since midnight.
const BOUNDS: DragBounds = { openMinutes: 480, closeMinutes: 1200 }

/** 09:00 → 13:00, a four-hour continuous shift. */
const SHIFT: EditableShift = {
  startMinutes: 540,
  endMinutes: 780,
  segments: [{ startMinutes: 540, endMinutes: 780 }],
}

/** 09:00 → 11:00 + 12:00 → 14:00, a split shift with a one-hour break. */
const SPLIT: EditableShift = {
  startMinutes: 540,
  endMinutes: 840,
  segments: [
    { startMinutes: 540, endMinutes: 660 },
    { startMinutes: 720, endMinutes: 840 },
  ],
}

describe("snapping — pas de 15 minutes", () => {
  it("arrondit au quart d'heure le plus proche", () => {
    expect(snapMinutes(540)).toBe(540)
    expect(snapMinutes(547)).toBe(540)
    expect(snapMinutes(548)).toBe(555)
    // A half rounds up, so the grid never feels like it lags the cursor.
    expect(snapMinutes(7.5)).toBe(15)
  })
})

describe("déplacement — conserve la durée, reste dans la journée", () => {
  const duration = (shift: EditableShift) =>
    shift.segments.reduce((sum, s) => sum + (s.endMinutes - s.startMinutes), 0)

  it("décale le début et la fin du même pas", () => {
    // Grabbed at 10:00 (60 min into the shift), pointer now at 10:30.
    const moved = applyShiftDrag(SHIFT, "move", 630, 600, BOUNDS)
    expect(moved.startMinutes).toBe(570)
    expect(moved.endMinutes).toBe(810)
    expect(duration(moved)).toBe(duration(SHIFT))
  })

  it("s'arrête à la fermeture sans écraser la durée", () => {
    // Pushed far past closing: the end stops at 20:00 and the start follows.
    const moved = applyShiftDrag(SHIFT, "move", 2000, 600, BOUNDS)
    expect(moved.endMinutes).toBe(1200)
    expect(moved.startMinutes).toBe(960)
    expect(duration(moved)).toBe(duration(SHIFT))
  })

  it("s'arrête à l'ouverture sans écraser la durée", () => {
    const moved = applyShiftDrag(SHIFT, "move", 0, 600, BOUNDS)
    expect(moved.startMinutes).toBe(480)
    expect(moved.endMinutes).toBe(720)
    expect(duration(moved)).toBe(duration(SHIFT))
  })

  it("déplace tous les segments d'une coupure ensemble", () => {
    const moved = applyShiftDrag(SPLIT, "move", 615, 600, BOUNDS)
    expect(moved.segments).toEqual([
      { startMinutes: 555, endMinutes: 675 },
      { startMinutes: 735, endMinutes: 855 },
    ])
  })
})

describe("redimensionnement — une seule extrémité bouge", () => {
  it("la poignée gauche ne change que le début", () => {
    const resized = applyShiftDrag(SHIFT, "resize-start", 510, 0, BOUNDS)
    expect(resized.startMinutes).toBe(510)
    expect(resized.endMinutes).toBe(780)
  })

  it("la poignée droite ne change que la fin", () => {
    const resized = applyShiftDrag(SHIFT, "resize-end", 900, 0, BOUNDS)
    expect(resized.startMinutes).toBe(540)
    expect(resized.endMinutes).toBe(900)
  })

  it("borne le début à l'ouverture", () => {
    const resized = applyShiftDrag(SHIFT, "resize-start", 300, 0, BOUNDS)
    expect(resized.startMinutes).toBe(480)
  })

  it("borne la fin à la fermeture", () => {
    const resized = applyShiftDrag(SHIFT, "resize-end", 1400, 0, BOUNDS)
    expect(resized.endMinutes).toBe(1200)
  })

  it("garde au moins 15 minutes de travail", () => {
    // Dragging the end back past the start floors at start + 15.
    const resized = applyShiftDrag(SHIFT, "resize-end", 400, 0, BOUNDS)
    expect(resized.endMinutes).toBe(555)
  })

  it("redimensionne une coupure contre son propre segment, sans avaler la pause", () => {
    const resized = applyShiftDrag(SPLIT, "resize-start", 700, 0, BOUNDS)
    // First segment ends at 11:00; the start cannot pass 10:45 (end − 15).
    expect(resized.segments[0]).toEqual({ startMinutes: 645, endMinutes: 660 })
    expect(resized.segments[1]).toEqual({ startMinutes: 720, endMinutes: 840 })
  })
})

describe("géométrie — pourcentages de la fenêtre d'ouverture", () => {
  it("place un segment comme le fait le ViewModel", () => {
    const [geometry] = segmentGeometry(SHIFT, BOUNDS)
    // (540 − 480) / 720 = 8.33 %, (780 − 540) / 720 = 33.33 %.
    expect(geometry.leftPercent).toBeCloseTo(8.333, 2)
    expect(geometry.widthPercent).toBeCloseTo(33.333, 2)
  })
})
