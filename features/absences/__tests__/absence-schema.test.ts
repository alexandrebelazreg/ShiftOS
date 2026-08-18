import { describe, expect, it } from "vitest"

import {
  absenceFormSchema,
  firstDayOfPreviousMonth,
} from "@/features/absences/schemas/absence.schema"

const TODAY = "2026-03-10"
const schema = absenceFormSchema(TODAY)

function values(overrides: Record<string, unknown> = {}) {
  return {
    employeeId: "1",
    type: "sick_leave",
    start: TODAY,
    end: TODAY,
    halfDay: "",
    hours: "",
    note: "",
    ...overrides,
  }
}

const issueOn = (result: ReturnType<typeof schema.safeParse>, field: string) =>
  result.success ? false : result.error.issues.some((issue) => issue.path[0] === field)

describe("la saisie d'une absence", () => {
  it("accepte l'absence du jour, dates pré-remplies", () => {
    const draft = schema.parse(values())
    expect(draft).toEqual({
      employeeId: "1",
      type: "sick_leave",
      start: TODAY,
      end: TODAY,
      halfDay: undefined,
      hours: undefined,
      note: undefined,
    })
  })

  it("refuse une fin antérieure au début", () => {
    expect(issueOn(schema.safeParse(values({ end: "2026-03-09" })), "end")).toBe(true)
  })

  it("réclame toujours une date de fin", () => {
    // Le papier la porte. Ce qu'on ignore, c'est le renouvellement — et il se
    // saisit plus tard, en repoussant cette date.
    expect(issueOn(schema.safeParse(values({ end: "" })), "end")).toBe(true)
  })
})

describe("la limite de saisie rétroactive", () => {
  it("laisse enregistrer un arrêt reçu en retard, dans le mois précédent", () => {
    expect(schema.safeParse(values({ start: "2026-02-01", end: "2026-02-05" })).success).toBe(true)
  })

  it("refuse au-delà, la paie étant passée", () => {
    const result = schema.safeParse(values({ start: "2026-01-31", end: "2026-02-02" }))
    expect(issueOn(result, "start")).toBe(true)
  })

  it("recule d'une année au passage de janvier", () => {
    expect(firstDayOfPreviousMonth("2026-01-14")).toBe("2025-12-01")
    expect(firstDayOfPreviousMonth("2026-03-10")).toBe("2026-02-01")
  })
})

describe("les heures de délégation", () => {
  it("réclament un nombre d'heures", () => {
    expect(issueOn(schema.safeParse(values({ type: "delegation" })), "hours")).toBe(true)
    expect(schema.parse(values({ type: "delegation", hours: "2,5" })).hours).toBe(2.5)
  })

  it("ne se prennent que sur une seule journée", () => {
    // « 3 h du 3 au 12 » ne dit pas de quel jour elles sortent.
    const result = schema.safeParse(
      values({ type: "delegation", hours: "2", start: "2026-03-09", end: "2026-03-12" })
    )
    expect(issueOn(result, "end")).toBe(true)
  })

  it("refusent une journée de plus de 24 h", () => {
    expect(issueOn(schema.safeParse(values({ type: "delegation", hours: "30" })), "hours")).toBe(true)
  })
})

describe("la demi-journée", () => {
  it("se saisit sur une journée unique", () => {
    expect(schema.parse(values({ halfDay: "afternoon" })).halfDay).toBe("afternoon")
  })

  it("se refuse sur une période", () => {
    const result = schema.safeParse(
      values({ halfDay: "morning", start: "2026-03-09", end: "2026-03-12" })
    )
    expect(issueOn(result, "halfDay")).toBe(true)
  })

  it("se refuse aussi quand la fin manque", () => {
    const result = schema.safeParse(values({ halfDay: "morning", end: "" }))
    expect(issueOn(result, "halfDay")).toBe(true)
  })
})

describe("le motif « Autre »", () => {
  it("exige sa précision", () => {
    expect(issueOn(schema.safeParse(values({ type: "other" })), "note")).toBe(true)
    expect(schema.parse(values({ type: "other", note: "Convocation tribunal" })).note).toBe(
      "Convocation tribunal"
    )
  })

  it("est le seul à l'exiger", () => {
    expect(schema.safeParse(values({ type: "sick_leave", note: "" })).success).toBe(true)
  })
})
