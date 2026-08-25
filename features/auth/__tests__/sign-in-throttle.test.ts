import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Le joint, pas les deux moitiés.
 *
 * `login-throttle.test.ts` prouve que le compteur compte. Il ne prouve pas que
 * l'action s'en sert, ni qu'elle s'en sert AVANT d'appeler Supabase — et un
 * frein correct branché après l'appel qu'il devait éviter ne freine rien. Ce
 * fichier mesure exactement cela : combien de fois Supabase a été joint.
 */

const supabase = vi.hoisted(() => ({ appels: 0, echoue: true }))

vi.mock("@/features/auth/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      signInWithPassword: async () => {
        supabase.appels += 1
        return supabase.echoue ? { error: { message: "Invalid credentials" } } : { error: null }
      },
    },
  }),
}))

const requete = vi.hoisted(() => ({ ip: "203.0.113.7" }))

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-real-ip": requete.ip }),
}))

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }))

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    // `redirect` interrompt le flux en levant : le double doit lever aussi,
    // sinon l'action continuerait après un point qu'elle ne dépasse jamais.
    throw new Error(`REDIRECTION:${to}`)
  },
}))

import { signIn } from "@/features/auth/actions"
import { loginThrottle, MAX_PER_EMAIL } from "@/features/auth/login-throttle"

function saisie(email: string, password = "mauvais"): FormData {
  const data = new FormData()
  data.set("email", email)
  data.set("password", password)
  data.set("suivant", "/dashboard")
  return data
}

const REFUS = "Adresse ou mot de passe incorrect."

beforeEach(() => {
  loginThrottle.clear()
  supabase.appels = 0
  supabase.echoue = true
  requete.ip = "203.0.113.7"
})

describe("la connexion freinée", () => {
  it("laisse les premières tentatives atteindre Supabase", async () => {
    for (let i = 0; i < MAX_PER_EMAIL; i += 1) {
      const result = await signIn(null, saisie("gerant@magasin.fr"))
      expect(result.error).toBe(REFUS)
    }

    expect(supabase.appels).toBe(MAX_PER_EMAIL)
  })

  it("refuse la tentative de trop SANS joindre Supabase", async () => {
    for (let i = 0; i < MAX_PER_EMAIL; i += 1) await signIn(null, saisie("gerant@magasin.fr"))

    const result = await signIn(null, saisie("gerant@magasin.fr"))

    expect(result.error).toMatch(/^Trop de tentatives/)
    // Le chiffre qui compte : aucun appel de plus. C'est tout l'objet du frein.
    expect(supabase.appels).toBe(MAX_PER_EMAIL)
  })

  it("freine une adresse inexistante exactement comme une vraie", async () => {
    // Sinon le message d'attente dirait quels comptes existent, ce que le
    // message d'échec unique s'applique justement à taire.
    for (let i = 0; i < MAX_PER_EMAIL; i += 1) await signIn(null, saisie("inconnu@nulle-part.fr"))

    const result = await signIn(null, saisie("inconnu@nulle-part.fr"))

    expect(result.error).toMatch(/^Trop de tentatives/)
  })

  it("ne fait pas payer une adresse pour les échecs d'une autre", async () => {
    for (let i = 0; i < MAX_PER_EMAIL; i += 1) await signIn(null, saisie("gerant@magasin.fr"))

    const result = await signIn(null, saisie("adjoint@magasin.fr"))

    expect(result.error).toBe(REFUS)
  })

  it("oublie les erreurs de frappe une fois le mot de passe prouvé", async () => {
    for (let i = 0; i < MAX_PER_EMAIL - 1; i += 1) await signIn(null, saisie("gerant@magasin.fr"))

    supabase.echoue = false
    await expect(signIn(null, saisie("gerant@magasin.fr", "le bon"))).rejects.toThrow(
      "REDIRECTION:/dashboard"
    )

    // Le compteur est remis à zéro : cinq nouvelles tentatives sont dues.
    supabase.echoue = true
    supabase.appels = 0
    for (let i = 0; i < MAX_PER_EMAIL; i += 1) {
      expect((await signIn(null, saisie("gerant@magasin.fr"))).error).toBe(REFUS)
    }
    expect(supabase.appels).toBe(MAX_PER_EMAIL)
  })

  it("ne consulte pas Supabase quand un champ manque", async () => {
    const vide = new FormData()
    vide.set("email", "")
    vide.set("password", "")

    const result = await signIn(null, vide)

    expect(result.error).toBe("Renseignez votre adresse et votre mot de passe.")
    expect(supabase.appels).toBe(0)
  })
})
