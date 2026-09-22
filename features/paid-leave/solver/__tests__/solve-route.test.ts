import { describe, expect, it, vi } from "vitest"

/**
 * La route ne CROIT plus le navigateur.
 *
 * Elle recevait une demande entièrement bâtie par le client et la passait au
 * solveur sans la relire : minimums de couverture, plafonds d'effectif, soldes,
 * cibles, tout venait de là. Le schéma Zod en vérifiait la FORME et rien
 * d'autre, si bien qu'une requête forgée à la main — tous les minimums à zéro,
 * tous les plafonds à `null` — était parfaitement valide, et que le résultat
 * revenait ensuite s'enregistrer dans la campagne.
 *
 * Ce n'est pas un défaut d'isolation : les politiques de la base empêchent
 * toujours de lire chez le voisin. C'est un défaut d'INTÉGRITÉ, et il vise ce
 * qui fait la valeur du produit. Un outil dont on désactive les contraintes
 * depuis la console ne prouve rien à personne.
 *
 * Le test central est donc celui-ci : ce que Python reçoit vient de la base, et
 * de rien d'autre.
 */

const doubles = vi.hoisted(() => ({
  session: { userId: "u", storeId: "s", role: "manager", email: "a@b.c", fullName: null } as unknown,
  configured: true,
  loaded: null as unknown,
  /** Ce que Python a réellement reçu, et qui est tout le sujet. */
  sent: null as string | null,
  /** Le temps imparti que la route a transmis au chargement. */
  loadedWith: null as number | null,
}))

vi.mock("@/features/auth/dal", () => ({
  currentSession: async () => doubles.session,
}))

vi.mock("@/features/auth/supabase/config", () => ({
  supabaseConfigured: () => doubles.configured,
}))

vi.mock("@/features/paid-leave/solver/load-solve-request", () => ({
  loadPaidLeaveSolveRequest: async (_id: string, timeoutSeconds: number) => {
    doubles.loadedWith = timeoutSeconds
    return doubles.loaded
  },
}))

vi.mock("@/features/core/planning-contract/adapters/python/run-python", () => ({
  resolveHighsFastPython: () => "python",
  createPythonRunner: () => async (payload: string) => {
    doubles.sent = payload
    return {
      kind: "stdout" as const,
      stdout: JSON.stringify({
        status: "optimal",
        grants: {},
        reinforcementAllocations: [],
        objectiveValues: {},
        durationMs: 12,
      }),
    }
  },
}))

import { POST } from "@/app/api/conges/solve/route"
import type { PaidLeaveSolveRequest } from "@/features/paid-leave/solver/paid-leave-solver-contract"

/** Une demande valide de forme, dont seuls les nombres nous intéressent. */
function solveRequest(minimumHours: number): PaidLeaveSolveRequest {
  return {
    campaignId: "leave_1",
    timeoutSeconds: 60,
    weeks: ["2026-W30"],
    closureWeekIds: [],
    sectors: [{ id: "drive", name: "Drive" }],
    employees: [],
    coverage: [
      {
        sectorId: "drive",
        weekId: "2026-W30",
        baseContractHours: 35,
        minimumHours,
        toleratedDeficitHours: 0,
        maximumAbsent: null,
      },
    ],
    reinforcementPools: [],
  }
}

