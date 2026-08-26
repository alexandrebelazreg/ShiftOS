"use server"

import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"

import {
  clientIp,
  loginLimits,
  loginThrottle,
  tooManyAttemptsMessage,
} from "@/features/auth/login-throttle"
import { currentSession } from "@/features/auth/dal"
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

  const limits = loginLimits(email, clientIp(await headers()))
  const now = Date.now()

  // AVANT l'appel à Supabase, jamais après : tout l'intérêt est que la tentative
  // de trop ne coûte pas un aller-retour, et n'entame pas le quota que Supabase
  // décompte sur l'adresse unique du conteneur.
  const wait = loginThrottle.retryAfterMs(limits, now)
  if (wait > 0) return { error: tooManyAttemptsMessage(wait) }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    loginThrottle.recordFailure(limits, now)
    // Un message unique pour « adresse inconnue » et « mot de passe faux » :
    // distinguer les deux dirait à un inconnu quelles adresses existent.
    //
    // Le message d'attente ne trahit rien de plus : le comptage porte sur
    // l'adresse SAISIE, qu'elle existe ou non. Une adresse inventée se fait
    // freiner exactement comme une vraie.
    return { error: "Adresse ou mot de passe incorrect." }
  }

  // Le mot de passe est prouvé : les erreurs de frappe qui précèdent n'ont plus
  // à peser sur la prochaine connexion.
  loginThrottle.forget(limits)

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

/**
 * Enregistre le nom de la personne connectée.
 *
 * Il sert à signer les feuilles qui partent au mur : « Édité le … par … ».
 * Rangé dans `profiles`, donc rattaché au COMPTE et non au navigateur — il
 * suit la personne d'un poste à l'autre, et un second compte aura le sien.
 *
 * L'identité vient de la SESSION, jamais du formulaire : accepter un `id`
 * posté permettrait de renommer le profil de quelqu'un d'autre.
 */
export async function saveProfileName(name: string): Promise<{ readonly error: string } | void> {
  const session = await currentSession()
  if (!session) redirect("/login")

  const trimmed = name.trim()
  // 80 caractères : un nom et un prénom tiennent largement, et la feuille
  // imprimée a une largeur finie. Vider le champ est permis — c'est ainsi
  // qu'on retire sa signature.
  if (trimmed.length > 80) return { error: "Le nom ne peut pas dépasser 80 caractères." }

  /**
   * ON REDEMANDE LA LIGNE, ET C'EST ESSENTIEL.
   *
   * Un `update` refusé par RLS ne lève AUCUNE erreur : la politique ne fait
   * simplement correspondre aucune ligne, et Supabase rend `error: null`. Sans
   * ce `select`, l'écran aurait annoncé « Enregistré » sur une écriture qui n'a
   * jamais eu lieu — et c'est précisément ce qui s'est produit avant que la
   * politique d'écriture n'existe (migration 0007).
   *
   * La ligne rendue est donc la preuve. Pas de ligne, pas d'enregistrement.
   */
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from("profiles")
    .update({ full_name: trimmed === "" ? null : trimmed })
    .eq("id", session.userId)
    .select("id")
    .maybeSingle()

  if (error) return { error: "Impossible d’enregistrer le nom." }
  if (!data) {
    return {
      error:
        "Le nom n’a pas été enregistré : la base refuse l’écriture. La migration 0007 n’a probablement pas été appliquée.",
    }
  }

  // Le nom se lit dans le menu latéral, rendu par la mise en page : sans
  // cette invalidation il resterait l'ancien jusqu'au prochain rechargement.
  revalidatePath("/", "layout")
}
