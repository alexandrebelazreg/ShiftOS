import { describe, expect, it } from "vitest"

import type { AbsenceRecord } from "@/features/absences/types/absence-record"
import type {
  PaidLeaveCampaign,
  PaidLeaveValidatedSnapshot,
} from "@/features/paid-leave/models/paid-leave-campaign"
import { assign, toggleRest } from "@/features/permanence/domain/permanence-edits"
import { paidLeaveByWeek } from "@/features/permanence/domain/permanence-leave"
import {
  emptyPermanenceMonth,
  permanenceSlotKey,
  type PermanenceMonth,
} from "@/features/permanence/models/permanence-month"

const blank = emptyPermanenceMonth(2026, 1, "2026-01-01T00:00:00.000Z")

const withClosing = (employeeId: string): PermanenceMonth => ({
  ...blank,
  assignments: { [permanenceSlotKey("2026-01-05", "closing")]: employeeId },
})

describe("poser un repos", () => {
  it("retire la permanence que la personne tenait le même jour", () => {
    // On ne peut pas fermer le magasin et être en repos : le récapitulatif
    // compterait sinon une fermeture faite par quelqu'un qui n'était pas là.
    const next = toggleRest(withClosing("a"), "2026-01-05", "a")

    expect(next.rest["2026-01-05"]).toEqual(["a"])
    expect(next.assignments[permanenceSlotKey("2026-01-05", "closing")]).toBeUndefined()
  })

  it("retire aussi l’ouverture, pas seulement la fermeture", () => {
    const month: PermanenceMonth = {
      ...blank,
      assignments: {
        [permanenceSlotKey("2026-01-05", "opening")]: "a",
        [permanenceSlotKey("2026-01-05", "closing")]: "b",
      },
    }
    const next = toggleRest(month, "2026-01-05", "a")

    expect(next.assignments[permanenceSlotKey("2026-01-05", "opening")]).toBeUndefined()
    // Celle de quelqu'un d'autre ne bouge pas : c'est SON repos, pas celui du jour.
    expect(next.assignments[permanenceSlotKey("2026-01-05", "closing")]).toBe("b")
  })

  it("ne touche pas aux permanences des autres jours", () => {
    const month: PermanenceMonth = {
      ...blank,
      assignments: {
        [permanenceSlotKey("2026-01-05", "closing")]: "a",
        [permanenceSlotKey("2026-01-06", "closing")]: "a",
      },
    }
    const next = toggleRest(month, "2026-01-05", "a")

    expect(next.assignments[permanenceSlotKey("2026-01-06", "closing")]).toBe("a")
  })

  it("retire un repos déjà posé, sans rendre la permanence", () => {
    const rested = toggleRest(withClosing("a"), "2026-01-05", "a")
    const undone = toggleRest(rested, "2026-01-05", "a")

    expect(undone.rest["2026-01-05"]).toBeUndefined()
    // La case libérée reste libre : c'est au gérant de dire qui la reprend.
    expect(undone.assignments[permanenceSlotKey("2026-01-05", "closing")]).toBeUndefined()
  })

  it("garde les autres personnes en repos ce jour-là", () => {
    const first = toggleRest(blank, "2026-01-05", "a")
    const second = toggleRest(first, "2026-01-05", "b")

    expect(second.rest["2026-01-05"]).toEqual(["a", "b"])
    expect(toggleRest(second, "2026-01-05", "a").rest["2026-01-05"]).toEqual(["b"])
  })
})

describe("affecter une case", () => {
  it("retire le repos de la personne le même jour — la règle vaut dans les deux sens", () => {
    const rested = toggleRest(blank, "2026-01-05", "a")
    const next = assign(rested, "2026-01-05", "closing", "a")

    expect(next.assignments[permanenceSlotKey("2026-01-05", "closing")]).toBe("a")
    expect(next.rest["2026-01-05"]).toBeUndefined()
  })

  it("laisse en repos les autres personnes de la journée", () => {
    const rested = toggleRest(toggleRest(blank, "2026-01-05", "a"), "2026-01-05", "b")
    const next = assign(rested, "2026-01-05", "closing", "a")

    expect(next.rest["2026-01-05"]).toEqual(["b"])
  })

  it("vide une case sans toucher aux repos", () => {
    const rested = toggleRest(withClosing("b"), "2026-01-05", "a")
    const next = assign(rested, "2026-01-05", "closing", null)

    expect(next.assignments).toEqual({})
    expect(next.rest["2026-01-05"]).toEqual(["a"])
  })
})

