import { describe, expect, it } from "vitest"

import {
  toRecord as absenceToRecord,
  toRow as absenceToRow,
  type AbsenceRow,
} from "@/features/absences/persistence/absence.supabase-repository"
import type { AbsenceRecord } from "@/features/absences/types/absence-record"
import {
  toRecord as planningToRecord,
  toRow as planningToRow,
  weekKeyOf,
  type PlanningRow,
} from "@/features/planning/persistence/planning.supabase-repository"
import type { PlanningRecord } from "@/features/planning/persistence/planning-record"
import type { EditorState } from "@/features/planning/editor"

/**
 * Les deux traversées qui restaient à prouver.
 *
 * Comme pour les fiches salariés, les tests d'aller-retour ne nomment aucun
 * champ : ils comparent l'objet entier. Une liste de champs à vérifier
 * oublierait exactement ceux que le découpage oublie.
 */

const absence: AbsenceRecord = {
  id: "abs-1",
  employeeId: "emp-1",
  type: "sick_leave",
  start: "2026-03-09",
  end: "2026-03-20",
  status: "active",
  recordedOn: "2026-03-09",
  note: "arrêt initial de 5 jours",
  proofDueOn: "2026-03-11",
  proofReceivedOn: "2026-03-10",
  extensions: [{ previousEnd: "2026-03-13", newEnd: "2026-03-20", recordedOn: "2026-03-12" }],
} as AbsenceRecord

const planning: PlanningRecord = {
  id: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
  status: "draft",
  label: "Semaine 34",
  periodStart: "2026-08-17",
  periodEnd: "2026-08-23",
  sectorIds: ["sector_a75d9085-39ce-40b5-8077-bf5cb9cfb5aa", "sector_b1"],
  state: { shifts: [], assignments: [] } as unknown as EditorState,
  createdAt: "2026-08-17T08:00:00.000Z",
  updatedAt: "2026-08-20T09:00:00.000Z",
  savedAt: "2026-08-20T09:00:00.000Z",
}

describe("absence ↔ ligne en base", () => {
  it("ne perd rien en traversant", () => {
    const row = absenceToRow(absence, "magasin-test")
    const relue = absenceToRecord({ ...row, id: absence.id } as unknown as AbsenceRow)
    expect(relue).toEqual(absence)
  })

  it("garde les prolongations, qui sont l'histoire de l'arrêt", () => {
    // Un arrêt de quinze jours et trois arrêts de cinq bout à bout ne se valent
    // ni pour la paie ni pour la prévoyance. Perdre les étapes rendrait les deux
    // indiscernables six mois plus tard.
    const row = absenceToRow(absence, "magasin-test")
    expect(row.detail).toHaveProperty("extensions")
    expect((row.detail.extensions as unknown[])).toHaveLength(1)
  })

  it("ne redit pas dans le blob ce qui est une colonne", () => {
    const row = absenceToRow(absence, "magasin-test")
    for (const promu of ["id", "employeeId", "type", "start", "end", "status", "recordedOn"]) {
      expect(row.detail).not.toHaveProperty(promu)
    }
  })
})

describe("planning ↔ ligne en base", () => {
  it("ne perd rien en traversant", () => {
    const row = planningToRow(planning, "magasin-test")
    const relu = planningToRecord({
      ...row,
      id: planning.id,
      created_at: planning.createdAt,
      updated_at: planning.updatedAt,
    } as unknown as PlanningRow)
    expect(relu).toEqual(planning)
  })

  it("accepte des identifiants de secteur préfixés", () => {
    // Ils valent `sector_<uuid>`, pas un uuid nu. La colonne était typée `uuid`
    // et aurait rejeté chaque sauvegarde, avec une erreur de type illisible.
    const row = planningToRow(planning, "magasin-test")
    expect(row.sector_ids).toEqual([
      "sector_a75d9085-39ce-40b5-8077-bf5cb9cfb5aa",
      "sector_b1",
    ])
  })

  it("ne date la publication que d'un planning publié", () => {
    expect(planningToRow(planning, "m")).not.toHaveProperty("published_at")
    expect(planningToRow({ ...planning, status: "published" }, "m")).toHaveProperty("published_at")
  })
})

describe("la semaine ISO", () => {
  it("nomme la semaine à laquelle un lundi appartient", () => {
    expect(weekKeyOf("2026-08-17")).toBe("2026-W34")
  })

  it("range une fin décembre dans l'année de son jeudi", () => {
    // Le 31 décembre 2025 est un mercredi : sa semaine ISO appartient à 2026,
    // parce que son jeudi tombe le 1er janvier. Compter sur l'année civile
    // aurait décalé d'un an les plannings de fin d'année.
    expect(weekKeyOf("2025-12-31")).toBe("2026-W01")
  })

  it("range un début janvier dans l'année de son jeudi", () => {
    // Le 1er janvier 2027 est un vendredi : sa semaine ISO reste 2026.
    expect(weekKeyOf("2027-01-01")).toBe("2026-W53")
  })
})
