import { expect, it } from "vitest"

import type { AbsenceRecord } from "@/features/absences/types/absence-record"
import { campaignWeeks } from "@/features/paid-leave/calendar/campaign-weeks"
import { absentWeeksByEmployee } from "@/features/paid-leave/domain/already-absent"

/**
 * Semaines 30 à 33 de 2026 — du lundi 20 juillet au dimanche 16 août.
 * Les dates sont rappelées dans chaque cas, parce qu'un test de chevauchement
 * qu'on ne peut pas relire au calendrier ne se vérifie pas.
 */
const WEEKS = campaignWeeks(2026, { kind: "custom", startWeek: 30, endWeek: 33 })

function absence(entries: Partial<AbsenceRecord>): AbsenceRecord {
  return {
    id: "a1",
    employeeId: "alice",
    type: "sick_leave",
    start: "2026-07-20",
    end: "2026-07-26",
    ...entries,
  } as AbsenceRecord
}

it("bloque les semaines que l’absence recoupe, même partiellement", () => {
  // Du mercredi 22 au vendredi 24 juillet : la S30 n’est pas couverte en
  // entier, mais on ne peut pas y poser de congés pour autant.
  const blocked = absentWeeksByEmployee(
    [absence({ start: "2026-07-22", end: "2026-07-24" })],
    WEEKS
  )
  expect([...(blocked.get("alice") ?? [])]).toEqual(["2026-W30"])
})

it("bloque toutes les semaines d’une absence longue", () => {
  // Du 20 juillet au 9 août : trois semaines pleines.
  const blocked = absentWeeksByEmployee(
    [absence({ start: "2026-07-20", end: "2026-08-09" })],
    WEEKS
  )
  expect([...(blocked.get("alice") ?? [])].sort()).toEqual([
    "2026-W30",
    "2026-W31",
    "2026-W32",
  ])
})

it("ignore une absence hors de la période", () => {
  const blocked = absentWeeksByEmployee(
    [absence({ start: "2026-09-01", end: "2026-09-10" })],
    WEEKS
  )
  expect(blocked.size).toBe(0)
})

it("ignore une absence annulée", () => {
  const blocked = absentWeeksByEmployee(
    [absence({ status: "cancelled" })],
    WEEKS
  )
  expect(blocked.size).toBe(0)
})

it("traite une absence sans statut comme active", () => {
  // Les enregistrements antérieurs à l’annulation n’en portent pas. Les lire
  // comme annulés rouvrirait des semaines que quelqu’un passe à l’hôpital.
  const blocked = absentWeeksByEmployee([absence({})], WEEKS)
  expect([...(blocked.get("alice") ?? [])]).toEqual(["2026-W30"])
})

it("ignore les semaines issues de la campagne elle-même", () => {
  // LE PIÈGE. La campagne relit ses propres attributions validées sous forme
  // d’absences. Les retenir interdirait de la recalculer : chaque semaine déjà
  // accordée bloquerait sa propre réattribution, et la seconde exécution
  // rendrait une feuille vide.
  const blocked = absentWeeksByEmployee(
    [absence({ source: "paid_leave_campaign" })],
    WEEKS
  )
  expect(blocked.size).toBe(0)
})

it("ignore les jours fériés", () => {
  // Un férié est UN jour. Bloquer la semaine du 15 août parce que le 15 août
  // est férié retirerait à toute l’équipe la semaine la plus demandée.
  const blocked = absentWeeksByEmployee([absence({ source: "holiday" })], WEEKS)
  expect(blocked.size).toBe(0)
})

it("sépare les salariés", () => {
  const blocked = absentWeeksByEmployee(
    [
      absence({ id: "a1", employeeId: "alice", start: "2026-07-20", end: "2026-07-26" }),
      absence({ id: "a2", employeeId: "bob", start: "2026-08-03", end: "2026-08-09" }),
    ],
    WEEKS
  )
  expect([...(blocked.get("alice") ?? [])]).toEqual(["2026-W30"])
  expect([...(blocked.get("bob") ?? [])]).toEqual(["2026-W32"])
})