describe("les congés, lus depuis les campagnes et les absences", () => {
  const campaign = (patch: Partial<PaidLeaveCampaign>): PaidLeaveCampaign =>
    ({ status: "validated", validatedSnapshot: null, ...patch }) as PaidLeaveCampaign

  const absence = (start: string, end: string, type = "paid_leave"): AbsenceRecord => ({
    id: `${start}-${end}`,
    employeeId: "alexandre",
    type,
    start,
    end,
  })

  it("range les bénéficiaires par semaine", () => {
    const weeks = paidLeaveByWeek([
      campaign({
        validatedSnapshot: {
          validatedAt: "2026-01-01T00:00:00.000Z",
          grants: { a: ["2026-W29", "2026-W30"], b: ["2026-W30"] },
          reinforcementAllocations: [],
          fullFirstChoiceEmployeeIds: [],
        },
      }),
    ])

    expect(weeks.get("2026-W29")).toEqual(["a"])
    expect(weeks.get("2026-W30")).toEqual(["a", "b"])
  })

  it("ignore une campagne encore en arbitrage — une hypothèse n’écarte personne", () => {
    const weeks = paidLeaveByWeek([
      campaign({ status: "editing", grants: { a: ["2026-W29"] } } as Partial<PaidLeaveCampaign>),
    ])

    expect(weeks.size).toBe(0)
  })

  it("retient aussi une absence saisie au motif « congés payés »", () => {
    // Le défaut signalé : la semaine posée dans l'écran des absences retirait
    // bien la personne du tour, mais laissait sa case CP vide — la feuille ne
    // disait donc pas POURQUOI elle n'apparaissait nulle part.
    const weeks = paidLeaveByWeek([], [absence("2026-01-05", "2026-01-09")])

    expect(weeks.get("2026-W02")).toEqual(["alexandre"])
  })

  it("remplit toutes les semaines qu’une absence traverse", () => {
    const weeks = paidLeaveByWeek([], [absence("2026-01-08", "2026-01-13")])

    expect(weeks.get("2026-W02")).toEqual(["alexandre"])
    expect(weeks.get("2026-W03")).toEqual(["alexandre"])
  })

  it("ignore une absence qui n’est pas un congé payé", () => {
    // Un arrêt maladie retire bien quelqu'un du tour, mais la colonne s'appelle
    // « CP » et l'y écrire dirait une chose fausse à toute l'équipe.
    expect(paidLeaveByWeek([], [absence("2026-01-05", "2026-01-09", "sick_leave")]).size).toBe(0)
  })

  it("ignore une absence annulée", () => {
    const cancelled = { ...absence("2026-01-05", "2026-01-09"), status: "cancelled" as const }

    expect(paidLeaveByWeek([], [cancelled]).size).toBe(0)
  })

  it("n’écrit qu’une fois quelqu’un qu’une campagne et une absence couvrent", () => {
    const weeks = paidLeaveByWeek(
      [
        campaign({
          validatedSnapshot: {
            validatedAt: "2026-01-01T00:00:00.000Z",
            grants: { alexandre: ["2026-W02"] },
            reinforcementAllocations: [],
            fullFirstChoiceEmployeeIds: [],
          },
        }),
      ],
      [absence("2026-01-05", "2026-01-09")]
    )

    expect(weeks.get("2026-W02")).toEqual(["alexandre"])
  })

  it("n’écrit pas deux fois quelqu’un que deux campagnes couvrent", () => {
    const snapshot: PaidLeaveValidatedSnapshot = {
      validatedAt: "2026-01-01T00:00:00.000Z",
      grants: { a: ["2026-W44"] },
      reinforcementAllocations: [],
      fullFirstChoiceEmployeeIds: [],
    }
    const weeks = paidLeaveByWeek([
      campaign({ validatedSnapshot: snapshot }),
      campaign({ validatedSnapshot: snapshot }),
    ])

    expect(weeks.get("2026-W44")).toEqual(["a"])
  })
})