function post(body: unknown): Request {
  return new Request("http://localhost/api/conges/solve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

function reset(
  {
    configured = true,
    loaded = solveRequest(120),
  }: { configured?: boolean; loaded?: PaidLeaveSolveRequest | null } = {}
) {
  doubles.session = { userId: "u", storeId: "s", role: "manager", email: "a@b.c", fullName: null }
  doubles.configured = configured
  doubles.loaded = loaded
  doubles.sent = null
  doubles.loadedWith = null
}

describe("avec une base : la demande vient de la base, et d’elle seule", () => {
  it("ignore une demande forgée envoyée par le client", async () => {
    // LE test de cette correction. Le client réclame un minimum de couverture
    // nul — c'est-à-dire aucune contrainte — et la base en porte 120. C'est 120
    // que Python doit voir.
    reset()
    const response = await POST(
      post({ campaignId: "leave_1", timeoutSeconds: 60, request: solveRequest(0) })
    )

    expect(response.status).toBe(200)
    const sent = JSON.parse(doubles.sent ?? "{}") as PaidLeaveSolveRequest
    expect(sent.coverage[0].minimumHours).toBe(120)
  })

  it("n’a même pas besoin que le client en envoie une", async () => {
    reset()
    const response = await POST(post({ campaignId: "leave_1" }))

    expect(response.status).toBe(200)
    const sent = JSON.parse(doubles.sent ?? "{}") as PaidLeaveSolveRequest
    expect(sent.coverage[0].minimumHours).toBe(120)
  })

  it("refuse une campagne introuvable sans lancer Python", async () => {
    // Introuvable et interdite rendent le même 404 : les distinguer dirait à un
    // curieux si un identifiant est utilisé dans un autre magasin.
    reset({ loaded: null })
    const response = await POST(post({ campaignId: "leave_inconnue" }))

    expect(response.status).toBe(404)
    expect(doubles.sent).toBeNull()
  })

  it("refuse un corps sans identifiant de campagne", async () => {
    reset()
    const response = await POST(post({ timeoutSeconds: 60, request: solveRequest(0) }))

    expect(response.status).toBe(400)
    expect(doubles.sent).toBeNull()
  })
})

describe("sans base : le repli, et rien de plus", () => {
  it("accepte la demande du client quand le serveur n’a rien à relire", async () => {
    // Une installation qui range tout dans le `localStorage` du navigateur : le
    // serveur n'a par construction aucune campagne à lire, et refuser serait
    // refuser de fonctionner.
    reset({ configured: false })
    const response = await POST(
      post({ campaignId: "leave_1", timeoutSeconds: 60, request: solveRequest(80) })
    )

    expect(response.status).toBe(200)
    const sent = JSON.parse(doubles.sent ?? "{}") as PaidLeaveSolveRequest
    expect(sent.coverage[0].minimumHours).toBe(80)
  })

  it("refuse quand le repli manque, plutôt que de calculer dans le vide", async () => {
    reset({ configured: false })
    const response = await POST(post({ campaignId: "leave_1" }))

    expect(response.status).toBe(400)
    expect(doubles.sent).toBeNull()
  })
})

describe("la garde d’accès, qui passe avant tout le reste", () => {
  it("refuse sans session, sans lire ni calculer quoi que ce soit", async () => {
    reset()
    doubles.session = null
    const response = await POST(post({ campaignId: "leave_1" }))

    expect(response.status).toBe(401)
    expect(doubles.sent).toBeNull()
  })
})

describe("le temps imparti", () => {
  it("vient du corps, jamais de la demande forgée", async () => {
    // `timeoutSeconds` décide combien de temps un appelant peut occuper le
    // serveur. Le lire dans la demande du client le rendrait réglable par
    // celui-là même qu'on vient de cesser de croire — et le champ du corps est
    // le seul borné par le schéma (1 à 300 secondes).
    reset()
    const response = await POST(
      post({
        campaignId: "leave_1",
        timeoutSeconds: 5,
        request: { ...solveRequest(0), timeoutSeconds: 300 },
      })
    )

    expect(response.status).toBe(200)
    expect(doubles.loadedWith).toBe(5)
  })

  it("refuse un temps hors des bornes du schéma", async () => {
    reset()
    const response = await POST(post({ campaignId: "leave_1", timeoutSeconds: 9000 }))

    expect(response.status).toBe(400)
    expect(doubles.sent).toBeNull()
  })

  it("garde le repli cohérent avec le corps, sans base", async () => {
    // Ici la demande du client EST la charge utile : il faut donc écraser son
    // `timeoutSeconds`, sans quoi le budget interne du solveur et la minuterie
    // qui le tue divergeraient.
    reset({ configured: false })
    const response = await POST(
      post({
        campaignId: "leave_1",
        timeoutSeconds: 7,
        request: { ...solveRequest(80), timeoutSeconds: 300 },
      })
    )

    expect(response.status).toBe(200)
    const sent = JSON.parse(doubles.sent ?? "{}") as PaidLeaveSolveRequest
    expect(sent.timeoutSeconds).toBe(7)
  })
})
