import "server-only"

import { cache } from "react"
import { redirect } from "next/navigation"

import { createSupabaseServerClient } from "@/features/auth/supabase/server"

/**
 * La couche d'accès aux données — le point de passage unique.
 *
 * Next 16 dit explicitement que le proxy « n'est pas destiné à la gestion de
 * session ni à l'autorisation » : il tourne aussi sur les routes préchargées, et
 * une vérification qui y vivrait serait à la fois coûteuse et contournable.
 * L'autorisation vit donc ICI, et chaque page serveur, chaque action et chaque
 * route la traverse.
 *
 * Ce module rend aussi le `store_id`, et ce n'est pas un hasard : la session
 * vérifiée est la seule source légitime du magasin sur lequel on travaille. Un
 * dépôt qui reçoit son `storeId` d'ici ne peut pas lire chez le voisin, parce
 * qu'aucun chemin ne permet de lui en passer un autre.
 */

export interface Session {
  readonly userId: string
  readonly storeId: string
  readonly role: string
  readonly email: string
}

/**
 * `cache` mémoïse pour la durée d'UN rendu React.
 *
 * Une page qui appelle `verifySession()` dans son garde, puis dans deux de ses
 * composants, ne paie qu'un aller-retour. Sans cette mémoïsation, ajouter un
 * appel de sécurité coûterait une requête réseau — et le réflexe deviendrait de
 * l'éviter, ce qui est exactement le contraire du but.
 */
export const currentSession = cache(async (): Promise<Session | null> => {
  const supabase = await createSupabaseServerClient()

  // `getUser`, jamais `getSession`. Le second se contente de lire le cookie ;
  // le premier fait valider le jeton par le serveur d'authentification. Sur un
  // serveur, seule la seconde garantie a une valeur : un cookie se fabrique.
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) return null

  // Le profil porte le magasin. Son absence n'est PAS une erreur technique :
  // c'est un compte créé mais pas encore rattaché, et le traiter comme une
  // session valide donnerait un `storeId` vide que les dépôts prendraient pour
  // une requête légitime.
  const { data: profile } = await supabase
    .from("profiles")
    .select("store_id, role, email")
    .eq("id", data.user.id)
    .maybeSingle()

  if (!profile) return null

  return {
    userId: data.user.id,
    storeId: profile.store_id as string,
    role: profile.role as string,
    email: (profile.email as string) ?? data.user.email ?? "",
  }
})

/**
 * La session, ou la page de connexion. Ne rend jamais `null`.
 *
 * C'est la forme qu'appellent les pages : le type dit qu'il y a une session, et
 * le contrôle de flux le garantit. Un appelant ne peut donc pas oublier de
 * traiter le cas déconnecté — il n'existe pas de son point de vue.
 */
export async function verifySession(): Promise<Session> {
  const session = await currentSession()
  if (!session) redirect("/login")
  return session
}

/** Le magasin de la session, pour sceller les dépôts. */
export async function currentStoreId(): Promise<string> {
  return (await verifySession()).storeId
}
