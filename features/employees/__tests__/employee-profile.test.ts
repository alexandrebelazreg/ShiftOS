import { describe, expect, it } from "vitest"

import { employeeService, normalizeContract } from "@/features/employees/services/employee.service"
import { employeeToFormValues } from "@/features/employees/utils/employee.mappers"

describe("profil employé", () => {
  it("crée puis met à jour le profil utilisé par la page dédiée", async () => {
    const created = await employeeService.create({ firstName: "Lina", lastName: "Durand", phone: "", email: "", status: "active", weeklyHours: 24, contractType: "part_time", sectors: ["Caisse"], competencies: { Caisse: ["Encaissement"] }, canOpen: true, canClose: false, splitShiftAllowed: false, fixedDaysOff: ["sunday"], forbiddenDays: [], maxOpenings: null, maxClosings: 0, preferOpening: false, preferClosing: true, notes: "" })
    const updated = await employeeService.update(created.id, { ...created, sectors: ["Caisse", "Accueil"], competencies: { Caisse: ["Encaissement"], Accueil: ["Accueil client"] }, weeklyHours: 28 })
    expect(updated.sectors).toEqual(["Caisse", "Accueil"])
    expect(updated.competencies).toEqual({ Caisse: ["Encaissement"], Accueil: ["Accueil client"] })
    expect(updated.workingDays).not.toContain("sunday")
    expect((await employeeService.getById(created.id))?.weeklyHours).toBe(28)
    expect((await employeeService.getById(created.id))?.preferClosing).toBe(true)
    expect((await employeeService.getById(created.id))?.maxClosings).toBe(0)
    expect(created.scheduleType).toBe("variable")
    expect((await employeeService.setScheduleType(created.id, "fixed")).scheduleType).toBe("fixed")
  })
  it("normalise 36 h 45 en 2 205 minutes entières", async () => {
    const created = await employeeService.create({ firstName: "Minute", lastName: "Exacte", phone: "", email: "", status: "active", weeklyHours: 36.75, contractType: "full_time", sectors: [], competencies: {}, canOpen: false, canClose: false, splitShiftAllowed: false, fixedDaysOff: [], forbiddenDays: [], maxOpenings: null, maxClosings: null, preferOpening: false, preferClosing: false, notes: "" })
    expect(created.weeklyMinutes).toBe(2_205)
    expect(created.weeklyHours).toBe(36.75)
  })
  it("normalise un nouveau 36 h 30 en 2 190 minutes sans règle legacy globale", async () => {
    const created = await employeeService.create({ firstName: "Trente", lastName: "Minutes", phone: "", email: "", status: "active", weeklyHours: 36.5, contractType: "full_time", sectors: [], competencies: {}, canOpen: false, canClose: false, splitShiftAllowed: false, fixedDaysOff: [], forbiddenDays: [], maxOpenings: null, maxClosings: null, preferOpening: false, preferClosing: false, notes: "" })
    expect(created.weeklyMinutes).toBe(2_190)
    expect(created.schemaVersion).toBe(2)
  })
  it("réaffiche les heures du contrat en heures, pas en minutes", async () => {
    const created = await employeeService.create({ firstName: "Retour", lastName: "Formulaire", phone: "", email: "", status: "active", weeklyHours: 36.75, contractType: "full_time", sectors: [], competencies: {}, canOpen: false, canClose: false, splitShiftAllowed: false, fixedDaysOff: [], forbiddenDays: [], maxOpenings: null, maxClosings: null, preferOpening: false, preferClosing: false, notes: "" })
    const values = employeeToFormValues(created)
    expect(values.weeklyHours).toBe("36")
    expect(values.weeklyMinuteRemainder).toBe("45")
    expect(values.scheduleType).toBe("variable")
  })
  it("exige une confirmation pour un ancien 36.5 sans weeklyMinutes", async () => {
    const current = await employeeService.create({ firstName: "Legacy", lastName: "Pilote", phone: "", email: "", status: "active", weeklyHours: 36, contractType: "full_time", sectors: [], competencies: {}, canOpen: false, canClose: false, splitShiftAllowed: false, fixedDaysOff: [], forbiddenDays: [], maxOpenings: null, maxClosings: null, preferOpening: false, preferClosing: false, notes: "" })
    const legacy = normalizeContract({ ...current, schemaVersion: 1, weeklyHours: 36.5, weeklyMinutes: null })
    expect(legacy).toEqual(expect.objectContaining({ schemaVersion: 1, weeklyMinutes: null, contractMinuteConfirmationRequired: true }))
    const confirmed = await employeeService.update(current.id, { ...legacy, sectors: legacy.sectors ?? [], competencies: legacy.competencies ?? {}, weeklyMinutes: 2_205, weeklyHours: 36.75 })
    expect(confirmed).toEqual(expect.objectContaining({ schemaVersion: 2, weeklyMinutes: 2_205, weeklyHours: 36.75, contractMinuteConfirmationRequired: false }))
  })
})
