"use server"

import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"

import { createSupabaseServerClient } from "@/features/auth/supabase/server"

/**
 * Se connecter, se déconnecter. Les deux seules écritures de session.
 *
 * Des server actions et non des routes : le formulaire poste, le cookie est
 * écrit dans la même requête, et la redirection part du serveur. Un aller-retour
 * de moins, et aucun jeton ne transite par du JavaScript de page.
 */

export interface SignInResult {
  readonly error: string
}

export async function signIn(_previous: SignInResult | null, formData: FormData): Promise<SignInResult> {
  const email = String(formData.get("email") ?? "").trim()
  const password = String(formData.get("password") ?? "")
  const next = String(formData.get("suivant") ?? "/dashboard")

  if (!email || !password) {
    return { error: "Renseignez votre adresse et votre mot de passe." }
  }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    // Un message unique pour « adresse inconnue » et « mot de passe faux » :
    // distinguer les deux dirait à un inconnu quelles adresses existent.
    return { error: "Adresse ou mot de passe incorrect." }
  }

  // La destination vient du proxy, qui a mémorisé d'où l'on venait. Bornée à un
  // chemin interne : une valeur venue de l'URL ne doit jamais pouvoir renvoyer
  // vers un autre site après connexion.
  const destination = next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard"

  revalidatePath("/", "layout")
  redirect(destination)
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient()
  await supabase.auth.signOut()
  revalidatePath("/", "layout")
  redirect("/login")
}
