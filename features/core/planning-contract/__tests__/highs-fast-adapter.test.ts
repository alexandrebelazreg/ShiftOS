import { describe, expect, it } from "vitest"

import {
  HIGHS_FAST_PROTOCOL_VERSION,
  createHighsFastAdapter,
  parseHighsFastResponse,
} from "@/features/core/planning-contract/adapters/highs-fast"
import type { CpSatRunner } from "@/features/core/planning-contract/adapters/python/run-python"
import type { SolvePlanningRequest } from "@/features/core/planning-contract/types/solve-request"
import { buildAccueilCanonicalProblem } from "@/features/core/planning-v3/__tests__/accueil-canonical"

/**
 * The `v3-highs-fast` adapter, without Python.
 *
 * Every failure mode of a subprocess boundary is reachable through a fake
 * runner, and none of them needs an interpreter — which is what lets these run
 * on a machine that has never installed scipy. The one thing a fake cannot
 * prove is that the real script answers in this protocol; that is the job of
 * the end-to-end check, which skips when Python is absent.
 *
 * What every case below asserts is the same property in different clothes: a
 * transport that failed has said NOTHING about the week. Not "impossible", not
 * "empty schedule" — nothing. An engine that turns its own outage into a
 * business verdict tells a manager their shop cannot open because a pipe broke.
 */

const problem = buildAccueilCanonicalProblem()

function request(): SolvePlanningRequest {
  // A first generation: nothing local to preserve yet, so `regeneration` is
  // absent rather than empty.
  return { problem }
}

function runnerReturning(stdout: string): CpSatRunner {
  return async () => ({ kind: "success", stdout, stderr: "", durationMs: 1 }) as never
}

function envelope(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    protocolVersion: HIGHS_FAST_PROTOCOL_VERSION,
    requestId: "test",
    status: "no-solution",
    assignments: [],
    diagnostics: { engineStatus: "timeout-without-solution", totalSeconds: 1 },
    environment: { python: "3.13.0" },
    error: null,
    ...overrides,
  })
}

describe("adaptateur v3-highs-fast — protocole", () => {
  it("refuse une sortie vide", () => {
    const parsed = parseHighsFastResponse("   ")
    expect(parsed.ok).toBe(false)
    expect(parsed.ok === false && parsed.code).toBe("empty-output")
  })

  it("refuse une sortie qui n'est pas du JSON", () => {
    const parsed = parseHighsFastResponse("Traceback (most recent call last):")
    expect(parsed.ok === false && parsed.code).toBe("output-not-json")
  })

  it("refuse un protocole différent de celui demandé", () => {
    // Un processus qui répond dans un protocole que nous n'avons pas demandé
    // n'est pas forcément le programme que nous croyons avoir lancé.
    const parsed = parseHighsFastResponse(
      JSON.stringify({ protocolVersion: "planning-v3-cpsat/1", status: "solved", assignments: [] })
    )
    expect(parsed.ok === false && parsed.code).toBe("protocol-version-mismatch")
  })

  it("refuse un statut hors vocabulaire", () => {
    const parsed = parseHighsFastResponse(envelope({ status: "presque" }))
    expect(parsed.ok === false && parsed.code).toBe("unknown-status")
  })

  it("refuse un `solved` sans aucune affectation", () => {
    // Une semaine vide présentée comme une génération réussie est la pire
    // sortie possible : elle passe tous les contrôles de forme et ne place
    // personne.
    const parsed = parseHighsFastResponse(envelope({ status: "solved", assignments: [] }))
    expect(parsed.ok === false && parsed.code).toBe("solved-without-assignments")
  })

  it("accepte une enveloppe conforme", () => {
    const parsed = parseHighsFastResponse(envelope())
    expect(parsed.ok).toBe(true)
  })
})

