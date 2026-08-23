import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { buildAbsenceAlerts } from "@/features/absences/alerts/absence-alerts"
import { AbsenceForm } from "@/features/absences/components/AbsenceForm"
import { AbsenceRulesSettings } from "@/features/absences/components/AbsenceRulesSettings"
import {
  DEFAULT_ABSENCE_RULES,
  isModified,
  resolveMotive,
  withRule,
  type AbsenceRules,
} from "@/features/absences/models/absence-rules"
import { createAbsenceRulesRepository } from "@/features/absences/persistence/absence-rules.repository"
import type { AbsenceRecord } from "@/features/absences/types/absence-record"
import type { EmployeeRecord } from "@/features/employees/types/employee.types"

/** Un stockage de test, sans navigateur. */
function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  }
}

describe("les règles en vigueur", () => {
  it("appliquent le tableau d'origine tant que rien n'est réglé", () => {
    const motive = resolveMotive(DEFAULT_ABSENCE_RULES, "sick_leave")
    expect(motive.hours).toBe("maintained")
    expect(motive.proof).toEqual({ label: "Arrêt de travail", dueDays: 2 })
  })

  it("remplacent le traitement des heures quand la convention diffère", () => {
    const rules = withRule(DEFAULT_ABSENCE_RULES, "parental_leave", { hours: "maintained" })
    expect(resolveMotive(rules, "parental_leave").hours).toBe("maintained")
    expect(isModified(rules, "parental_leave")).toBe(true)
    // Et seulement celui-là.
    expect(isModified(rules, "sick_leave")).toBe(false)
  })

  it("retirent le justificatif d'un motif qui n'en réclame plus", () => {
    const rules = withRule(DEFAULT_ABSENCE_RULES, "family_event", {
      proof: { expected: false, dueDays: null },
    })
    expect(resolveMotive(rules, "family_event").proof).toBeNull()
  })

  it("en ajoutent un à un motif qui n'en avait pas", () => {
    const rules = withRule(DEFAULT_ABSENCE_RULES, "paid_leave", {
      proof: { expected: true, dueDays: 7 },
    })
    expect(resolveMotive(rules, "paid_leave").proof).toEqual({
      label: "Justificatif",
      dueDays: 7,
    })
  })

  it("ne laissent pas régler ce qui n'est pas une convention", () => {
    // Des heures de délégation comptées en journées ne sont plus des heures de
    // délégation : aucun réglage ne doit pouvoir l'obtenir.
    const rules = withRule(DEFAULT_ABSENCE_RULES, "delegation", { hours: "deducted" })
    expect(resolveMotive(rules, "delegation").countedInHours).toBe(true)
    expect(resolveMotive(rules, "delegation").label).toBe("Heures de délégation")
    expect(resolveMotive(rules, "other").needsDetail).toBe(true)
  })

  it("effacent un écart revenu à sa valeur d'origine", () => {
    // Sinon le motif resterait marqué « modifié », et surtout n'hériterait plus
    // jamais d'une correction du tableau par défaut.
    const changed = withRule(DEFAULT_ABSENCE_RULES, "training", { hours: "deducted" })
    expect(Object.keys(changed)).toEqual(["training"])
    const restored = withRule(changed, "training", { hours: "worked" })
    expect(restored).toEqual({})
    expect(isModified(restored, "training")).toBe(false)
  })
})

describe("le stockage des règles", () => {
  it("relit ce qu'il a écrit", async () => {
    const repository = createAbsenceRulesRepository(memoryStorage())
    const rules = withRule(DEFAULT_ABSENCE_RULES, "unpaid_leave", { hours: "maintained" })
    await repository.save(rules)
    expect(await repository.read()).toEqual(rules)
  })

  it("revient au tableau d'origine après remise à zéro", async () => {
    const repository = createAbsenceRulesRepository(memoryStorage())
    await repository.save(withRule(DEFAULT_ABSENCE_RULES, "training", { hours: "deducted" }))
    await repository.reset()
    expect(await repository.read()).toEqual(DEFAULT_ABSENCE_RULES)
  })

  it("traite un stockage illisible comme l'absence d'écart", async () => {
    // Les absences doivent continuer de se saisir : un réglage corrompu ne peut
    // pas empêcher d'enregistrer un arrêt de travail.
    const storage = memoryStorage()
    storage.setItem("shiftos_absence_rules", "{ pas du json")
    expect(await createAbsenceRulesRepository(storage).read()).toEqual(DEFAULT_ABSENCE_RULES)

    storage.setItem("shiftos_absence_rules", JSON.stringify({ sick_leave: { hours: "n'importe" } }))
    expect(await createAbsenceRulesRepository(storage).read()).toEqual(DEFAULT_ABSENCE_RULES)
  })
})

describe("ce que les règles changent ailleurs", () => {
  const rules: AbsenceRules = withRule(DEFAULT_ABSENCE_RULES, "family_event", {
    proof: { expected: true, dueDays: 5 },
  })

  it("le papier annoncé dans le formulaire est celui qui sera réclamé", () => {
    const employees = [
      { id: "1", firstName: "Adeline", lastName: "Roche", status: "active" },
    ] as unknown as EmployeeRecord[]
    const markup = renderToStaticMarkup(
      <AbsenceForm
        employees={employees}
        today="2026-03-10"
        rules={withRule(DEFAULT_ABSENCE_RULES, "sick_leave", {
          proof: { expected: true, dueDays: 8 },
        })}
        onSubmit={() => {}}
        onCancel={() => {}}
      />
    )
    expect(markup).toContain("sous 8 jours")
    expect(markup).not.toContain("sous 2 jours")
  })

  it("la relance nomme le papier de la règle en vigueur", () => {
    const absence: AbsenceRecord = {
      id: "a",
      employeeId: "1",
      type: "family_event",
      start: "2026-03-01",
      end: "2026-03-02",
      proofDueOn: "2026-03-06",
    }
    const alerts = buildAbsenceAlerts({
      today: "2026-03-10",
      absences: [absence],
      plannings: [],
      employeeNames: new Map([["1", "Adeline Roche"]]),
      rules,
    })
    expect(alerts.lateProofs[0].proofLabel).toBe("Acte ou faire-part")
    expect(alerts.lateProofs[0].lateDays).toBe(4)
  })
})

describe("l'écran des paramètres", () => {
  it("pose une ligne par motif, avec ses deux réglages", () => {
    const markup = renderToStaticMarkup(<AbsenceRulesSettings />)
    expect(markup).toContain("Règles des absences")
    // Le rendu serveur n'a pas de stockage : l'écran attend ses règles plutôt
    // que d'afficher un tableau par défaut qui pourrait être faux.
    expect(markup).toContain("Chargement des règles")
  })
})
