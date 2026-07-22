import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import type { EditableShift } from "@/features/planning/board/model/shift-edit"
import {
  buildRegenerationRequest,
  DEFAULT_REGENERATION_OPTIONS,
  summarizeLocalWork,
  type RegenerationOptions,
} from "@/features/planning/board/model/regeneration-request"
import {
  applyShiftEdit,
  EMPTY_EDIT_STATE,
  resetShiftEdits,
  setShiftLock,
} from "@/features/planning/board/model/shift-edit-state"

const editable = (start: number, end: number): EditableShift => ({
  startMinutes: start,
  endMinutes: end,
  segments: [{ startMinutes: start, endMinutes: end }],
})

const OPTIONS: RegenerationOptions = {
  preserveLockedShifts: true,
  preserveManualEdits: true,
  minimizeOtherChanges: false,
}

describe("requête de régénération — état vide", () => {
  it("ne liste ni verrou ni edit", () => {
    const request = buildRegenerationRequest(EMPTY_EDIT_STATE, OPTIONS)
    expect(request.lockedShiftIds).toEqual([])
    expect(request.editedShifts).toEqual([])
  })

  it("résume l'absence de travail local", () => {
    const summary = summarizeLocalWork(EMPTY_EDIT_STATE)
    expect(summary).toEqual({ lockedShiftCount: 0, editedShiftCount: 0, isEmpty: true })
  })
})

describe("requête de régénération — verrous", () => {
  it("liste plusieurs verrous, triés et déterministes", () => {
    let state = setShiftLock(EMPTY_EDIT_STATE, "s2", true)
    state = setShiftLock(state, "s1", true)
    state = setShiftLock(state, "s3", true)
    const request = buildRegenerationRequest(state, OPTIONS)
    expect(request.lockedShiftIds).toEqual(["s1", "s2", "s3"])
    expect(summarizeLocalWork(state).lockedShiftCount).toBe(3)
    expect(summarizeLocalWork(state).isEmpty).toBe(false)
  })
})

describe("requête de régénération — modifications", () => {
  it("liste plusieurs edits et conserve exactement les horaires modifiés", () => {
    let state = applyShiftEdit(EMPTY_EDIT_STATE, "s2", editable(600, 780))
    state = applyShiftEdit(state, "s1", editable(480, 720))
    const request = buildRegenerationRequest(state, OPTIONS)
    expect(request.editedShifts).toEqual([
      { shiftId: "s1", startMinute: 480, endMinute: 720 },
      { shiftId: "s2", startMinute: 600, endMinute: 780 },
    ])
    expect(summarizeLocalWork(state).editedShiftCount).toBe(2)
  })

  it("reflète la dernière valeur d'un shift ré-édité", () => {
    let state = applyShiftEdit(EMPTY_EDIT_STATE, "s1", editable(480, 720))
    state = applyShiftEdit(state, "s1", editable(510, 690))
    const request = buildRegenerationRequest(state, OPTIONS)
    expect(request.editedShifts).toEqual([{ shiftId: "s1", startMinute: 510, endMinute: 690 }])
  })
})

describe("requête de régénération — options de la modale", () => {
  it("recopie fidèlement les trois cases", () => {
    const request = buildRegenerationRequest(EMPTY_EDIT_STATE, {
      preserveLockedShifts: false,
      preserveManualEdits: true,
      minimizeOtherChanges: true,
    })
    expect(request.preserveLockedShifts).toBe(false)
    expect(request.preserveManualEdits).toBe(true)
    expect(request.minimizeOtherChanges).toBe(true)
  })

  it("propose des valeurs par défaut cohérentes avec la modale", () => {
    expect(DEFAULT_REGENERATION_OPTIONS).toEqual({
      preserveLockedShifts: true,
      preserveManualEdits: true,
      minimizeOtherChanges: false,
    })
  })
})

describe("requête de régénération — reset", () => {
  it("supprime verrous et edits", () => {
    let state = setShiftLock(EMPTY_EDIT_STATE, "s1", true)
    state = applyShiftEdit(state, "s2", editable(600, 780))
    const request = buildRegenerationRequest(resetShiftEdits(), OPTIONS)
    expect(request.lockedShiftIds).toEqual([])
    expect(request.editedShifts).toEqual([])
    expect(summarizeLocalWork(resetShiftEdits()).isEmpty).toBe(true)
  })
})

describe("contrat de régénération — indépendant des moteurs", () => {
  it("n'importe aucun moteur V2, V3 ou CP-SAT", () => {
    // The whole point of the contract is neutrality: it must be buildable and
    // shippable to a future backend without dragging a solver into the bundle.
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "model", "regeneration-request.ts"),
      "utf8"
    )
    const imports = source.match(/from\s+["'][^"']+["']/g) ?? []
    const forbidden = imports.filter((line) =>
      /planning-generator|planning-v3|cp-?sat|solver|\/flow|\/engine/i.test(line)
    )
    expect(forbidden).toEqual([])
  })
})