describe("adaptateur v3-highs-fast — pannes de transport", () => {
  it("rapporte un interpréteur manquant comme panne, jamais comme infaisabilité", async () => {
    const adapter = createHighsFastAdapter({
      runner: (async () => ({
        kind: "failure",
        code: "python-not-found",
        message: "spawn python ENOENT",
      })) as never,
    })
    const response = await adapter(request())

    expect(response.outcome).toBe("backend-error")
    expect(response.solution).toBeNull()
    // Le point non négociable : une panne de transport ne devient jamais un
    // verdict métier.
    expect(response.outcome).not.toBe("infeasible")
  })

  it("rapporte un processus qui plante comme panne", async () => {
    const adapter = createHighsFastAdapter({
      runner: (async () => {
        throw new Error("le tube est cassé")
      }) as never,
    })
    const response = await adapter(request())
    expect(response.outcome).toBe("backend-error")
  })

  it("rapporte une sortie illisible comme panne", async () => {
    const adapter = createHighsFastAdapter({ runner: runnerReturning("ceci n'est pas du JSON") })
    const response = await adapter(request())
    expect(response.outcome).toBe("backend-error")
  })

  it("rapporte une erreur structurée du moteur comme panne", async () => {
    const adapter = createHighsFastAdapter({
      runner: runnerReturning(
        envelope({ status: "error", error: { code: "highs-missing", message: "scipy absent" } })
      ),
    })
    const response = await adapter(request())
    expect(response.outcome).toBe("backend-error")
  })

  it("annule avant de lancer quoi que ce soit", async () => {
    let spawned = false
    const adapter = createHighsFastAdapter({
      signal: { aborted: true },
      runner: (async () => {
        spawned = true
        return { kind: "success", stdout: envelope(), stderr: "", durationMs: 1 }
      }) as never,
    })
    const response = await adapter(request())
    expect(spawned).toBe(false)
    expect(response.outcome).toBe("backend-error")
  })
})

describe("adaptateur v3-highs-fast — verdicts du moteur", () => {
  it("nomme le rayon et la date lorsqu'un rôle obligatoire n'a aucun salarié", async () => {
    const response = await createHighsFastAdapter({
      runner: runnerReturning(
        envelope({
          status: "infeasible",
          diagnostics: {
            engineStatus: "infeasible-proven",
            reason: "sector-role-cannot-be-staffed",
            infeasibleSectorRoles: [{
              sectorName: "Poisson",
              date: "2026-07-29",
              opensAtMinutes: 420,
              closesAtMinutes: 720,
              requiredOpeners: 1,
              openingCandidateCount: 0,
              requiredClosers: 1,
              closingCandidateCount: 0,
              assignedEmployeeNames: ["Aurélie Lemeltiez"],
            }],
            totalSeconds: 0.001,
          },
        })
      ),
    })(request())

    expect(response.outcome).toBe("infeasible")
    expect(response.diagnostics.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "sector-role-cannot-be-staffed",
        message: expect.stringContaining("29/07/2026 — Poisson"),
      }),
    ]))
    expect(response.diagnostics.entries[0]?.message).toContain("Aurélie Lemeltiez")
    expect(response.diagnostics.entries[0]?.message).toContain("1 ouvreur à 07:00")
    expect(response.diagnostics.entries[0]?.message).toContain("1 fermeur à 12:00")
  })

  /**
   * Un salarié seul ne peut pas tenir les deux bouts — et il faut dire QUELLE
   * règle refuse.
   *
   * Le message annonçait « une limite continue de 8 h » quelle que soit la
   * règle qui mordait, parce qu'il affichait le minimum entre le plafond
   * quotidien et le plafond continu sous une seule étiquette. Sur un rayon
   * ouvert 11 h avec une coupure maximale d'1 h 30, c'est le plafond QUOTIDIEN
   * qui refuse : allonger la coupure autorisée débloque la journée, augmenter
   * le plafond quotidien seul ne la débloque pas. Vérifié sur le moteur.
   */
  const jointRoleConflict = (soloRoleBlock?: Record<string, unknown>) =>
    createHighsFastAdapter({
      runner: runnerReturning(
        envelope({
          status: "infeasible",
          diagnostics: {
            engineStatus: "infeasible-proven",
            reason: "sector-role-cannot-be-staffed",
            infeasibleSectorRoles: [{
              sectorName: "Poisson",
              date: "2026-07-31",
              opensAtMinutes: 420,
              closesAtMinutes: 1080,
              requiredOpeners: 1,
              openingCandidateCount: 1,
              requiredClosers: 1,
              closingCandidateCount: 1,
              jointRoleConflict: true,
              openingClosingSpanMinutes: 660,
              maximumSingleSpanMinutes: 480,
              assignedEmployeeNames: ["Aurélie Lemeltiez"],
              ...(soloRoleBlock ? { soloRoleBlock } : {}),
            }],
            totalSeconds: 0.001,
          },
        })
      ),
    })(request())

  /**
   * D'où vient le plafond quotidien.
   *
   * `dailyCapMinutes` est le minimum entre le contrat du salarié, sa journée du
   * jour (réglages magasin et fenêtre de disponibilité) et la règle commune de
   * la zone. Trois réglages, trois écrans : afficher « au-dessus du plafond de
   * 8 h » sans dire lequel oblige à chercher dans les trois.
   */
  it.each([
    ["contract", "fixé par le contrat de Aurélie Lemeltiez", "portez le maximum journalier du contrat de Aurélie Lemeltiez à 9 h 30"],
    // Le cas qui a coûté un aller-retour : le gérant avait bien réglé le
    // MAGASIN à 10 h, et c'était un RAYON qui plafonnait à 8 h.
    ["sector", "fixé par la durée maximale par jour de l'un de ses rayons", "portez la durée maximale par jour du rayon à 9 h 30"],
    ["settings", "fixé par les réglages de cette génération", "portez la durée maximale d'une journée de cette génération à 9 h 30"],
    ["store", "fixé par la configuration du magasin", "portez la durée maximale d'une journée du magasin à 9 h 30"],
    ["window", "imposé par sa fenêtre de disponibilité ce jour-là", null],
    ["zone", "fixé par la règle commune des rayons sélectionnés", null],
  ])("attribue le plafond quotidien à sa source (%s)", async (source, origin, remedy) => {
    const response = await jointRoleConflict({
      employeeName: "Aurélie Lemeltiez",
      soloWorkedMinutes: 570,
      dailyCapMinutes: 480,
      dailyCapSource: source,
      continuousCapMinutes: 480,
      splitAllowed: true,
      maximumSplitMinutes: 90,
      requiredSplitMinutes: 180,
    })
    const message = response.diagnostics.entries[0]?.message ?? ""

    expect(message).toContain(`au-dessus du plafond de 8 h ${origin}`)
    if (remedy) expect(message).toContain(remedy)
  })

  it("affiche les trois plafonds en clair quand ils divergent", async () => {
    // Quatre allers-retours perdus parce que le lecteur corrigeait un réglage
    // et retombait sur le même refus : afficher les nombres retire la dernière
    // chose à deviner.
    const response = await jointRoleConflict({
      employeeName: "Aurélie Lemeltiez",
      soloWorkedMinutes: 570,
      dailyCapMinutes: 480,
      dailyCapSource: "store",
      contractCapMinutes: 600,
      dayCapMinutes: 480,
      zoneCapMinutes: 600,
      continuousCapMinutes: 480,
      splitAllowed: true,
      maximumSplitMinutes: 90,
      requiredSplitMinutes: 180,
    })
    const message = response.diagnostics.entries[0]?.message ?? ""

    expect(message).toContain("(contrat 10 h, journée 8 h, règle commune 10 h)")
  })

  it("n'encombre pas le message quand les trois plafonds concordent", async () => {
    const response = await jointRoleConflict({
      employeeName: "Aurélie Lemeltiez",
      soloWorkedMinutes: 570,
      dailyCapMinutes: 480,
      dailyCapSource: "store",
      contractCapMinutes: 480,
      dayCapMinutes: 480,
      zoneCapMinutes: 480,
      continuousCapMinutes: 480,
      splitAllowed: true,
      maximumSplitMinutes: 90,
      requiredSplitMinutes: 180,
    })

    expect(response.diagnostics.entries[0]?.message).not.toContain("contrat 8 h")
  })

  it("désigne la coupure maximale, et non la limite continue, quand c'est elle qui bloque", async () => {
    const response = await jointRoleConflict({
      employeeName: "Aurélie Lemeltiez",
      soloWorkedMinutes: 570,
      dailyCapMinutes: 480,
      dailyCapSource: "contract",
      continuousCapMinutes: 480,
      splitAllowed: true,
      maximumSplitMinutes: 90,
      requiredSplitMinutes: 180,
    })
    const message = response.diagnostics.entries[0]?.message ?? ""

    expect(message).toContain("31/07/2026 — Poisson")
    expect(message).toContain("ne peuvent pas être tenues par la même personne")
    expect(message).toContain("coupure maximale de 1 h 30")
    expect(message).toContain("9 h 30 de travail")
    expect(message).toContain("plafond de 8 h")
    expect(message).toContain("portez la coupure maximale du rayon à au moins 3 h")
    expect(message).toContain("Aurélie Lemeltiez")
    // La phrase que produisait la concaténation précédente : « il faut
    // l'ouverture à 07:00 (…) doivent être réparties ».
    expect(message).not.toContain("il faut l'ouverture")
    expect(message).not.toContain("limite continue")
  })

  it("propose d'autoriser la coupure sur le rayon quand c'est lui qui l'interdit", async () => {
    const response = await jointRoleConflict({
      employeeName: "Aurélie Lemeltiez",
      soloWorkedMinutes: 660,
      dailyCapMinutes: 480,
      continuousCapMinutes: 480,
      splitAllowed: false,
      sectorSplitAllowed: false,
      employeeMaySplit: true,
      maximumSplitMinutes: null,
      requiredSplitMinutes: null,
    })
    const message = response.diagnostics.entries[0]?.message ?? ""

    expect(message).toContain("11 h d'affilée")
    expect(message).toContain("autorisez la coupure sur ce rayon")
    expect(message).not.toContain("coupure maximale de")
  })

  it("vise le salarié, et non le rayon, quand c'est sa capacité qui manque", async () => {
    const response = await jointRoleConflict({
      employeeName: "Aurélie Lemeltiez",
      soloWorkedMinutes: 660,
      dailyCapMinutes: 480,
      continuousCapMinutes: 480,
      splitAllowed: false,
      sectorSplitAllowed: true,
      employeeMaySplit: false,
      maximumSplitMinutes: null,
      requiredSplitMinutes: null,
    })
    const message = response.diagnostics.entries[0]?.message ?? ""

    expect(message).toContain("autorisez la coupure pour Aurélie Lemeltiez")
    expect(message).not.toContain("autorisez la coupure sur ce rayon")
  })

  it("reste lisible quand le moteur ne fournit aucun détail de blocage", async () => {
    const response = await jointRoleConflict()
    const message = response.diagnostics.entries[0]?.message ?? ""

    expect(message).toContain("Aucun candidat ne peut légalement cumuler les deux rôles sur 11 h")
    expect(message).not.toContain("il faut l'ouverture")
    expect(message).toContain("affectez un second salarié disponible ce jour-là")
    expect(message).toContain("fermez le rayon pour cette journée")
  })

  /**
   * Le verdict le plus fréquent du moteur n'avait aucun branchement : il
   * tombait dans le fourre-tout « sans détail exploitable supplémentaire »,
   * alors que le pipeline note en clair ce qui l'a arrêté.
   */
  const exhaustedSearch = (diagnostics: Record<string, unknown>) =>
    createHighsFastAdapter({
      runner: runnerReturning(
        envelope({
          status: "no-solution",
          diagnostics: {
            engineStatus: "timeout-without-solution",
            reason: "no-legal-schedule-in-the-explored-neighbourhood",
            totalSeconds: 60,
            ...diagnostics,
          },
        })
      ),
    })(request())

  it("nomme la journée fautive plutôt que de compter les refus", async () => {
    // « 25 placements refusés » n'est pas un diagnostic : le lecteur n'a aucun
    // moyen de savoir quelle journée a fait tomber le MILP de la semaine.
    const response = await exhaustedSearch({
      allocationsTested: 25,
      skeletonsPlaced: 25,
      placementsInfeasible: 25,
      daysWithoutPlacement: ["2026-08-04"],
    })
    const message = response.diagnostics.entries[0]?.message ?? ""

    expect(message).toContain("La journée du 04/08/2026 ne peut pas être servie")
    expect(message).toContain("ouvertures et fermetures obligatoires")
    expect(message).not.toContain("25 placements ont été refusés")
  })

  it("accorde au pluriel quand plusieurs journées sont fautives", async () => {
    const response = await exhaustedSearch({
      allocationsTested: 4,
      skeletonsPlaced: 4,
      placementsInfeasible: 4,
      daysWithoutPlacement: ["2026-08-04", "2026-08-06"],
    })

    expect(response.diagnostics.entries[0]?.message).toContain(
      "Les journées du 04/08/2026, du 06/08/2026 ne peuvent pas être servies"
    )
  })

  it("ne renvoie plus le message générique quand la recherche s'épuise", async () => {
    const response = await exhaustedSearch({ allocationsTested: 19, skeletonsPlaced: 19 })
    const message = response.diagnostics.entries[0]?.message ?? ""

    expect(message).not.toContain("sans détail exploitable")
    expect(message).toContain("PAS une preuve d'impossibilité")
    expect(message).toContain("19 répartitions essayées")
  })

  it("remonte la journée sans forme légale que le moteur a notée", async () => {
    const response = await exhaustedSearch({
      allocationsTested: 1,
      skeletonsPlaced: 0,
      notes: ["sk#0(sector-placement): 3 journée(s) sans forme légale"],
    })
    const message = response.diagnostics.entries[0]?.message ?? ""

    expect(message).toContain("n'admettent aucune forme d'horaire légale")
    expect(message).toContain("3 journée(s) sans forme légale")
  })

  it("distingue un placement refusé d'une recherche simplement trop courte", async () => {
    const refused = await exhaustedSearch({ allocationsTested: 4, skeletonsPlaced: 4, placementsInfeasible: 4 })
    const short = await exhaustedSearch({ allocationsTested: 1, skeletonsPlaced: 0 })

    expect(refused.diagnostics.entries[0]?.message).toContain("4 placements ont été refusés")
    expect(short.diagnostics.entries[0]?.message).toContain("aucun placement n'a pu être tenté")
  })

  it("nomme TOUS les comptoirs qui retiennent un candidat, pas seulement le premier", async () => {
    const response = await createHighsFastAdapter({
      runner: runnerReturning(
        envelope({
          status: "infeasible",
          diagnostics: {
            engineStatus: "infeasible-proven",
            reason: "sector-role-cannot-be-staffed",
            infeasibleSectorRoles: [{
              sectorName: "Charcuterie",
              date: "2026-08-04",
              opensAtMinutes: 390,
              closesAtMinutes: 1200,
              requiredOpeners: 1,
              openingCandidateCount: 1,
              requiredClosers: 1,
              closingCandidateCount: 1,
              jointRoleConflict: true,
              crossSectorConflict: true,
              openingClosingSpanMinutes: 810,
              assignedEmployeeNames: ["Aurélie Lemeltiez", "Daniel Dumange", "Jean Agostini"],
              heldElsewhere: [
                { employeeName: "Aurélie Lemeltiez", sectorName: "Poisson", startMinutes: 420, endMinutes: 720 },
                { employeeName: "Daniel Dumange", sectorName: "Fromage", startMinutes: 360, endMinutes: 540 },
              ],
            }],
            totalSeconds: 0.01,
          },
        })
      ),
    })(request())
    const message = response.diagnostics.entries[0]?.message ?? ""

    // Corriger un bloqueur et relancer pour retomber sur l'autre est
    // exactement ce que ce champ existe pour éviter.
    expect(message).toContain("Aurélie Lemeltiez tient déjà Poisson de 07:00 à 12:00")
    expect(message).toContain("Daniel Dumange tient déjà Fromage de 06:00 à 09:00")
    expect(message).toContain("04/08/2026 — Charcuterie")
  })

  it("explique une collision de rôles entre deux rayons", async () => {
    const response = await createHighsFastAdapter({
      runner: runnerReturning(
        envelope({
          status: "infeasible",
          diagnostics: {
            engineStatus: "infeasible-proven",
            reason: "sector-role-cannot-be-staffed",
            infeasibleSectorRoles: [{
              sectorName: "Charcuterie",
              date: "2026-07-29",
              opensAtMinutes: 480,
              closesAtMinutes: 1200,
              requiredOpeners: 1,
              openingCandidateCount: 1,
              requiredClosers: 1,
              closingCandidateCount: 1,
              jointRoleConflict: true,
              crossSectorConflict: true,
              openingClosingSpanMinutes: 720,
              maximumSingleSpanMinutes: 480,
              assignedEmployeeNames: ["Clara Goupil", "Daniel Dumange"],
              conflictingEmployeeName: "Daniel Dumange",
              conflictingSectorName: "Fromage",
              conflictingStartMinutes: 360,
              conflictingEndMinutes: 540,
            }],
            totalSeconds: 0.001,
          },
        })
      ),
    })(request())

    expect(response.diagnostics.entries[0]?.message).toContain("29/07/2026 — Charcuterie")
    expect(response.diagnostics.entries[0]?.message).toContain("Daniel Dumange tient déjà Fromage de 06:00 à 09:00")
    expect(response.diagnostics.entries[0]?.message).toContain("les salariés restants ne peuvent pas couvrir")
  })

  it("traduit une allocation impossible en explications métier", async () => {
    const response = await createHighsFastAdapter({
      runner: runnerReturning(
        envelope({
          status: "infeasible",
          diagnostics: {
            engineStatus: "infeasible-proven",
            reason: "no-minute-allocation-satisfies-contracts-and-budgets",
            allocationEmployeeConflicts: [{
              employeeId: "arthur",
              employeeName: "Arthur Martin",
              contractMinutes: 1800,
              minimumPossibleMinutes: 1440,
              maximumPossibleMinutes: 1680,
              availableDayCount: 6,
              reason: "contract-exceeds-available-capacity",
              differenceMinutes: 120,
            }],
            allocationDayConflicts: [{
              date: "2026-07-31",
              budgetMinutes: 780,
              minimumMandatoryMinutes: 960,
              maximumCapacityMinutes: 1920,
              availableEmployeeCount: 4,
              reason: "budget-below-mandatory-minimum",
              differenceMinutes: 180,
            }],
            totalSeconds: 0.01,
          },
        })
      ),
    })(request())

    expect(response.diagnostics.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "employee-volume-exceeds-available-capacity",
        message: expect.stringContaining("Arthur Martin reçoit 30 h"),
      }),
      expect.objectContaining({
        code: "daily-budget-below-mandatory-minimum",
        message: expect.stringContaining("le rayon prévoit 13 h"),
      }),
    ]))
    expect(JSON.stringify(response.diagnostics.entries)).not.toContain(
      "no-minute-allocation-satisfies-contracts-and-budgets"
    )
  })

  it("explique chaque journée structurellement impossible avec ses chiffres", async () => {
    const response = await createHighsFastAdapter({
      runner: runnerReturning(
        envelope({
          status: "infeasible",
          diagnostics: {
            engineStatus: "infeasible-proven",
            reason: "day-cannot-be-staffed",
            infeasibleDays: [
              {
                date: "2026-07-30",
                reason: "daily-budget-exceeds-workable-capacity",
                budgetMinutes: 2520,
                workableCapacityMinutes: 2190,
                missingMinutes: 330,
                availableEmployeeCount: 4,
              },
              {
                date: "2026-07-31",
                reason: "hard-floor-exceeds-available-minutes",
                hardMinimumMinutes: 1080,
                availableWorkedMinutes: 960,
                missingMinutes: 120,
                peakHardMinimumEmployees: 3,
                peakHardMinimumStartMinutes: 720,
                peakHardMinimumEndMinutes: 735,
              },
            ],
            totalSeconds: 0.001,
          },
        })
      ),
    })(request())

    expect(response.outcome).toBe("infeasible")
    expect(response.diagnostics.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "daily-budget-exceeds-workable-capacity",
          message: expect.stringContaining(
            "30/07/2026 : le budget impose 42 h de travail"
          ),
        }),
        expect.objectContaining({
          code: "hard-floor-exceeds-available-minutes",
          message: expect.stringContaining(
            "Il manque 2 h. Le pic obligatoire est de 3 salariés entre 12:00 et 12:15."
          ),
        }),
      ])
    )
  })

  it("refuse explicitement les jours disponibles facultatifs", async () => {
    const response = await createHighsFastAdapter({
      runner: runnerReturning(
        envelope({
          status: "invalid-problem",
          diagnostics: {
            engineStatus: "invalid-problem",
            reason: "optional-work-days-not-supported",
            optionalCellCount: 2,
            totalSeconds: 0.001,
          },
        })
      ),
    })(request())

    expect(response.outcome).toBe("invalid-problem")
    expect(response.solution).toBeNull()
    expect(response.metadata.stopCause).toBe("not-started")
    expect(response.diagnostics.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "optional-work-days-not-supported",
          severity: "blocking",
        }),
      ])
    )
  })

  it("ne transforme pas un contrôle d'allocation interrompu en impossibilité", async () => {
    const response = await createHighsFastAdapter({
      runner: runnerReturning(
        envelope({
          status: "no-solution",
          diagnostics: {
            engineStatus: "timeout-without-solution",
            reason: "allocation-feasibility-probe-ended-without-proof",
            solverStatus: 1,
            totalSeconds: 5,
          },
        })
      ),
    })(request())

    expect(response.outcome).not.toBe("infeasible")
    expect(response.metadata.stopCause).toBe("timeout")
    expect(response.diagnostics.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "allocation-feasibility-probe-ended-without-proof",
          severity: "blocking",
        }),
      ])
    )
  })

  it("distingue une impossibilité démontrée d'un voisinage épuisé", async () => {
    // La distinction que ce moteur existe pour tenir. `no-solution` dit « je
    // n'ai rien trouvé » ; seul `infeasible` dit « il n'y a rien à trouver », et
    // seulement quand le modèle de demande ou le MILP d'allocation l'a prouvé.
    const exhausted = await createHighsFastAdapter({
      runner: runnerReturning(envelope({ status: "no-solution" })),
    })(request())
    const proven = await createHighsFastAdapter({
      runner: runnerReturning(
        envelope({ status: "infeasible", diagnostics: { engineStatus: "infeasible-proven" } })
      ),
    })(request())

    expect(exhausted.outcome).not.toBe("infeasible")
    expect(proven.outcome).toBe("infeasible")
  })

  it("ne revendique jamais un optimum, quel que soit le résultat", async () => {
    // Deux choix heuristiques — quels squelettes classer, quelle allocation
    // chacun reçoit — précèdent la seule étape exacte. Aucun budget ne rend un
    // planning démontrable.
    const response = await createHighsFastAdapter({
      runner: runnerReturning(envelope({ status: "no-solution" })),
    })(request())
    expect(response.outcome).not.toBe("optimal")
  })

  it("annonce qu'il ne sait pas préserver, au lieu de déverrouiller en silence", async () => {
    const withLocks: SolvePlanningRequest = {
      problem,
      regeneration: {
        preserveLockedShifts: true,
        preserveManualEdits: false,
        minimizeOtherChanges: false,
        lockedShiftIds: ["shift-1"],
        editedShifts: [],
      },
    }

    const response = await createHighsFastAdapter({
      runner: runnerReturning(envelope({ status: "no-solution" })),
    })(withLocks)

    // Un planning qui ignore un verrou n'est pas une moins bonne réponse :
    // c'est la réponse à une autre question. Le moteur ne sait pas épingler un
    // shift, et il doit le dire.
    expect(response.metadata.respectedLocks).toBe(false)
    expect(response.metadata.unmetPreservations).toContain("locks")
  })
})
